#!/usr/bin/env node
// trace-check v2: requirement <-> test traceability that cannot be satisfied by a comment.
//
// Changes vs v1 (each has a fixture in trace-check-v2.selftest.mjs):
//   1. A @req tag only counts on its own comment line, never trailing code.
//   2. A tagged file only counts as coverage if it contains >=1 real assertion.
//   3. skip / todo / fixme / fails / xit / xfail in a tagged file is an ERROR.
//   4. Tautologies (expect(true).toBe(true)) do not count as assertions.
//   5. Zero requirements prints why it failed.
//   6. `Test file:` in the spec must point at a file that exists and carries the tag, so a
//      spec cannot claim a test that does not test it.
//   7. --baseline / --check-baseline: test files become append-only after phase 05.
//      Baseline records assertions, skips AND test cases, so deleting a case while
//      keeping an assertion elsewhere is caught too.
//
// Usage:
//   node trace-check-v2.mjs <spec> <testsDir> [--allow-uncovered] [--json]
//
// --allow-uncovered marks a STRUCTURE run (spec freeze, phase 02): requirements exist and no
// tests do yet. It is never the right flag for a coverage claim, so `trace:check` does not
// pass it; the run says so on stdout and in --json, and a direct invocation prints a warning.
//   node trace-check-v2.mjs <spec> <testsDir> --baseline <file.json>
//   node trace-check-v2.mjs <spec> <testsDir> --check-baseline <file.json>
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { assertScopeResolved, printScope, resolveScope } from "./lib/scope.mjs";

const argv = process.argv.slice(2);
const flagValue = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const positional = argv.filter(
  (a, i) => !a.startsWith("--") && !(i > 0 && /^--(baseline|check-baseline|spec|tests)$/.test(argv[i - 1])),
);
const allowUncovered = argv.includes("--allow-uncovered");
const asJson = argv.includes("--json");
const specPath = flagValue("--spec") ?? positional[0] ?? "docs/02-spec/SPEC.md";
const testsDir = flagValue("--tests") ?? positional[1] ?? "tests";
const writeBaseline = flagValue("--baseline");
const checkBaseline = flagValue("--check-baseline");

const problems = [];

if (!fs.existsSync(specPath)) {
  console.error(`spec not found: ${specPath}`);
  process.exit(2);
}

const spec = fs.readFileSync(specPath, "utf8");

