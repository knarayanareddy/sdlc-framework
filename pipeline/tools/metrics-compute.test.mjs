import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validate, loadSchema } from "./lib/jsonschema.mjs";
import { appendLedger } from "./lib/ledger.mjs";

const TOOL = path.join(path.dirname(fileURLToPath(import.meta.url)), "metrics-compute.mjs");
const schema = loadSchema("metrics.schema.json");
const sha = (text) => crypto.createHash("sha256").update(text).digest("hex");

function project({ ledger = true, progress = true, findings = true, calibration = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "metrics-"));
  fs.mkdirSync(path.join(dir, "docs/02-spec"), { recursive: true });
  fs.mkdirSync(path.join(dir, "docs/08-redteam/run-1"), { recursive: true });
  fs.mkdirSync(path.join(dir, "calibration"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "docs/02-spec/SPEC.md"),
    ["# Spec", "", "### REQ-001 a", "### REQ-002 b", "### NFR-001 c", "### SEC-001 d", ""].join("\n"),
  );
  if (ledger) {
    const rows = [
      { gate: "G0", status: "passed", command: "init", commandSource: "builtin", exitCode: 0 },
      { gate: "G1", status: "passed", command: "spec", commandSource: "builtin", exitCode: 0 },
      { gate: "G9", status: "NOT_VERIFIED", command: "x", commandSource: "manual", exitCode: 3 },
      { phase: "08", gate: "P08", status: "passed", command: "pipeline phase done 08", commandSource: "orchestrator", exitCode: 0 },
      // A re-run of G9 that passed afterwards: the last row must win.
      { gate: "G9", status: "passed", command: "x", commandSource: "manual", exitCode: 0 },
    ];
    // Appended through the real writer, so the chain verifies. A hand-rolled JSONL fixture
    // would be exactly the "edited ledger" that metrics-compute now refuses (G-15).
    for (const r of rows) appendLedger(path.join(dir, "docs/gate-ledger.jsonl"), r, { cwd: dir });
  }
  if (progress) {
    fs.writeFileSync(
      path.join(dir, "docs/progress.json"),
      JSON.stringify({
        schemaVersion: 1,
        pipelineVersion: "2.6.0",
        phase: "12",
        phases: { "08": { status: "done" }, "11": { status: "blocked" } },
        gates: { G0: { status: "passed", command: "init", commandSource: "builtin" }, G9: { status: "passed", command: "x", commandSource: "manual" } },
        rounds: { full: 1, diff: 0 },
        blockers: [],
      }),
    );
  }
  if (findings) {
    fs.writeFileSync(
      path.join(dir, "docs/08-redteam/run-1/findings.json"),
      JSON.stringify({
        run: "RUN-1",
        mode: "FULL",
        findings: [
          { id: "F-01", status: "confirmed", evidenceTier: "T1" },
          { id: "F-02", status: "needs_validation" },
          { id: "F-03", status: "rejected", evidenceTier: "T2" },
        ],
      }),
    );
  }
  if (calibration) {
    fs.writeFileSync(path.join(dir, "calibration/calibration.json"), JSON.stringify(calibration));
  }
  return dir;
}

const run = (dir, extra = []) =>
  spawnSync("node", [TOOL, "--progress", path.join(dir, "docs/progress.json"), "--ledger", path.join(dir, "docs/gate-ledger.jsonl"), "--findings", path.join(dir, "docs/08-redteam/run-1/findings.json"), "--calibration", path.join(dir, "calibration/calibration.json"), "--spec", path.join(dir, "docs/02-spec/SPEC.md"), "--out", path.join(dir, "docs/12-eval/metrics.json"), ...extra], { encoding: "utf8" });

test("computes the numbers from the evidence and satisfies the schema", () => {
  const dir = project();
  const res = run(dir);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const m = JSON.parse(fs.readFileSync(path.join(dir, "docs/12-eval/metrics.json"), "utf8"));
  assert.equal(m.computed, true);
  assert.equal(m.gates.total, 3, "G0, G1, G9 — the last row per gate wins");
  assert.equal(m.gates.passed, 3);
  assert.equal(m.gates.NOT_VERIFIED, 0, "a gate re-run to green is not still NOT_VERIFIED");
  assert.equal(m.counts.requirements, 4);
  assert.equal(m.counts.ledgerEntries, 5, "four gate rows plus the phase row");
  assert.equal(m.counts.notVerified, 0);
  assert.equal(m.redTeam.confirmed, 1);
  assert.equal(m.redTeam.needsValidation, 1);
  assert.equal(m.redTeam.rejected, 1);
  assert.equal(m.redTeam.fullRounds, 1);
  assert.equal(m.redTeam.byTier.T2, 1);
  assert.equal(m.phases["11"], "blocked");
  assert.equal(m.calibration.run, false);
  for (const key of ["ledger", "progress", "findings", "spec"]) assert.ok(m.derivedFrom[key], `derivedFrom.${key} missing`);
  assert.equal(m.derivedFrom.ledger.sha256, sha(fs.readFileSync(path.join(dir, "docs/gate-ledger.jsonl"), "utf8")));
  assert.deepEqual(validate(m, schema), [], "computed metrics must satisfy metrics.schema.json");
});

