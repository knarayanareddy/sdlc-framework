// P0 acceptance tests: the provenance floor.
//
// Every test here reproduces a bypass that worked at 420b560 and asserts it no longer
// does. These are the exit criteria for phase P0 of REVIEW-OF-SECOND-OPINION.md:
// a gate cannot be talked into passing, a phase cannot be entered out of order, a frozen
// spec cannot be edited, a truncated ledger cannot pass, and an edit that was committed
// is still visible.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { appendLedger, verifyLedger } from "./lib/ledger.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PIPELINE = path.resolve(HERE, "..");
const CLI = path.join(PIPELINE, "bin", "pipeline.mjs");
const sha256 = (s) => crypto.createHash("sha256").update(String(s), "utf8").digest("hex");

const git = (cwd, ...args) =>
  spawnSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...args], { cwd, encoding: "utf8" });
const cli = (cwd, args, env = {}) =>
  spawnSync("node", [CLI, ...args, "--cwd", cwd], { cwd, encoding: "utf8", env: { ...process.env, ...env } });
const tool = (cwd, file, args) => spawnSync("node", [path.join(HERE, file), ...args], { cwd, encoding: "utf8" });
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const progressOf = (dir) => readJson(path.join(dir, "docs", "progress.json"));

const SPEC = [
  "# SPEC",
  "",
  "### REQ-001 A member can add a link",
  "Priority: P0",
  "Statement: The system SHALL let a member add a link.",
  "Acceptance: Given a member When they post a link Then it appears in the list",
  "Test level: unit",
  "",
].join("\n");

function project(label = "p0") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${label}-`));
  git(dir, "init", "-q");
  fs.mkdirSync(path.join(dir, "docs", "02-spec"), { recursive: true });
  fs.mkdirSync(path.join(dir, "tests"), { recursive: true });
  fs.writeFileSync(path.join(dir, "docs", "02-spec", "SPEC.md"), SPEC);
  fs.writeFileSync(path.join(dir, "README.md"), `# example project\n\n${"filler line\n".repeat(8)}`);
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "base");
  const init = cli(dir, ["init"]);
  assert.equal(init.status, 0, `init failed:\n${init.stdout}${init.stderr}`);
  return dir;
}


// A file that is a document rather than 64 bytes of filler: one heading, something to read.
function designDoc(dir, rel = "docs/03-design/design-brief.md") {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    [
      "# Design brief",
      "",
      "For a small team that keeps a shared list. The register is quick and unglamorous: rows, ruled lines,",
      "a small square checkbox, no card grid. The signature element is the row itself, which stays in place",
      "while the title strikes through on mark-read, so REQ-001 costs no layout shift and SEC-001 stays visible.",
      "Banned defaults avoided: centred hero, three icon cards, purple gradient.",
      "",
    ].join("\n"),
  );
  return rel;
}

