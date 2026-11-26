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
const SKIP = /\b(it|test|describe)\.(skip|todo|fixme|fails)\b|\b(xit|xtest|xdescribe)\s*\(|\bxfail\b/g;
const CASES = /\b(it|test)(?:\.\w+)?\s*\(/g;
const TAG_LINE = /^[ \t]*(?:\/\/|\/\*+|\*)[ \t]*@req[ \t]+((?:(?:REQ|SEC|NFR)-\d+[\s,]*)+)/gm;

const files = walk(testsDir).map((f) => {
  const text = fs.readFileSync(f, "utf8");
  const rawAsserts = (text.match(ASSERT) ?? []).length;
  const tautologies = (text.match(TAUTOLOGY) ?? []).length;
  return {
    file: f,
    sha: crypto.createHash("sha256").update(text).digest("hex").slice(0, 16),
    asserts: Math.max(0, rawAsserts - tautologies),
    tautologies,
    skips: (text.match(SKIP) ?? []).length,
    cases: (text.match(CASES) ?? []).length,
    tags: [...text.matchAll(TAG_LINE)].flatMap((m) => m[1].match(/(?:REQ|SEC|NFR)-\d+/g) ?? []),
  };
});

const covered = new Map();
for (const f of files) {
  if (f.tags.length === 0) continue;
  for (const id of f.tags) if (!ids.has(id)) problems.push(`${f.file}: tags unknown ${id}`);
  if (f.skips > 0) problems.push(`${f.file}: ${f.skips} skipped/todo/xfail test(s) in a tagged file; skipped tests are not coverage`);
  if (f.tautologies > 0) problems.push(`${f.file}: ${f.tautologies} tautological assertion(s) ignored`);
  if (f.asserts === 0) {
    problems.push(`${f.file}: tagged ${[...new Set(f.tags)].join(",")} but contains 0 real assertions`);
    continue;
  }
  if (f.skips === 0) for (const id of f.tags) covered.set(id, [...(covered.get(id) ?? []), f.file]);
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

const fail = problems.length > 0 || (!allowUncovered && uncovered.length > 0);

if (asJson) {
  console.log(
    JSON.stringify(
      {
        requirements: reqs.length,
        covered: reqs.length - uncovered.length,
        uncovered,
        files: files.length,
        structureOnly: allowUncovered,
        problems,
        result: fail ? "FAIL" : allowUncovered ? "PASS (structure only)" : "PASS",
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
  console.log(fail ? "RESULT: FAIL" : allowUncovered ? "RESULT: PASS (structure only; not a coverage claim)" : "RESULT: PASS");
}

process.exit(fail ? 1 : 0);
