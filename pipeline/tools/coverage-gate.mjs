#!/usr/bin/env node
// Coverage gate (v2-08 §8.2′): every enumerated entry point must appear in the
// coverage ledger as examined (with a hunter) or excluded (with a reason).
// Run by script, not by asking a model.
//
//   node pipeline/tools/coverage-gate.mjs --entrypoints e.json --ledger c.json [--json]
//   node pipeline/tools/coverage-gate.mjs … --changed-since HEAD~5   # brownfield: changed files only
//
// A scoped run says so on stdout and in --json. Scoping is for a change, not for a release.
import fs from "node:fs";
import { parseArgs, paint, readJson, fail } from "./lib/common.mjs";
import { assertScopeResolved, printScope, resolveScope } from "./lib/scope.mjs";

const { flags } = parseArgs();
const entryPath = flags.entrypoints ?? "docs/08-redteam/run-1/entrypoints.json";
const ledgerPath = flags.ledger ?? "docs/08-redteam/run-1/coverage-ledger.json";
const asJson = Boolean(flags.json);

if (!fs.existsSync(entryPath)) fail(`no entrypoints file at ${entryPath} (run entrypoints.mjs first)`);
if (!fs.existsSync(ledgerPath)) fail(`no coverage ledger at ${ledgerPath}`);

const { entrypoints: allEntrypoints } = readJson(entryPath);
const ledger = readJson(ledgerPath);
const units = Array.isArray(ledger.units) ? ledger.units : [];

// The schema in pipeline/schemas/coverage-ledger.schema.json is the contract; these are the
// same rules in code, so a ledger that is not a ledger fails here rather than being read as
// "zero units examined".
const shapeProblems = [];
if (!ledger || typeof ledger !== "object" || Array.isArray(ledger)) shapeProblems.push("coverage-ledger.json must be an object");
else {
  if (typeof ledger.run !== "string") shapeProblems.push("run must be a string (which red-team run this is)");
  if (!["FULL", "DIFF"].includes(ledger.mode)) shapeProblems.push(`mode must be FULL or DIFF (found ${JSON.stringify(ledger.mode)})`);
  if (!Array.isArray(ledger.units)) shapeProblems.push("units must be an array");
}
for (const [i, u] of (Array.isArray(ledger?.units) ? ledger.units : []).entries()) {
  if (!u || typeof u.id !== "string") shapeProblems.push(`units\[${i}\]: id must be a string`);
  if (!["examined", "excluded", "unexamined"].includes(u?.status)) shapeProblems.push(`units\[${i}\]: status must be examined|excluded|unexamined (found ${JSON.stringify(u?.status)})`);
}

const scope = resolveScope({ scope: flags.scope, changedSince: flags["changed-since"], cwd: process.cwd() });
assertScopeResolved(scope, `node pipeline/tools/coverage-gate.mjs --entrypoints ${entryPath} --ledger ${ledgerPath}   # or drop the scope flags`);
printScope(scope);
// With a scope, only the entry points in it are required to be covered. Everything else in
// the ledger is still checked for the same invariants.
const entrypoints = scope ? (allEntrypoints ?? []).filter((e) => scope.matches(e.file)) : allEntrypoints;
if (scope && entrypoints.length === 0) {
  console.log(paint.yellow(`NOT_VERIFIED: the scope (${scope.label}) contains no entry points, so nothing was covered`));
  console.log(`human command: node pipeline/tools/coverage-gate.mjs --entrypoints ${entryPath} --ledger ${ledgerPath}   # whole project, no scope flags`);
  process.exit(3);
}

const byId = new Map(units.map((u) => [u.id, u]));
const problems = [...shapeProblems];

// Zero entry points is not "everything covered": it means the enumerator found nothing, so
// the coverage claim has no subject (F-10).
if (!Array.isArray(entrypoints) || entrypoints.length === 0) {
  console.log(paint.yellow("NOT_VERIFIED: entrypoints.json lists no entry points, so nothing was covered"));
  console.log(`human command: node pipeline/tools/entrypoints.mjs --root <the app directory> --out ${entryPath}`);
  process.exit(3);
}

for (const ep of entrypoints) {
  const unit = byId.get(ep.id);
  if (!unit) {
    problems.push(`missing: ${ep.id} (${ep.file}:${ep.line}) is not a ledger unit`);
    continue;
  }
  if (unit.status === "examined") {
    if (!unit.hunter) problems.push(`unattributed: ${ep.id} is "examined" with no hunter id`);
  } else if (unit.status === "excluded") {
    if (!unit.reason || String(unit.reason).trim().length < 8) problems.push(`unjustified: ${ep.id} is "excluded" without a written reason`);
  } else {
    problems.push(`unexamined: ${ep.id} has status "${unit.status}"`);
  }
}

// Units the enumerator did not list are still claims about work: an unexamined or
// unattributed extra unit must not pass just because it is not an entry point.
for (const unit of units) {
  if (entrypoints.some((e) => e.id === unit.id)) continue;
  if (unit.status === "examined" && !unit.hunter) problems.push(`unattributed: ${unit.id} is "examined" with no hunter id`);
  else if (unit.status === "excluded" && (!unit.reason || String(unit.reason).trim().length < 8)) problems.push(`unjustified: ${unit.id} is "excluded" without a written reason`);
  else if (unit.status !== "examined" && unit.status !== "excluded") problems.push(`unexamined: ${unit.id} has status "${unit.status}"`);
}

const examined = units.filter((u) => u.status === "examined").length;
const excluded = units.filter((u) => u.status === "excluded").length;
const unknown = units.filter((u) => !entrypoints.some((e) => e.id === u.id)).length;

const result = {
  entrypoints: entrypoints.length,
  units: units.length,
  examined,
  excluded,
  nonEntrypointUnits: unknown,
  problems,
  result: problems.length ? "FAIL" : "PASS",
};

if (asJson) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`entry points: ${entrypoints.length}  ledger units: ${units.length}  examined: ${examined}  excluded: ${excluded}  extra units: ${unknown}`);
  for (const p of problems) console.log(`PROBLEM ${p}`);
  if (unknown > 0) console.log(paint.yellow(`note: ${unknown} ledger units are not entry points (subsystem units); that is allowed`));
  console.log(result.result === "PASS" ? "RESULT: PASS" : "RESULT: FAIL");
}
process.exit(problems.length ? 1 : 0);