// A project initialised with a chosen environment, for the tests that are about the ledger key:
// `project()` inherits the caller's environment, and the demo runs with a key set.
function keyedProject(label, env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${label}-`));
  git(dir, "init", "-q");
  fs.mkdirSync(path.join(dir, "docs", "02-spec"), { recursive: true });
  fs.writeFileSync(path.join(dir, "docs", "02-spec", "SPEC.md"), SPEC);
  fs.writeFileSync(path.join(dir, "README.md"), "# x\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "base");
  const init = cli(dir, ["init"], env);
  assert.equal(init.status, 0, init.stdout + init.stderr);
  return dir;
}

function markPhasesDone(dir, ids) {
  const file = path.join(dir, "docs", "progress.json");
  const progress = readJson(file);
  progress.phases ??= {};
  for (const id of ids) progress.phases[id] = { status: "done", at: new Date().toISOString() };
  fs.writeFileSync(file, JSON.stringify(progress, null, 2));
}

// ---------------------------------------------------------------------------
// 1 · An agent-supplied command cannot certify a gate (review #1 · F-01)
// ---------------------------------------------------------------------------
test("gate --cmd is refused unless a human allowlisted the exact command", () => {
  const dir = project("cmd");
  const res = cli(dir, ["gate", "G7", "--cmd", "true"]);

  assert.equal(res.status, 3, `expected exit 3, got ${res.status}\n${res.stdout}${res.stderr}`);
  assert.match(res.stderr, /refusing to record G7 from an agent-supplied --cmd/);

  const gate = progressOf(dir).gates.G7;
  assert.equal(gate.status, "NOT_VERIFIED");
  assert.equal(gate.commandSource, "refused-agent-command");
  assert.ok(gate.humanCommand, "a refused command must still tell a human what to run");

  fs.rmSync(dir, { recursive: true, force: true });
});

test("the same command passes once a human commits its hash to the allowlist", () => {
  const dir = project("cmd-allow");
  const cmd = "node -e \"process.exit(0)\"";
  const file = path.join(dir, "docs", "00-control", "allowed-commands.json");
  fs.writeFileSync(file, JSON.stringify({ note: "test", sha256: { [sha256(cmd)]: cmd } }, null, 2));
  // The allowlist is a human artefact, so it has to be committed before it counts. Writing it
  // into the builder's working tree and pointing a flag at it was the 2.7.0 bypass (G-02).
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "human allowlists one command");

  const res = cli(dir, ["gate", "G7", "--cmd", cmd]);
  assert.equal(res.status, 0, `expected exit 0, got ${res.status}\n${res.stdout}${res.stderr}`);
  const gate = progressOf(dir).gates.G7;
  assert.equal(gate.status, "passed");
  assert.equal(gate.commandSource, "allowlisted");

  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// P7 · 2.7.1 — the two ways to certify a gate by typing (SECOND-OPINION-3 G-01, G-02, G-22)
// ---------------------------------------------------------------------------
test("--evidence cannot pass a command gate", () => {
  const dir = project("evidence-gate");
  // 9/9 gates, including G11, went green on 200 bytes of "a" at 2.7.0. Only G3 is a document.
  for (const g of ["G4", "G5", "G7", "G8", "G9", "G10", "G12"]) {
    const res = cli(dir, ["gate", g, "--evidence", "README.md"]);
    assert.notEqual(res.status, 0, `${g} accepted --evidence:\n${res.stdout}${res.stderr}`);
    assert.equal(progressOf(dir).gates[g], undefined, `${g} was recorded anyway`);
  }
  // G11 hits the human gate first: it records NOT_VERIFIED with a reason, never a pass.
  const human = cli(dir, ["gate", "G11", "--evidence", "README.md"]);
  assert.notEqual(human.status, 0);
  assert.equal(progressOf(dir).gates.G11.status, "NOT_VERIFIED");
  // G3 is the evidence gate, and it still works -- on a document, not on 64 bytes of filler.
  const doc = designDoc(dir);
  assert.equal(cli(dir, ["gate", "G3", "--evidence", doc]).status, 0);

  fs.rmSync(dir, { recursive: true, force: true });
});

test("a flag that moves the allowlist is refused, not ignored", () => {
  const dir = project("cmd-allow-flag");
  const cmd = "true";
  const file = path.join(dir, "al.json");
  fs.writeFileSync(file, JSON.stringify({ sha256: { [sha256(cmd)]: cmd } }, null, 2));

  const res = cli(dir, ["gate", "G7", "--cmd", cmd, "--allow-commands", file]);
  assert.notEqual(res.status, 0, `--allow-commands was honoured:\n${res.stdout}${res.stderr}`);
  assert.match(res.stderr, /--allow-commands was removed/);
  assert.notEqual(progressOf(dir).gates.G7?.status, "passed");

  fs.rmSync(dir, { recursive: true, force: true });
});

test("an uncommitted allowlist is not an allowlist", () => {
  const dir = project("cmd-allow-tree");
  const cmd = "node -e \"process.exit(0)\"";
  const file = path.join(dir, "docs", "00-control", "allowed-commands.json");
  fs.writeFileSync(file, JSON.stringify({ sha256: { [sha256(cmd)]: cmd } }, null, 2));

  const res = cli(dir, ["gate", "G7", "--cmd", cmd]);
  assert.equal(res.status, 3, `expected exit 3, got ${res.status}\n${res.stdout}${res.stderr}`);
  assert.match(res.stderr, /not committed/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test("G11 is closed by a named human, not by a file", () => {
  const dir = project("human-gate");

  const evidence = cli(dir, ["gate", "G11", "--evidence", "README.md"]);
  assert.notEqual(evidence.status, 0);
  assert.notEqual(progressOf(dir).gates.G11?.status, "passed");

  // A name without the human in the shell is the builder signing for itself.
  const named = cli(dir, ["gate", "G11", "--attested-by", "Ravi"]);
  assert.equal(named.status, 3, `expected exit 3, got ${named.status}\n${named.stdout}${named.stderr}`);
  assert.equal(progressOf(dir).gates.G11.status, "NOT_VERIFIED");
  assert.match(progressOf(dir).gates.G11.reason, /PIPELINE_HUMAN=1/);

  fs.rmSync(dir, { recursive: true, force: true });
});


// ---------------------------------------------------------------------------
// 2 · The phase table cannot be walked out of order (review #2 · F-03)
// ---------------------------------------------------------------------------
test("phase 05 cannot start before the spec is frozen", () => {
  const dir = project("graph-05");
  markPhasesDone(dir, ["00", "01", "02", "03", "04"]);

  const res = cli(dir, ["phase", "start", "05"]);
  assert.equal(res.status, 1, `expected exit 1, got ${res.status}\n${res.stdout}${res.stderr}`);
  assert.match(res.stderr, /phase FZ is not done/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test("phase 09 cannot start before the red team phase is done", () => {
  const dir = project("graph-09");
  markPhasesDone(dir, ["00", "01", "02", "03", "04", "FZ", "05", "06", "07"]);

  const res = cli(dir, ["phase", "start", "09"]);
  assert.equal(res.status, 1, `expected exit 1, got ${res.status}\n${res.stdout}${res.stderr}`);
  assert.match(res.stderr, /phase 08 is not done/);

  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 3 · A frozen spec cannot be re-frozen silently (review #2 · F-04)
// ---------------------------------------------------------------------------
test("freeze --refreeze without a change note fails", () => {
  const dir = project("refreeze");
  assert.equal(cli(dir, ["freeze"]).status, 0, "the first freeze should succeed");

  fs.appendFileSync(path.join(dir, "docs", "02-spec", "SPEC.md"), "\n### REQ-002 Sneaked in\n");
  const refused = cli(dir, ["freeze", "--refreeze"]);
  assert.equal(refused.status, 1, `expected exit 1, got ${refused.status}\n${refused.stdout}${refused.stderr}`);
  assert.match(refused.stderr, /CHANGES\.md/);

  fs.writeFileSync(
    path.join(dir, "docs", "02-spec", "CHANGES.md"),
    "# Spec change after freeze\n\n## What\nREQ-002 was added.\n\n## Why\nThe customer asked for it on 2026-11-26.\n",
  );
  const accepted = cli(dir, ["freeze", "--refreeze"]);
  assert.equal(accepted.status, 0, `expected exit 0 with a change note, got ${accepted.status}\n${accepted.stdout}${accepted.stderr}`);

  fs.rmSync(dir, { recursive: true, force: true });
});

test("editing the spec after freeze makes verify fail", () => {
  const dir = project("spec-drift");
  assert.equal(cli(dir, ["freeze"]).status, 0);
  fs.appendFileSync(path.join(dir, "docs", "02-spec", "SPEC.md"), "\n<!-- silent post-freeze edit -->\n");

  const res = cli(dir, ["verify"]);
  assert.equal(res.status, 1, `expected exit 1, got ${res.status}\n${res.stdout}${res.stderr}`);
  assert.match(res.stderr, /spec drift/);

  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 4 · A truncated ledger cannot pass (review #2 · D-01 tail truncation)
// ---------------------------------------------------------------------------
test("deleting the last ledger lines is caught against progress.json", () => {
  const dir = project("ledger");
  // G3 is the only evidence gate at 2.7.1; G4 is a command gate and refuses --evidence
  // (SECOND-OPINION-3 G-01), so the second gate is a real one: the ledger checking itself.
  assert.equal(cli(dir, ["gate", "G3", "--evidence", designDoc(dir)]).status, 0);
  assert.equal(cli(dir, ["gate", "G0", "--builtin", "ledger"]).status, 0);

  const ledger = path.join(dir, "docs", "gate-ledger.jsonl");
  const lines = fs.readFileSync(ledger, "utf8").trim().split("\n");
  fs.writeFileSync(ledger, `${lines.slice(0, -1).join("\n")}\n`);

  const res = tool(dir, "gate-ledger.mjs", ["verify", "--path", "docs/gate-ledger.jsonl", "--progress", "docs/progress.json"]);
  assert.equal(res.status, 1, `expected exit 1, got ${res.status}\n${res.stdout}${res.stderr}`);
  assert.match(res.stdout, /truncated|no ledger entry/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test("a corrupt ledger line is reported, not crashed on", () => {
  const dir = project("ledger-corrupt");
  const ledger = path.join(dir, "docs", "gate-ledger.jsonl");
  fs.appendFileSync(ledger, '{"seq":9,"partial":\n');

  const res = tool(dir, "gate-ledger.mjs", ["verify", "--path", "docs/gate-ledger.jsonl"]);
  assert.equal(res.status, 1, `expected exit 1, got ${res.status}`);
  assert.match(res.stdout, /not valid JSON/);
  assert.doesNotMatch(res.stdout + res.stderr, /SyntaxError/);

  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 5 · Committing your edits does not hide them (review #2 · F-14)
// ---------------------------------------------------------------------------
test("a committed edit to the orchestrator or the gate config is a violation", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tamper-"));
  git(dir, "init", "-q");
  fs.mkdirSync(path.join(dir, "pipeline", "bin"), { recursive: true });
  fs.writeFileSync(path.join(dir, "pipeline", "bin", "pipeline.mjs"), "// orchestrator\n");
  fs.writeFileSync(path.join(dir, "README.md"), `# example project\n\n${"filler line\n".repeat(8)}`);
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "base");

  assert.equal(cli(dir, ["init"]).status, 0, "init should succeed");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "control plane");

  // The builder weakens the unit command and edits the orchestrator, then commits both.
  const config = readJson(path.join(dir, "pipeline.config.json"));
  fs.writeFileSync(path.join(dir, "pipeline.config.json"), JSON.stringify({ ...config, commands: { ...config.commands, unit: "true" } }, null, 2));
  fs.appendFileSync(path.join(dir, "pipeline", "bin", "pipeline.mjs"), "\n// silently weakened\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "tamper");

  const res = tool(dir, "protected-paths.mjs", []);
  assert.equal(res.status, 1, `expected exit 1, got ${res.status}\n${res.stdout}${res.stderr}`);
  assert.match(res.stdout, /pipeline\/bin\/pipeline\.mjs/);
  assert.match(res.stdout, /pipeline\.config\.json/);

  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 6 · Portability (review #2 · F-20, review #1 · F-19)
// ---------------------------------------------------------------------------
test("no tool derives a path from URL.pathname, so spaces in the workspace are safe", () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".mjs") && /import\.meta\.url\)\.pathname/.test(fs.readFileSync(full, "utf8"))) offenders.push(full);
    }
  };
  walk(PIPELINE);
  assert.deepEqual(offenders, [], "these files still percent-encode the workspace path");
});

