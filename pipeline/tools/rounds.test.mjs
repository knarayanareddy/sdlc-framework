import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { recordRound } from "./lib/rounds.mjs";

const TOOL = path.join(path.dirname(fileURLToPath(import.meta.url)), "validate-progress.mjs");

function findings(mode) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rounds-"));
  const file = path.join(dir, "findings.json");
  fs.writeFileSync(file, JSON.stringify({ run: "RUN-1", mode, findings: [] }));
  return file;
}

test("a FULL round at phase 08 counts as one FULL round", () => {
  const progress = { rounds: { full: 0, diff: 0 } };
  assert.ok(recordRound(progress, "08", findings("FULL"), { coverageVerified: true }));
  assert.deepEqual(progress.rounds, { full: 1, diff: 0 });
  assert.equal(progress.roundLog.length, 1);
  assert.equal(progress.roundLog[0].mode, "FULL");
});

test("phase 09 can be a DIFF round, and the two counts do not get merged", () => {
  const progress = { rounds: { full: 0, diff: 0 } };
  recordRound(progress, "08", findings("FULL"), { coverageVerified: true });
  recordRound(progress, "09", findings("DIFF"), { coverageVerified: true });
  assert.deepEqual(progress.rounds, { full: 1, diff: 1 });
});

test("re-running the same phase replaces its round instead of double counting", () => {
  const progress = { rounds: { full: 0, diff: 0 } };
  const file = findings("FULL");
  recordRound(progress, "08", file, { coverageVerified: true });
  recordRound(progress, "08", file, { coverageVerified: true });
  assert.deepEqual(progress.rounds, { full: 1, diff: 0 }, "a re-run of phase 08 is still one round");
  assert.equal(progress.roundLog.length, 1);
});

test("a phase that is not a red-team round records nothing", () => {
  const progress = { rounds: { full: 0, diff: 0 } };
  assert.equal(recordRound(progress, "10", findings("FULL"), { coverageVerified: true }), null);
  assert.deepEqual(progress.rounds, { full: 0, diff: 0 });
});

test("missing or unreadable findings cannot be read as a round", () => {
  const progress = { rounds: { full: 0, diff: 0 } };
  assert.equal(recordRound(progress, "08", "/nonexistent/findings.json"), null);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rounds-"));
  const broken = path.join(dir, "findings.json");
  fs.writeFileSync(broken, "{not json");
  assert.equal(recordRound(progress, "08", broken), null);
  assert.deepEqual(progress.rounds, { full: 0, diff: 0 });
});

test("a fourth FULL round is visible to validate-progress, so the stop rule can fire", () => {
  const progress = { schemaVersion: 1, rounds: { full: 0, diff: 0 }, phases: {}, gates: {} };
  for (const phase of ["08", "09"]) recordRound(progress, phase, findings("FULL"), { coverageVerified: true });
  // Two more FULL rounds would need more phases, so simulate what the log would look like.
  progress.roundLog.push({ phase: "08", mode: "FULL", at: new Date().toISOString() }, { phase: "09", mode: "FULL", at: new Date().toISOString() });
  progress.rounds = { full: 4, diff: 0 };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rounds-"));
  const file = path.join(dir, "progress.json");
  fs.writeFileSync(file, JSON.stringify(progress));
  const res = spawnSync("node", [TOOL, file, "--json"], { encoding: "utf8" });
  assert.notEqual(res.status, 0);
  assert.match(res.stdout, /caps FULL rounds at 3/);
});

// ---------------------------------------------------------------------------
// P7 · 2.8.1 — a round is a run directory, so the counter can reach 3 (G-13)
// ---------------------------------------------------------------------------
test("three red-team rounds in different run directories are three rounds", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "rounds-"));
  const findings = path.join(d, "findings.json");
  fs.writeFileSync(findings, JSON.stringify({ mode: "FULL" }));
  const progress = { rounds: { full: 0, diff: 0 } };
  for (const runDir of ["docs/08-redteam/run-1", "docs/08-redteam/run-2", "docs/08-redteam/run-3"]) {
    progress.runDir = runDir;
    recordRound(progress, "08", findings, { coverageVerified: true });
  }
  assert.equal(progress.rounds.full, 3, "the stop rule at 3 must be reachable");
  assert.equal(progress.roundLog.length, 3);

  // The same run directory twice is a re-run, not a new round.
  recordRound(progress, "08", findings, { coverageVerified: true });
  assert.equal(progress.rounds.full, 3);
});

test("a FULL claim without coverage evidence is recorded as DIFF, with the reason", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "rounds-"));
  const f = path.join(d, "findings.json");
  fs.writeFileSync(f, JSON.stringify({ mode: "FULL" }));
  const progress = { rounds: { full: 0, diff: 0 } };
  recordRound(progress, "08", f, { coverageVerified: false });
  assert.equal(progress.rounds.full, 0, "the red team cannot make a round FULL by typing it");
  assert.equal(progress.rounds.diff, 1);
  assert.match(progress.roundLog.at(-1).note, /coverage-gate did not pass/);

  recordRound(progress, "09", f, { coverageVerified: null });
  assert.equal(progress.rounds.full, 0);
  assert.match(progress.roundLog.at(-1).note, /no coverage evidence/);
});
