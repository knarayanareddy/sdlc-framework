#!/usr/bin/env node
// progress.json schema + invariant checks (closes R-15's "no schema for progress.json").
// The point is not shape for its own sake: `passed` must carry a command and exit 0,
// and `NOT_VERIFIED` must carry a reason and the command a human would run.
//
//   node pipeline/tools/validate-progress.mjs [docs/progress.json] [--json]
import fs from "node:fs";
import { GATE_IDS, PHASE_IDS, STATUSES } from "./lib/gates.mjs";
import { parseArgs, readJson, fail } from "./lib/common.mjs";

const { flags, positional } = parseArgs();
const file = positional[0] ?? flags.path ?? "docs/progress.json";

if (!fs.existsSync(file)) fail(`no progress file at ${file}`);
let p;
try {
  p = readJson(file);
} catch (err) {
  fail(err.message);
}

const problems = [];
const gates = GATE_IDS;

if (p.schemaVersion !== 2) problems.push(`schemaVersion must be 2 (found ${JSON.stringify(p.schemaVersion)})`);
if (!("phase" in p)) problems.push("missing phase");
if (p.phase !== null && !PHASE_IDS.includes(p.phase)) problems.push(`phase "${p.phase}" is not a known phase id`);
if (typeof p.gates !== "object" || p.gates === null) problems.push("gates must be an object");

for (const [id, g] of Object.entries(p.gates ?? {})) {
  if (!gates.includes(id)) {
    problems.push(`${id}: not a known gate id`);
    continue;
  }
  if (!STATUSES.includes(g.status)) problems.push(`${id}: status must be one of ${STATUSES.join(", ")}`);
  if (g.status === "passed") {
    if (typeof g.exitCode !== "number") problems.push(`${id}: passed without an exitCode (a gate is a command result, not an opinion)`);
    else if (g.exitCode !== 0) problems.push(`${id}: passed but exitCode is ${g.exitCode}`);
    if (!g.command && !(Array.isArray(g.evidence) && g.evidence.length)) problems.push(`${id}: passed without a command or evidence files`);
  }
  if (g.status === "NOT_VERIFIED") {
    if (!g.reason || String(g.reason).trim().length < 8) problems.push(`${id}: NOT_VERIFIED without a reason`);
    if (!g.humanCommand) problems.push(`${id}: NOT_VERIFIED without humanCommand (what a human should run)`);
  }
  if (g.status === "failed" && typeof g.exitCode !== "number") problems.push(`${id}: failed without an exitCode`);
}

for (const [id, ph] of Object.entries(p.phases ?? {})) {
  if (!PHASE_IDS.includes(id)) problems.push(`phases.${id}: not a known phase id`);
  if (!["started", "done", "blocked"].includes(ph.status)) problems.push(`phases.${id}: status must be started|done|blocked`);
}

if (!Array.isArray(p.blockers)) problems.push("blockers must be an array");
else
  for (const b of p.blockers) {
    if (!b.id || !b.text) problems.push("a blocker is missing id or text");
    if (!b.fallback) problems.push(`blocker ${b.id ?? "?"}: no fallback recorded (rule: take the safest fallback, then record it)`);
  }

if (typeof p.rounds !== "object" || p.rounds === null) problems.push("rounds must be an object");
else {
  for (const k of ["full", "diff"]) {
    if (typeof p.rounds[k] !== "number" || p.rounds[k] < 0) problems.push(`rounds.${k} must be a number >= 0`);
  }
  if ((p.rounds.full ?? 0) > 3) problems.push("rounds.full exceeds 3; the framework caps FULL rounds at 3");
}

const json = {
  ok: problems.length === 0,
  phase: p.phase ?? null,
  gates: Object.keys(p.gates ?? {}).length,
  passed: Object.values(p.gates ?? {}).filter((g) => g.status === "passed").length,
  notVerified: Object.values(p.gates ?? {}).filter((g) => g.status === "NOT_VERIFIED").length,
  problems,
};

if (flags.json) console.log(JSON.stringify(json, null, 2));
else {
  console.log(`phase: ${p.phase ?? "none"}  gates recorded: ${json.gates}  passed: ${json.passed}  NOT_VERIFIED: ${json.notVerified}`);
  for (const problem of problems) console.log(`PROBLEM ${problem}`);
  console.log(problems.length ? "RESULT: FAIL" : "RESULT: PASS");
}
process.exit(problems.length ? 1 : 0);