test("a copy of the pipeline in a directory with spaces runs", () => {
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "space-")), "my dir");
  fs.mkdirSync(root, { recursive: true });
  fs.cpSync(PIPELINE, path.join(root, "pipeline"), { recursive: true });

  const res = spawnSync("node", [path.join(root, "pipeline", "tools", "dast.mjs"), "plan"], { encoding: "utf8" });
  assert.equal(res.status, 0, `expected exit 0 from a spaced path, got ${res.status}\n${res.stdout}${res.stderr}`);
  assert.match(res.stdout, /pipeline-fuzz/);
});

// ---------------------------------------------------------------------------
// 12 · An evidence gate suggests something it can actually run (F-18)
// ---------------------------------------------------------------------------
test("gate G3 suggests the real evidence command, not --builtin manual", () => {
  const dir = project("g3");
  const res = cli(dir, ["gate", "G3", "--builtin", "manual"]);
  // `manual` resolves to nothing, so the gate must not run — but the hint has to be true.
  assert.notEqual(res.status, 0);
  assert.match(res.stdout, /is an evidence gate/);
  assert.match(res.stdout, /gate G3 --evidence docs\/03-design\/design-brief\.md/);
  assert.doesNotMatch(res.stdout, /Suggested: --builtin manual/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 13 · Independence cannot be recorded green against an unknown builder (F-02)
// ---------------------------------------------------------------------------
test("gate G9 is NOT_VERIFIED when independence.builderFamily is unknown", () => {
  const dir = project("indep");
  const res = cli(dir, ["gate", "G9", "--builtin", "independence", "--model", "gpt-5"]);
  // The tool used to say RESULT: PASS for "openai verified a unknown build", and the gate
  // recorded that as green. There is nothing to be independent of until the builder is named.
  assert.equal(res.status, 3, res.stdout + res.stderr);
  assert.match(res.stdout, /G9 NOT_VERIFIED/);
  const gate = progressOf(dir).gates.G9;
  assert.equal(gate.status, "NOT_VERIFIED");
  assert.equal(gate.exitCode, 3);
  assert.ok(gate.reason && /no independent verifier/.test(gate.reason), gate.reason);
  assert.match(String(gate.humanCommand), /--builder-family/, "the recorded human command must be runnable");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("with the builder declared, independence is judged and can pass", () => {
  const dir = project("indep2");
  const cfgFile = path.join(dir, "pipeline.config.json");
  const cfg = readJson(cfgFile);
  // A verifier from another family, recorded for the gate the tool requires.
  cfg.independence = { ...(cfg.independence ?? {}), builderFamily: "anthropic", requireFor: ["G7"] };
  fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
  appendLedger(path.join(dir, "docs", "gate-ledger.jsonl"), {
    phase: "07", gate: "G7", status: "passed", command: "true", exitCode: 0, commit: "abc1234", modelFamily: "gpt-5",
  });
  const res = cli(dir, ["gate", "G9", "--builtin", "independence", "--model", "gpt-5"]);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /G9 PASSED/);
  assert.equal(progressOf(dir).gates.G9.status, "passed");
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// P5 · The reported numbers come from the evidence, and the report is not stale
// ---------------------------------------------------------------------------
test("gate G12 computes metrics from the ledger instead of checking a file exists", () => {
  const dir = project("p5-metrics");
  // A hand-written metrics file used to satisfy G12. This one is a lie and must be replaced.
  fs.mkdirSync(path.join(dir, "docs", "12-eval"), { recursive: true });
  fs.writeFileSync(path.join(dir, "docs", "12-eval", "metrics.json"), JSON.stringify({ computed: false, pipelineVersion: "0.0.0", counts: { gates: 99 } }));

  const res = cli(dir, ["gate", "G12", "--builtin", "metrics"]);
  assert.equal(res.status, 0, `expected G12 to pass by computing metrics:\n${res.stdout}${res.stderr}`);
  const metrics = readJson(path.join(dir, "docs", "12-eval", "metrics.json"));
  assert.equal(metrics.computed, true);
  assert.ok(metrics.derivedFrom.ledger.sha256, "the ledger bytes the numbers came from must be named");
  assert.notEqual(metrics.counts.gates, 99, "the hand-written number must not survive");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("phase 12 rewrites FINAL-REPORT.md, so a report cannot describe an older ledger", () => {
  const dir = project("p5-report");
  // A report written before the later gates existed.
  fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
  fs.writeFileSync(path.join(dir, "docs", "FINAL-REPORT.md"), "# Final report\n\nstale: written when G0 was the only gate\n");

  assert.equal(cli(dir, ["gate", "G12", "--builtin", "metrics"]).status, 0);
  const progress = progressOf(dir);
  progress.phases["12"] = { status: "started", at: new Date().toISOString() };
  fs.writeFileSync(path.join(dir, "docs", "progress.json"), JSON.stringify(progress, null, 2));

  const done = cli(dir, ["phase", "done", "12"]);
  assert.equal(done.status, 0, `expected phase 12 to complete:\n${done.stdout}${done.stderr}`);
  const report = fs.readFileSync(path.join(dir, "docs", "FINAL-REPORT.md"), "utf8");
  assert.doesNotMatch(report, /stale: written when G0/, "the old report must be replaced, not appended to");
  assert.match(report, /- metrics: computed from /, "the report states where the metrics came from");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("phase 08 records the round the findings file says was run", () => {
  const dir = project("p5-rounds");
  fs.mkdirSync(path.join(dir, "docs", "08-redteam", "run-1"), { recursive: true });
  fs.writeFileSync(path.join(dir, "docs", "08-redteam", "run-1", "findings.json"), JSON.stringify({ run: "RUN-1", mode: "FULL", findings: [] }));
  // Phase 08's other done-checks still apply, and entrypoints is re-enumerated from source:
  // a route the ledger does not cover would fail the phase, so give the project one route.
  fs.mkdirSync(path.join(dir, "src/app/api/health"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src/app/api/health/route.ts"), "export async function GET() {\n  return new Response('ok');\n}\n");
  fs.writeFileSync(path.join(dir, "docs", "08-redteam", "run-1", "coverage-ledger.json"), JSON.stringify({ run: "RUN-1", mode: "FULL", units: [{ id: "route:GET /api/health", status: "examined", hunter: "H1" }] }));
  const progress = progressOf(dir);
  progress.phases["08"] = { status: "started", at: new Date().toISOString() };
  progress.gates.G8 = { status: "passed", command: "gate G8", exitCode: 0, at: new Date().toISOString() };
  fs.writeFileSync(path.join(dir, "docs", "progress.json"), JSON.stringify(progress, null, 2));

  const res = cli(dir, ["phase", "done", "08"]);
  assert.equal(res.status, 0, `expected phase 08 to complete:\n${res.stdout}${res.stderr}`);
  const after = progressOf(dir);
  assert.deepEqual(after.rounds, { full: 1, diff: 0 }, "rounds used to be a literal zero forever");
  assert.equal(after.roundLog.length, 1);
  assert.equal(after.roundLog[0].mode, "FULL");
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// P6 · `pipeline live` reports the environment, and does not invent a gate
// ---------------------------------------------------------------------------
test("pipeline live reports the four P6 items and its exit code follows the worst one", () => {
  const dir = project("p6-live");
  const res = cli(dir, ["live"]);
  // The host is not a fixture: a CI runner has docker, a laptop may not. What must hold either
  // way is that the exit code follows the report instead of always succeeding.
  assert.match(res.stdout, /P6 · live environment/);
  const report = readJson(path.join(dir, "docs", "13-live", "live-readiness.json"));
  assert.equal(report.items.length, 4);
  const allReady = report.items.every((i) => i.state === "ready");
  assert.equal(res.status, allReady ? 0 : 3, `exit ${res.status} with ${report.items.map((i) => `${i.id}=${i.state}`).join(" ")}`);
  assert.match(res.stdout, allReady ? /RESULT: PASS/ : /RESULT: NOT_VERIFIED/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a human can close G11, and the attestation lands in the hash chain", () => {
  const dir = project("human-gate-attested");
  const res = cli(dir, ["gate", "G11", "--attested-by", "Ravi"], { PIPELINE_HUMAN: "1" });
  assert.equal(res.status, 0, `expected exit 0, got ${res.status}\n${res.stdout}${res.stderr}`);

  const gate = progressOf(dir).gates.G11;
  assert.equal(gate.status, "passed");
  assert.equal(gate.commandSource, "human-attestation");
  assert.equal(gate.attestedBy, "Ravi");

  const ledger = fs.readFileSync(path.join(dir, "docs", "gate-ledger.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(ledger.at(-1).attestedBy, "Ravi", "the attestation must be in the entry, so it is covered by the hash");

  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// P7 · 2.7.2 — passed and verified have to mean something (G-03, G-04, G-05)
// ---------------------------------------------------------------------------
test("verify re-runs the ledger's command, and a tampered progress.json is drift", () => {
  const dir = project("verify-tamper");
  assert.equal(cli(dir, ["gate", "G7", "--builtin", "ledger"]).status, 0);

  const file = path.join(dir, "docs", "progress.json");
  const p = readJson(file);
  p.gates.G7.command = "true";
  fs.writeFileSync(file, JSON.stringify(p, null, 2));

  const r = cli(dir, ["verify"]);
  assert.equal(r.status, 1, `expected exit 1, got ${r.status}\n${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /progress\.json says the command was "true", the ledger says/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test("--force leaves the override in the ledger and the report", () => {
  const dir = project("force");
  // Nothing has been done, so this phase has every check against it.
  assert.equal(cli(dir, ["phase", "start", "12", "--force"]).status, 0);
  const done = cli(dir, ["phase", "done", "12", "--force"]);
  assert.equal(done.status, 0, done.stdout + done.stderr);

  const ledger = fs.readFileSync(path.join(dir, "docs", "gate-ledger.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  const rows = ledger.filter((e) => e.gate === "P12");
  assert.ok(rows.length >= 2, "starting and finishing a phase under --force must both be ledgered");
  assert.equal(rows.at(-1).status, "forced", "a forced completion is not `passed`");
  assert.ok(rows.at(-1).overridden.length > 0, "the checks it overrode must be recorded");
  assert.equal(rows[0].status, "forced", "a forced start used to leave no entry at all");

  const report = fs.readFileSync(path.join(dir, "docs", "FINAL-REPORT.md"), "utf8");
  assert.match(report, /## Forced/);
  assert.match(report, /did not pass; a human overrode/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test("a typed --model is not independence evidence", () => {
  const dir = project("independence");
  fs.writeFileSync(path.join(dir, "pipeline.config.json"), JSON.stringify({ independence: { builderFamily: "anthropic" } }));
  assert.equal(cli(dir, ["gate", "G7", "--builtin", "ledger", "--model", "gpt-5"]).status, 0);
  assert.equal(cli(dir, ["report"]).status, 0);

  const report = fs.readFileSync(path.join(dir, "docs", "FINAL-REPORT.md"), "utf8");
  // 2.7.0 said: "every judged gate (G7, G9) was verified by a model outside anthropic",
  // on the strength of this flag, with nothing dispatched.
  assert.doesNotMatch(report, /was verified by a model outside/);
  assert.match(report, /declared, not evidenced/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test("--verdict without a dispatch attestation is refused", () => {
  const dir = project("verdict-flag");
  const forged = path.join(dir, "verdict.json");
  fs.writeFileSync(forged, JSON.stringify({ model: "gpt-5", verdict: "confirmed" }));

  const r = cli(dir, ["gate", "G7", "--builtin", "ledger", "--verdict", forged]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /\.attest/);
  assert.notEqual(progressOf(dir).gates.G7?.status, "passed");

  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// P7 · 2.8.0 — a missing baseline is not permission to make a new one (G-08)
// ---------------------------------------------------------------------------
test("after phase 05, deleting the baseline does not re-freeze the weakened tests", () => {
  const dir = project("baseline");
  fs.writeFileSync(
    path.join(dir, "docs", "02-spec", "SPEC.md"),
    [
      "# SPEC",
      "",
      "### REQ-001 A member can add a link",
      "Priority: P0",
      "Statement: The system SHALL let a member add a link.",
      "Acceptance: Given a member When they post a link Then it appears in the list",
      "Test level: unit",
      "- Done-when: the unit tests for both cases pass.",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(dir, "tests", "a.test.mjs"),
    [
      "// @req REQ-001",
      'import { test } from "node:test";',
      'import assert from "node:assert/strict";',
      'test("a link can be added", () => { const n = 1; assert.equal(n, 1); });',
      'test("a link is listed", () => { const n = 2; assert.equal(n, 2); });',
      "",
    ].join("\n"),
  );
  const frozen = cli(dir, ["gate", "G5", "--builtin", "trace:freeze,trace:check"]);
  assert.equal(frozen.status, 0, frozen.stdout + frozen.stderr);

  markPhasesDone(dir, ["05"]);

  // Weakon the tests the way a builder would: drop a case, keep coverage.
  fs.writeFileSync(
    path.join(dir, "tests", "a.test.mjs"),
    [
      "// @req REQ-001",
      'import { test } from "node:test";',
      'import assert from "node:assert/strict";',
      'test("a link can be added", () => { const n = 1; assert.equal(n, 1); });',
      "",
    ].join("\n"),
  );
  assert.equal(cli(dir, ["gate", "G5", "--builtin", "trace:check"]).status, 1, "the baseline must catch the removed case");

  // The old bypass: delete the baseline, run the builtin that freezes one first.
  fs.rmSync(path.join(dir, "docs", "05-test", "baseline.json"), { force: true });
  const again = cli(dir, ["gate", "G5", "--builtin", "trace:freeze,trace:check"]);
  assert.equal(again.status, 1, `expected exit 1, got ${again.status}\n${again.stdout}${again.stderr}`);
  assert.match(again.stderr, /is missing and phase 05 is done/);
  assert.notEqual(progressOf(dir).gates.G5?.status, "passed");

  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 2.9.0 — trust anchors: the record says where it started and what it read
// ---------------------------------------------------------------------------
test("the genesis entry pins the base commit, and editing progress.json is caught", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anchors-"));
  const file = path.join(dir, "ledger.jsonl");
  appendLedger(file, { phase: "00", gate: "GENESIS", status: "passed", baseCommit: "abc1234" }, { cwd: dir, env: {} });

  assert.equal(verifyLedger(file, { progress: { baseCommit: "abc1234", gates: {} }, env: {} }).ok, true);
  const moved = verifyLedger(file, { progress: { baseCommit: "deadbee", gates: {} }, env: {} });
  assert.equal(moved.ok, false);
  assert.match(moved.error, /progress\.json says baseCommit deadbee, the genesis entry says abc1234/);

  // A ledger written before this existed cannot say which commit the run started from.
  const old = path.join(dir, "old.jsonl");
  appendLedger(old, { phase: "00", gate: "GENESIS", status: "passed" }, { cwd: dir, env: {} });
  const legacy = verifyLedger(old, { progress: { baseCommit: "abc1234", gates: {} }, env: {} });
  assert.equal(legacy.ok, false);
  assert.match(legacy.error, /genesis entry carries no baseCommit/);

  // No progress object: nothing to cross-check, the chain alone is fine.
  assert.equal(verifyLedger(old, { env: {} }).ok, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("an input a gate was judged on cannot be rewritten afterwards", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pins-"));
  const file = path.join(dir, "ledger.jsonl");
  const findings = path.join(dir, "findings.json");
  fs.writeFileSync(findings, '{"mode":"FULL","findings":[]}');
  const digest = crypto.createHash("sha256").update(fs.readFileSync(findings, "utf8"), "utf8").digest("hex");
  appendLedger(file, { phase: "08", gate: "G8", status: "passed", inputs: { "findings.json": digest } }, { cwd: dir, env: {} });

  assert.equal(verifyLedger(file, { progress: { gates: {} }, cwd: dir, env: {} }).ok, true);

  fs.writeFileSync(findings, '{"mode":"FULL","findings":[]} ');
  const r = verifyLedger(file, { progress: { gates: {} }, cwd: dir, env: {} });
  assert.equal(r.ok, false);
  assert.match(r.error, /findings\.json changed after the last gate that read it/);

  // A later gate that legitimately reads the new content re-pins it.
  const redigest = crypto.createHash("sha256").update(fs.readFileSync(findings, "utf8"), "utf8").digest("hex");
  appendLedger(file, { phase: "09", gate: "G9", status: "passed", inputs: { "findings.json": redigest } }, { cwd: dir, env: {} });
  assert.equal(verifyLedger(file, { progress: { gates: {} }, cwd: dir, env: {} }).ok, true);

  fs.rmSync(findings);
  const gone = verifyLedger(file, { progress: { gates: {} }, cwd: dir, env: {} });
  assert.equal(gone.ok, false);
  assert.match(gone.error, /was pinned by a gate and is now missing/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("G10 will not certify a ledger that carries no HMAC", () => {
  // `project()` inherits the environment, and the demo runs with a key: this test is about the
  // unkeyed case, so the whole project is created without one.
  const dir = keyedProject("g10-seal", { PIPELINE_LEDGER_KEY: "" });
  const r = cli(dir, ["gate", "G10", "--builtin", "progress"], { PIPELINE_LEDGER_KEY: "" });
  assert.equal(r.status, 3, r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /not sealed/);
  const recorded = progressOf(dir).gates.G10;
  assert.equal(recorded.status, "NOT_VERIFIED");
  assert.equal(recorded.commandSource, "unsealed-ledger");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("G10 certifies a sealed ledger", () => {
  const key = { PIPELINE_LEDGER_KEY: "a-key-the-agent-does-not-have" };
  const dir = keyedProject("g10-key", key);
  const r = cli(dir, ["gate", "G10", "--builtin", "progress"], key);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /ledger is HMAC-sealed/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a gate recorded after the report is written regenerates it (B-27)", () => {
  const dir = project("report-stale");
  assert.equal(cli(dir, ["report"]).status, 0);
  const before = fs.readFileSync(path.join(dir, "docs", "FINAL-REPORT.md"), "utf8");
  assert.doesNotMatch(before, /REPORT-STALE-MARKER/);

  const r = cli(dir, ["gate", "G12", "--not-verified", "--reason", "REPORT-STALE-MARKER: recorded after the report", "--human-command", "true"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const after = fs.readFileSync(path.join(dir, "docs", "FINAL-REPORT.md"), "utf8");
  assert.match(after, /REPORT-STALE-MARKER/, "the report still describes the ledger from before the gate");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("verify --check does not re-run a command that writes files", () => {
  const dir = project("verify-check");
  // G12's metrics command rewrites docs/12-eval/metrics.json. It is an output, so it is not
  // pinned in the ledger: a re-run changes it, which is exactly what --check must not do.
  assert.equal(cli(dir, ["gate", "G12", "--builtin", "metrics"]).status, 0);
  const metricsFile = path.join(dir, "docs/12-eval/metrics.json");
  assert.ok(fs.existsSync(metricsFile));
  fs.writeFileSync(metricsFile, '{"hand":"edited"}');

  const checked = cli(dir, ["verify", "--check"]);
  assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  assert.match(checked.stdout, /not re-run: the command writes files/);
  assert.equal(fs.readFileSync(metricsFile, "utf8"), '{"hand":"edited"}', "the read-only check left the file alone");

  const plain = cli(dir, ["verify"]);
  assert.equal(plain.status, 0, plain.stdout + plain.stderr);
  assert.notEqual(fs.readFileSync(metricsFile, "utf8"), '{"hand":"edited"}', "the plain verify re-ran the command");
  fs.rmSync(dir, { recursive: true, force: true });
});