test("no ledger means no metrics: exit 3, not an empty file", () => {
  const dir = project({ ledger: false });
  const res = run(dir);
  assert.equal(res.status, 3);
  assert.match(res.stdout, /NOT_VERIFIED: no gate ledger/);
  assert.match(res.stdout, /human command: /);
  assert.equal(fs.existsSync(path.join(dir, "docs/12-eval/metrics.json")), false, "nothing may be written");
});

test("no progress file means no phases and no rounds: exit 3", () => {
  const dir = project({ progress: false });
  const res = run(dir);
  assert.equal(res.status, 3);
  assert.match(res.stdout, /no progress file/);
});

test("a missing findings file is reported as such, not as zero findings", () => {
  const dir = project({ findings: false });
  const res = run(dir);
  assert.equal(res.status, 0, "metrics without a red-team run are still metrics");
  const m = JSON.parse(fs.readFileSync(path.join(dir, "docs/12-eval/metrics.json"), "utf8"));
  assert.equal(m.redTeam, null, "null means 'not run', which is not the same as 'nothing found'");
  assert.equal(m.derivedFrom.findings, undefined);
});

test("calibration from another pipeline version is marked stale, not quoted as current", () => {
  const dir = project({ calibration: { pipelineVersion: "2.5.0", calibrated: true, recall: 0.92, planted: 12, requiredHits: 10 } });
  const res = run(dir);
  assert.equal(res.status, 0, res.stdout);
  const m = JSON.parse(fs.readFileSync(path.join(dir, "docs/12-eval/metrics.json"), "utf8"));
  assert.equal(m.calibration.run, true);
  assert.equal(m.calibration.stale, true);
  assert.match(m.calibration.reason, /measured on 2\.5\.0; this run is 2\.6\.0/);
  assert.deepEqual(validate(m, schema), []);
});

test("a hand-written metrics file is overwritten and can no longer pass as computed", () => {
  const dir = project();
  fs.mkdirSync(path.join(dir, "docs/12-eval"), { recursive: true });
  const file = path.join(dir, "docs/12-eval/metrics.json");
  fs.writeFileSync(file, JSON.stringify({ computed: false, pipelineVersion: "2.6.0", note: "numbers by hand" }));
  assert.equal(run(dir).status, 0);
  const m = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(m.computed, true);
  assert.notEqual(m.note, "numbers by hand");
  assert.ok(m.derivedFrom, "the computed file names its sources");
});

// ---------------------------------------------------------------------------
// P7 · 2.8.1 — the numbers come from a ledger that verifies (G-15)
// ---------------------------------------------------------------------------
test("an appended junk line makes the numbers NOT_VERIFIED instead of silently dropped", () => {
  const dir = project();
  assert.equal(run(dir).status, 0);
  fs.appendFileSync(path.join(dir, "docs/gate-ledger.jsonl"), 'garbage line not json\n');
  const res = run(dir);
  assert.equal(res.status, 3, res.stdout + res.stderr);
  assert.match(res.stdout, /the ledger does not verify/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// B-28: the counter used to read `^### (REQ|SEC|NFR)-\d+` and nothing else.
test("## headings and table rows are counted, once each", () => {
  const dir = project();
  fs.writeFileSync(
    path.join(dir, "docs/02-spec/SPEC.md"),
    [
      "# Spec",
      "",
      "## REQ-001 a member can add a link",
      "## **REQ-002** a member can delete one",
      "",
      "| id | statement |",
      "| --- | --- |",
      "| SEC-001 | a member cannot read another's link |",
      "| NFR-001 | p95 under 200 ms |",
      "| REQ-001 | repeated here; still one requirement |",
      "",
    ].join("\n"),
  );
  const res = run(dir);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const m = JSON.parse(fs.readFileSync(path.join(dir, "docs/12-eval/metrics.json"), "utf8"));
  assert.equal(m.counts.requirements, 4, JSON.stringify(m.counts.requirementIds));
  assert.deepEqual(m.counts.requirementIds, ["NFR-001", "REQ-001", "REQ-002", "SEC-001"]);
});

test("a spec the counter cannot read is NOT_VERIFIED, not zero requirements", () => {
  const dir = project();
  fs.writeFileSync(path.join(dir, "docs/02-spec/SPEC.md"), "# Spec\n\nWe will build a good product for members.\n");
  const res = run(dir);
  assert.equal(res.status, 3, res.stdout + res.stderr);
  assert.match(res.stdout, /NOT_VERIFIED: .*no REQ-\/SEC-\/NFR- ids/);
  assert.equal(fs.existsSync(path.join(dir, "docs/12-eval/metrics.json")), false, "no metrics file from an unreadable spec");
});