// A frozen spec hash that nothing reads is decoration: `pipeline freeze` wrote SPEC.sha256
// and no later step compared it, so the spec could be edited after freeze and every gate
// still passed (REVIEW-OF-SECOND-OPINION.md, F-04). This is the reader.
const specHashCandidates = [flagValue("--spec-hash"), `${specPath}.sha256`, specPath.replace(/\.md$/i, ".sha256")].filter(Boolean);
const specHashFile = specHashCandidates.find((f) => fs.existsSync(f));
if (specHashFile && !argv.includes("--no-spec-hash")) {
  const frozen = fs.readFileSync(specHashFile, "utf8").trim().split(/\s+/)[0];
  const actual = crypto.createHash("sha256").update(spec, "utf8").digest("hex");
  if (frozen !== actual) {
    problems.push(
      `spec: ${specPath} no longer matches ${specHashFile} (frozen ${frozen.slice(0, 12)}…, now ${actual.slice(0, 12)}…). ` +
        `Write the change note, then: node pipeline/bin/pipeline.mjs freeze --refreeze`,
    );
  }
}
const heads = [...spec.matchAll(/^###\s+((?:REQ|SEC|NFR)-\d+)\b.*$/gm)];
const reqs = heads.map((m, i) => {
  const start = m.index ?? 0;
  const end = i + 1 < heads.length ? (heads[i + 1].index ?? spec.length) : spec.length;
  return { id: m[1], block: spec.slice(start, end).split(/^##\s/m)[0] };
});
if (reqs.length === 0) problems.push("spec: no '### REQ-001' style headings found, nothing to trace");

const ids = new Set();
for (const r of reqs) {
  if (ids.has(r.id)) problems.push(`${r.id}: duplicate id`);
  ids.add(r.id);
  if (!/Priority:\s*P[012]/.test(r.block)) problems.push(`${r.id}: missing Priority (P0/P1/P2)`);
  if (!/Statement:/.test(r.block)) problems.push(`${r.id}: missing Statement`);
  if (!/Acceptance:/.test(r.block) || !/Given[\s\S]*When[\s\S]*Then/.test(r.block)) problems.push(`${r.id}: missing Given/When/Then`);
  if (!/Test level:/.test(r.block)) problems.push(`${r.id}: missing Test level`);
  if (!/Done-when:/.test(r.block)) problems.push(`${r.id}: missing Done-when`);
  const statement = (r.block.split("Statement:")[1] ?? "").split(/\n-\s+Acceptance:/)[0];
  if (/\b(fast|robust|user-friendly|secure|scalable|intuitive|seamless|appropriate|reasonable|efficient)\b/i.test(statement))
    problems.push(`${r.id}: weasel word in Statement, use a number or an observable behaviour`);
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(test|spec)\.(ts|tsx|js|mjs|cjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

const TAUTOLOGY = /expect\(\s*(true|false|null|undefined|\d+|"[^"]*"|'[^']*')\s*\)\s*\.(toBe|toEqual|toStrictEqual)\(\s*\1\s*\)/g;
const ASSERT = /\b(expect\s*\(|assert(?:\.\w+)?\s*\(|should\.|toMatchSnapshot|toHaveScreenshot|fc\.assert\s*\()/g;

// An assertion in a comment or a string is not a test. `// expect(1).toBe(2)` inside an empty
// case used to cover five requirements and pass G5 (SECOND-OPINION-3 G-07). Strip comments and
// string literals first, then count only assertions that sit inside a test case body.
function stripNonCode(text) {
  let out = "";
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    const d = text[i + 1];
    if (c === "/" && d === "/") {
      while (i < n && text[i] !== "\n") { out += " "; i++; }
      continue;
    }
    if (c === "/" && d === "*") {
      i += 2;
      while (i < n && !(text[i] === "*" && text[i + 1] === "/")) { out += text[i] === "\n" ? "\n" : " "; i++; }
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      out += " ";
      i++;
      while (i < n && text[i] !== quote) {
        if (text[i] === "\\") { out += "  "; i += 2; continue; }
        out += text[i] === "\n" ? "\n" : " ";
        i++;
      }
      out += " ";
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

// Walk each `test(`/`it(` call and take its body: the brace block after the arrow or function,
// or the argument list when the case is an expression body. Cheap, but it puts the assertion
// where a reader would look for it -- inside the case.
function assertionsInCases(code) {
  let total = 0;
  const call = /\b(it|test)(?:\.\w+)*\s*\(/g;
  let m;
  while ((m = call.exec(code))) {
    let i = m.index + m[0].length;
    let depth = 1;
    let bodyStart = -1;
    let bodyEnd = -1;
    let sawBrace = false;
    while (i < code.length) {
      const c = code[i];
      if (c === "(") depth++;
      else if (c === ")") {
        depth--;
        if (depth === 0) { if (bodyStart === -1) { bodyStart = m.index + m[0].length; bodyEnd = i; } break; }
      } else if (c === "{" && !sawBrace) {
        sawBrace = true;
        bodyStart = i + 1;
        let braces = 1;
        i++;
        while (i < code.length && braces > 0) {
          if (code[i] === "{") braces++;
          else if (code[i] === "}") braces--;
          i++;
        }
        bodyEnd = i - 1;
        break;
      }
      i++;
    }
    if (bodyStart === -1 || bodyEnd <= bodyStart) continue;
    const body = code.slice(bodyStart, bodyEnd);
    total += (body.match(ASSERT) ?? []).length;
  }
  return total;
}
// Coverage is per test case, not per file: one asserting case in a file tagged
// `@req REQ-001 REQ-002` used to cover both requirements (B-30). A case counts for the ids it
// names itself -- in its title, or in an `@req` comment inside it -- and the file-level tag is
// then only a declaration. Files that name nothing per case keep the tag, but need one
// asserting case per tagged requirement.
function casesInFileSeveral(text) {
  const code = stripNonCode(text);
  const call = /\b(it|test)(?:\.\w+)*\s*\(/g;
  const out = [];
  let m;
  while ((m = call.exec(code))) {
    // strings are blanked in `code`, so the quote offsets are read from `text`
    let i = m.index + m[0].length;
    while (i < text.length && /\s/.test(text[i])) i++;
    let title = "";
    const quote = text[i];
    if (quote === '"' || quote === "'" || quote === "`") {
      i++;
      while (i < text.length && text[i] !== quote) {
        if (text[i] === "\\") { title += text[i + 1] ?? ""; i += 2; continue; }
        title += text[i++];
      }
      i++;
    }
    let brace = text.indexOf("{", m.index + m[0].length);
    if (brace === -1) { out.push({ title, asserts: 0, tags: [] }); continue; }
    let depth = 0;
    let j = brace;
    for (; j < text.length; j++) {
      if (text[j] === "{") depth++;
      else if (text[j] === "}") { depth--; if (depth === 0) break; }
    }
    const body = text.slice(brace + 1, j);
    const bodyCode = stripNonCode(body);
    const asserts = Math.max(0, (bodyCode.match(ASSERT) ?? []).length - (body.match(TAUTOLOGY) ?? []).length);
    const tags = [
      ...(title.match(/\b(?:REQ|SEC|NFR)-\d+\b/g) ?? []),
      ...[...body.matchAll(TAG_LINE)].flatMap((mm) => mm[1].match(/(?:REQ|SEC|NFR)-\d+/g) ?? []),
    ];
    out.push({ title, asserts, tags: [...new Set(tags)] });
  }
  return out;
}

const SKIP = /\b(it|test|describe)\.(skip|todo|fixme|fails)\b|\b(xit|xtest|xdescribe)\s*\(|\bxfail\b/g;
const CASES = /\b(it|test)(?:\.\w+)?\s*\(/g;
const TAG_LINE = /^[ \t]*(?:\/\/|\/\*+|\*)[ \t]*@req[ \t]+((?:(?:REQ|SEC|NFR)-\d+[\s,]*)+)/gm;

// Brownfield: --changed-since / --scope restrict which test files are read. A scoped run
// checks tag hygiene in the files that changed; it cannot claim coverage of the spec, because
// it did not read the suite.
const scope = resolveScope({ scope: flagValue("--scope"), changedSince: flagValue("--changed-since"), cwd: process.cwd() });
assertScopeResolved(scope, `node pipeline/tools/trace-check-v2.mjs ${specPath} ${testsDir}   # or drop the scope flags`);

const files = walk(testsDir)
  .filter((f) => !scope || scope.matches(path.relative(process.cwd(), f).split(path.sep).join("/")))
  .map((f) => {
  const text = fs.readFileSync(f, "utf8");
  const code = stripNonCode(text);
  const rawAsserts = (code.match(ASSERT) ?? []).length;
  const inCases = assertionsInCases(code);
  const tautologies = (text.match(TAUTOLOGY) ?? []).length;
  const casesInFile = casesInFileSeveral(text);
  return {
    file: f,
    sha: crypto.createHash("sha256").update(text).digest("hex").slice(0, 16),
    asserts: Math.max(0, inCases - tautologies),
    assertsOutsideCases: Math.max(0, rawAsserts - inCases),
    tautologies,
    skips: (text.match(SKIP) ?? []).length,
    cases: (text.match(CASES) ?? []).length,
    tags: [...text.matchAll(TAG_LINE)].flatMap((m) => m[1].match(/(?:REQ|SEC|NFR)-\d+/g) ?? []),
    assertingCases: casesInFile.filter((c) => c.asserts > 0),
    caseTags: casesInFile.flatMap((c) => c.tags),
  };
});

if (scope && files.length === 0) {
  // A scope that read no test files proves nothing about tag hygiene either.
  console.log(`NOT_VERIFIED: the scope (${scope.label}) contains no test files`);
  console.log(`human command: node pipeline/tools/trace-check-v2.mjs ${specPath} ${testsDir} --changed-since <ref>   # or drop the scope flags`);
  process.exit(3);
}

const covered = new Map();
for (const f of files) {
  if (f.tags.length === 0) continue;
  for (const id of f.tags) if (!ids.has(id)) problems.push(`${f.file}: tags unknown ${id}`);
  if (f.skips > 0) problems.push(`${f.file}: ${f.skips} skipped/todo/xfail test(s) in a tagged file; skipped tests are not coverage`);
  if (f.tautologies > 0) problems.push(`${f.file}: ${f.tautologies} tautological assertion(s) ignored`);
  if (f.asserts === 0) {
    const why = f.assertsOutsideCases ? `${f.assertsOutsideCases} assertion(s) outside any test case` : "none in code (comments and strings do not count)";
    problems.push(`${f.file}: tagged ${[...new Set(f.tags)].join(",")} but contains 0 real assertions in a test case — ${why}`);
    continue;
  }
  if (f.skips > 0) continue;
  for (const id of f.caseTags) if (!ids.has(id)) problems.push(`${f.file}: a test case names unknown requirement ${id}`);
  if (f.caseTags.length) {
    // The cases say what they test, so only those cases count, and a tag with no case behind it
    // is a claim the file does not keep.
    for (const c of f.assertingCases) for (const id of c.tags) covered.set(id, [...(covered.get(id) ?? []), f.file]);
    const named = new Set(f.assertingCases.flatMap((c) => c.tags));
    for (const id of f.tags) {
      if (!named.has(id)) problems.push(`${f.file}: tagged ${id} but no asserting test case names it — a file-level tag is a declaration, not coverage`);
    }
    continue;
  }
  // No per-case tags: one asserting case per tagged requirement, in tag order.
  const tagList = [...new Set(f.tags)];
  if (tagList.length > f.assertingCases.length) {
    problems.push(
      `${f.file}: tagged ${tagList.length} requirement(s) (${tagList.join(", ")}) but only ${f.assertingCases.length} test case(s) with an assertion — name the requirement in each case, or add the missing cases`,
    );
  }
  for (const id of tagList.slice(0, f.assertingCases.length)) covered.set(id, [...(covered.get(id) ?? []), f.file]);
}

// A requirement may name the file that is supposed to test it. If it does, the file must
// exist and must carry the tag: otherwise the spec's own trace claim is false, whatever the
// rest of the suite covers.
if (!allowUncovered) {
  for (const r of reqs) {
    const declared = (r.block.match(/^[ \t]*[-*][ \t]*Test file:[ \t]*(\S+)/m) ?? [])[1];
    if (!declared) continue;
    const abs = path.resolve(process.cwd(), declared);
    if (!fs.existsSync(abs)) {
      problems.push(`${r.id}: Test file ${declared} does not exist`);
      continue;
    }
    // Not conditional on coverage: if the spec says this file tests REQ-x, the file must say
    // so too. A requirement traced by some other file leaves the declaration false.
    const tags = [...fs.readFileSync(abs, "utf8").matchAll(TAG_LINE)].flatMap((m) => m[1].match(/(?:REQ|SEC|NFR)-\d+/g) ?? []);
    if (!tags.includes(r.id)) problems.push(`${r.id}: declared Test file ${declared} does not carry the @req ${r.id} tag`);
  }
}

const uncovered = reqs.filter((r) => !covered.has(r.id)).map((r) => r.id);

if (writeBaseline) {
  const snap = Object.fromEntries(files.map((f) => [f.file, { sha: f.sha, asserts: f.asserts, skips: f.skips, cases: f.cases }]));
  fs.mkdirSync(path.dirname(writeBaseline), { recursive: true });
  fs.writeFileSync(writeBaseline, `${JSON.stringify(snap, null, 2)}\n`);
  if (!asJson) console.log(`baseline written: ${writeBaseline} (${files.length} files)`);
}

if (checkBaseline) {
  if (!fs.existsSync(checkBaseline)) {
    problems.push(`baseline: ${checkBaseline} does not exist; freeze it in phase 05 before checking it`);
  } else {
    const snap = JSON.parse(fs.readFileSync(checkBaseline, "utf8"));
    const now = new Map(files.map((f) => [f.file, f]));
    for (const [file, before] of Object.entries(snap)) {
      const cur = now.get(file);
      if (!cur) problems.push(`baseline: ${file} was deleted`);
      else {
        if (cur.asserts < before.asserts) problems.push(`baseline: ${file} lost assertions (${before.asserts} -> ${cur.asserts})`);
        if (cur.skips > before.skips) problems.push(`baseline: ${file} gained skips (${before.skips} -> ${cur.skips})`);
        if (typeof before.cases === "number" && cur.cases < before.cases) problems.push(`baseline: ${file} lost test cases (${before.cases} -> ${cur.cases})`);
      }
    }
  }
}

// A scoped run is not a coverage claim either: say so instead of failing on everything it
// did not read.
const coverageClaim = !allowUncovered && !scope;
const fail = problems.length > 0 || (coverageClaim && uncovered.length > 0);
printScope(scope);

if (asJson) {
  console.log(
    JSON.stringify(
      {
        requirements: reqs.length,
        covered: reqs.length - uncovered.length,
        uncovered,
        files: files.length,
        structureOnly: allowUncovered,
        ...(scope ? { scoped: scope.label } : {}),
        problems,
        result: fail ? "FAIL" : allowUncovered ? "PASS (structure only)" : scope ? "PASS (scoped)" : "PASS",
      },
      null,
      2,
    ),
  );
} else {
  if (allowUncovered) {
    console.log("WARNING: --allow-uncovered is a structure run; uncovered requirements are not a pass for coverage");
  }
  console.log(`requirements: ${reqs.length}  covered: ${reqs.length - uncovered.length}  uncovered: ${uncovered.length}  test files: ${files.length}`);
  if (uncovered.length) console.log(`uncovered: ${uncovered.join(", ")}`);
  for (const p of problems) console.log(`PROBLEM ${p}`);
  console.log(
    fail
      ? "RESULT: FAIL"
      : allowUncovered
        ? "RESULT: PASS (structure only; not a coverage claim)"
        : scope
          ? `RESULT: PASS (scoped to ${scope.label}; tag hygiene only, not a coverage claim)`
          : "RESULT: PASS",
  );
}

process.exit(fail ? 1 : 0);
