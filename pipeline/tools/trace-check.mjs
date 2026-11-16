#!/usr/bin/env node
// Mechanical gate: checks SPEC structure and requirement <-> test traceability.
// Usage: node pipeline/tools/trace-check.mjs [specPath] [testsDir] [--allow-uncovered]
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const allowUncovered = process.argv.includes("--allow-uncovered");
const specPath = args[0] ?? "docs/02-spec/SPEC.md";
const testsDir = args[1] ?? "tests";

if (!fs.existsSync(specPath)) {
  console.error(`spec not found: ${specPath}`);
  process.exit(2);
}

const spec = fs.readFileSync(specPath, "utf8");
const headingRe = /^###\s+((?:REQ|SEC|NFR)-\d+)\b.*$/gm;
const heads = [...spec.matchAll(headingRe)];
const reqs = heads.map((m, i) => {
  const start = m.index ?? 0;
  const end = i + 1 < heads.length ? (heads[i + 1].index ?? spec.length) : spec.length;
  // stop at the next "## " section too
  const block = spec.slice(start, end).split(/^##\s/m)[0];
  return { id: m[1], block };
});

const problems = [];
const seen = new Set();
for (const r of reqs) {
  if (seen.has(r.id)) problems.push(`${r.id}: duplicate id`);
  seen.add(r.id);
  if (!/Priority:\s*P[012]/.test(r.block)) problems.push(`${r.id}: missing Priority (P0/P1/P2)`);
  if (!/Statement:/.test(r.block)) problems.push(`${r.id}: missing Statement`);
  if (!/Acceptance:/.test(r.block) || !/Given[\s\S]*When[\s\S]*Then/.test(r.block))
    problems.push(`${r.id}: missing Given/When/Then acceptance`);
  if (!/Test level:/.test(r.block)) problems.push(`${r.id}: missing Test level`);
  if (!/Done-when:/.test(r.block)) problems.push(`${r.id}: missing Done-when`);
  if (/\b(fast|robust|user-friendly|secure enough|scalable|intuitive)\b/i.test(r.block.split("Statement:")[1] ?? ""))
    problems.push(`${r.id}: weasel word in statement; use a number or observable behaviour`);
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(test|spec)\.(ts|tsx|js|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

const covered = new Map();
const unknownTags = [];
for (const f of walk(testsDir)) {
  const text = fs.readFileSync(f, "utf8");
  for (const m of text.matchAll(/@req\s+((?:(?:REQ|SEC|NFR)-\d+[\s,]*)+)/g)) {
    for (const id of m[1].match(/(?:REQ|SEC|NFR)-\d+/g) ?? []) {
      if (!seen.has(id)) unknownTags.push(`${f}: tags unknown ${id}`);
      covered.set(id, [...(covered.get(id) ?? []), f]);
    }
  }
}

const uncovered = reqs.filter((r) => !covered.has(r.id)).map((r) => r.id);

console.log(`requirements: ${reqs.length}  covered: ${reqs.length - uncovered.length}  uncovered: ${uncovered.length}`);
if (uncovered.length) console.log(`uncovered: ${uncovered.join(", ")}`);
for (const p of [...problems, ...unknownTags]) console.log(`PROBLEM ${p}`);
if (reqs.length === 0) problems.push("no requirement headings found (### REQ-001 …)");

const fail = problems.length > 0 || unknownTags.length > 0 || (!allowUncovered && uncovered.length > 0);
console.log(fail ? "RESULT: FAIL" : "RESULT: PASS");
process.exit(fail ? 1 : 0);
