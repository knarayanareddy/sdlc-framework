#!/usr/bin/env node
// Coverage gate (v2-08 §8.2′): every enumerated entry point must appear in the
// coverage ledger as examined (with a hunter) or excluded (with a reason).
// Run by script, not by asking a model.
//
//   node pipeline/tools/coverage-gate.mjs --entrypoints e.json --ledger c.json [--json]
import fs from "node:fs";
import { parseArgs, paint, readJson, fail } from "./lib/common.mjs";

const { flags } = parseArgs();
const entryPath = flags.entrypoints ?? "docs/08-redteam/run-1/entrypoints.json";
const ledgerPath = flags.ledger ?? "docs/08-redteam/run-1/coverage-ledger.json";
const asJson = Boolean(flags.json);

if (!fs.existsSync(entryPath)) fail(`no entrypoints file at ${entryPath} (run entrypoints.mjs first)`);
if (!fs.existsSync(ledgerPath)) fail(`no coverage ledger at ${ledgerPath}`);

const { entrypoints } = readJson(entryPath);
const ledger = readJson(ledgerPath);
const units = Array.isArray(ledger.units) ? ledger.units : [];

const byId = new Map(units.map((u) => [u.id, u]));
const problems = [];

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
