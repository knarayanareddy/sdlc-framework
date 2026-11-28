#!/usr/bin/env node
// The v2 build orchestrator. It does not write product code and it does not decide
// whether a gate passed: it runs the gate's command itself, records the exit code,
// and appends a hash-chained ledger entry.
//
//   node pipeline/bin/pipeline.mjs init | status | next | report | live
//   node pipeline/bin/pipeline.mjs gate G5 --builtin trace:check,unit
//   node pipeline/bin/pipeline.mjs gate G7 --not-verified --reason "no browser" --human-command "npx playwright test"
//   node pipeline/bin/pipeline.mjs verify            # re-run every recorded gate
//   node pipeline/bin/pipeline.mjs verify --check    # the same, without re-running anything that writes
//   node pipeline/bin/pipeline.mjs phase start 06
//   node pipeline/bin/pipeline.mjs phase done 05
//   node pipeline/bin/pipeline.mjs freeze --refreeze
//   node pipeline/bin/pipeline.mjs blocker add --phase 06 --text "..." --fallback "..."
import fs from "node:fs";
import path from "node:path";
import { recordRound as recordRoundFromFile } from "../tools/lib/rounds.mjs";
import { fileURLToPath } from "node:url";
import {
  parseArgs,
  readJson,
  writeJson,
  run,
  ensureDir,
  substantialFile,
  paint,
  ok,
  warn,
  fail,
  sha256,
} from "../tools/lib/common.mjs";
import { appendLedger, readLedger, verifyLedger } from "../tools/lib/ledger.mjs";
import { GATE_IDS, STATUSES, PHASES, GATE_SUGGESTIONS, EVIDENCE_GATES, HUMAN_GATES, phase as getPhase, nextPhase } from "../tools/lib/gates.mjs";
import { familyOf } from "../tools/lib/families.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PIPELINE_DIR = path.resolve(HERE, "..");
const TOOLS_DIR = path.join(PIPELINE_DIR, "tools");

const { flags, positional } = parseArgs();
const [command = "status", ...rest] = positional;

// ---------------------------------------------------------------------------
// Project resolution
// ---------------------------------------------------------------------------
const projectRoot = path.resolve(flags.cwd ?? process.cwd());

// The version lives in pipeline/VERSION and is read, not retyped: a literal here drifted from
// the file and every document quoted whichever it happened to see (SECOND-OPINION-3 G-23).
const PIPELINE_VERSION = fs.readFileSync(path.join(PIPELINE_DIR, "VERSION"), "utf8").trim();

const DEFAULTS = {
  configPath: "pipeline.config.json",
  pipelineVersion: PIPELINE_VERSION,
  spec: "docs/02-spec/SPEC.md",
  specHash: "docs/02-spec/SPEC.sha256",
  tests: "tests",
  baseline: "docs/05-test/baseline.json",
  progress: "docs/progress.json",
  ledger: "docs/gate-ledger.jsonl",
  evidenceLedger: "docs/01-research/evidence-ledger.md",
  researchExtracts: "docs/01-research/extracts",
  researchSnapshots: "docs/01-research/snapshots",
  quoteLog: "docs/01-research/quote-verify.log",
  digest: "docs/02-spec/DECISIONS.md",
  specChanges: "docs/02-spec/CHANGES.md",
  entrypoints: "docs/08-redteam/run-1/entrypoints.json",
  coverageLedger: "docs/08-redteam/run-1/coverage-ledger.json",
  findings: "docs/08-redteam/run-1/findings.json",
  finalReport: "docs/FINAL-REPORT.md",
  evalDir: "docs/12-eval",
  apiContract: "api-contract.json",
  fuzzBase: "http://127.0.0.1:3000",
  sandboxProfile: "docker-compose.sandbox.yml",
  calibrationDir: "calibration",
  threatModel: "docs/04-architecture/threat-model.md",
  authzMatrix: "docs/04-architecture/authz-matrix.md",
  slicesGlob: "docs/06-build/slice-*.md",
  independence: { builderFamily: "unknown", requireFor: ["G7", "G9", "G12"] },
  blockers: "docs/blockers.md",
  commands: {
    types: "npx tsc --noEmit",
    lint: "npx eslint .",
    unit: "npx vitest run",
    build: "npm run build",
    e2e: "npx playwright test",
    a11y: "npx playwright test --grep @a11y",
    mutation: "npx stryker run",
    sast: "semgrep --config p/owasp-top-ten --error",
    secrets: "gitleaks detect --no-banner",
    deps: "osv-scanner --lockfile package-lock.json",
  },
};

function loadConfig() {
  const file = path.resolve(projectRoot, flags.config ?? "pipeline.config.json");
  const user = fs.existsSync(file) ? readJson(file) : {};
  return {
    cfg: {
      ...DEFAULTS,
      ...user,
      commands: { ...DEFAULTS.commands, ...(user.commands ?? {}) },
      configPath: path.relative(projectRoot, file) || file,
    },
    file,
    user,
  };
}

const { cfg } = loadConfig();
// `speccChanges` was a typo in 2.1.0. Keep reading it so an existing pipeline.config.json
// (and a spec written against it) does not silently lose its change-note path.
if (!cfg.specChanges && cfg.speccChanges) cfg.specChanges = cfg.speccChanges;
const abs = (rel) => path.resolve(projectRoot, rel);
const toolsRel = path.relative(projectRoot, TOOLS_DIR).split(path.sep).join("/") || ".";
const tool = (file) => `${toolsRel}/${file}`;
const q = (s) => (/\s/.test(s) ? `"${s}"` : s);

const readProgress = () =>
  readJson(abs(cfg.progress), {
    schemaVersion: 2,
    pipelineVersion: cfg.pipelineVersion,
    phase: null,
    gates: {},
    phases: {},
    blockers: [],
    rounds: { full: 0, diff: 0 },
    notVerified: [],
  });

// docs/12-eval/metrics.json is a snapshot of progress, ledger, findings, spec and calibration, so
// writing progress makes the snapshot out of date by definition. Recompute it here rather than
// leave a file that `verify` would call stale the moment the orchestrator wrote anything (B-26).
// A file that is stale is then stale for the reason the check exists: something changed it from
// outside the orchestrator.
let refreshingMetrics = false;
function refreshMetrics() {
  if (refreshingMetrics) return;
  const file = abs(path.join(cfg.evalDir, "metrics.json"));
  if (!fs.existsSync(file)) return;
  refreshingMetrics = true;
  try {
    const res = run(builtin("metrics"), { cwd: projectRoot, timeout: 300_000 });
    if (res.code !== 0) warn(`could not refresh ${cfg.evalDir}/metrics.json: ${tail(res.stdout || res.stderr, 2)}`);
  } finally {
    refreshingMetrics = false;
  }
}

const writeProgress = (p) => {
  p.updatedAt = new Date().toISOString();
  writeJson(abs(cfg.progress), p);
  refreshMetrics();
};

function commitSha() {
  const res = run("git rev-parse --short HEAD", { cwd: projectRoot });
  return res.code === 0 ? res.stdout.trim() : null;
}

// Map a builtin name to the exact shell command it stands for, so that `verify`
// can re-run the same thing later.
function builtin(name) {
  const c = cfg;
  switch (name) {
    case "manual":
      return null;
    case "types":
    case "lint":
    case "unit":
    case "build":
    case "e2e":
    case "a11y":
    case "mutation":
    case "sast":
    case "secrets":
    case "deps":
    case "dast":
      return c.commands[name];
    case "trace:structure":
      return `node ${tool("trace-check-v2.mjs")} ${c.spec} ${c.tests} --allow-uncovered`;
    case "trace:freeze":
      return `node ${tool("trace-check-v2.mjs")} ${c.spec} ${c.tests} --allow-uncovered --baseline ${c.baseline}`;
    case "trace:check":
      // No --allow-uncovered here: `trace:check` is the gate that claims requirements are
      // tested. It was passing with 2 of 5 requirements untested (REVIEW-OF-SECOND-OPINION.md
      // §14, F-03). Only trace:structure (pre-test) and trace:freeze (which writes the
      // baseline) may run structurally.
      return `node ${tool("trace-check-v2.mjs")} ${c.spec} ${c.tests} --check-baseline ${c.baseline}`;
    case "quotes":
      return `node ${tool("quote-verify.mjs")} --extracts ${c.researchExtracts} --snapshots ${c.researchSnapshots} --log ${c.quoteLog} --write-ledger ${c.evidenceLedger}${c.fetchQuotes ? " --fetch" : ""}`;
    case "entrypoints":
      // --stable: the file a gate is judged on is pinned by digest, so it may not change when
      // nothing about the app changed (a timestamp in it made every pin drift).
      return `node ${tool("entrypoints.mjs")} --root . --out ${c.entrypoints} --stable`;
    case "coverage":
      return `node ${tool("coverage-gate.mjs")} --entrypoints ${c.entrypoints} --ledger ${c.coverageLedger}`;
    case "findings":
      return `node ${tool("validate-findings.mjs")} ${c.findings}`;
    case "progress":
      return `node ${tool("validate-progress.mjs")} ${c.progress}`;
    case "ledger":
      return `node ${tool("gate-ledger.mjs")} verify --path ${c.ledger} --progress ${c.progress}`;
    case "protected":
      return `node ${tool("protected-paths.mjs")} --config ${c.configPath}`;
    case "protected:strict":
      // At release the orchestrator-owned files are checked against the ledger, not waved
      // through as warnings (B-34).
      return `node ${tool("protected-paths.mjs")} --config ${c.configPath} --strict --ledger ${c.ledger}`;
    case "tripwire":
      return `node ${tool("tripwire.mjs")} --config ${c.configPath}`;
    case "selftests":
      return `node ${tool("run-selftests.mjs")}`;
    case "digest":
      return `node ${tool("expect-files.mjs")} ${c.digest}`;
    case "metrics":
      // Computed from the ledger, not checked for existence: a hand-written metrics.json used
      // to satisfy this gate (REVIEW-OF-SECOND-OPINION.md §7 P5).
      return `node ${tool("metrics-compute.mjs")} --progress ${c.progress} --ledger ${c.ledger} --findings ${c.findings} --calibration ${c.calibrationDir}/calibration.json --spec ${c.spec} --out ${c.evalDir}/metrics.json`;
    case "release":
      return `node ${tool("expect-files.mjs")} ${c.finalReport} README.md .env.example`;
    case "slices":
      return `node ${tool("expect-files.mjs")} --glob "${c.slicesGlob}" --substance --require-id`;
    case "plan":
      // Substance, not existence: does the plan agree with itself? G4 cannot see slice logs
      // (they do not exist until phase 06), so slices are required by `plan:slices` instead.
      return `node ${tool("plan-check.mjs")} --spec ${c.spec} --threat-model ${c.threatModel} --authz-matrix ${c.authzMatrix} --entrypoints ${c.entrypoints}`;
    case "plan:slices":
      return `node ${tool("plan-check.mjs")} --spec ${c.spec} --threat-model ${c.threatModel} --authz-matrix ${c.authzMatrix} --entrypoints ${c.entrypoints} --slices "${c.slicesGlob}" --require threat,authz,slices`;
    case "independence":
      return `node ${tool("independence.mjs")} --ledger ${c.ledger} --config ${c.configPath}`;
    case "fuzz": {
      const floor = `${path.posix.dirname(String(c.entrypoints).replace(/\\/g, "/"))}/floor`;
      return `node ${tool("fuzz-api.mjs")} --contract ${c.apiContract} --base ${c.fuzzBase} --out ${floor}/fuzz.json`;
    }
    case "sandbox":
      return `node ${tool("sandbox.mjs")} verify --file ${c.sandboxProfile}`;
    case "dast": {
      // The old default was `npx @zaproxy/zap-cli quick-scan`, and that package returns 404 on
      // npm: a documented builtin that could not run (SECOND-OPINION-3 G-16). The real one is
      // the repo's own harness, which exits 3 when no scanner produced a fresh artifact.
      const target = cfg.dastTarget ?? process.env.PIPELINE_DAST_TARGET ?? "";
      const dir = path.posix.dirname(String(c.entrypoints).replace(/\\/g, "/"));
      return `node ${tool("dast.mjs")} run${target ? ` --target ${JSON.stringify(target)}` : ""} --require-all-tools --out ${dir}/floor`;
    }
    case "calibrate":
      return `node ${tool("calibrate.mjs")} status --dir ${c.calibrationDir}`;
    default:
      fail(`unknown builtin "${name}". Known: ${BUILTINS.join(", ")}`);
  }
}

const BUILTINS = [
  "types", "lint", "unit", "build", "e2e", "a11y", "mutation", "sast", "secrets", "deps", "dast",
  "trace:structure", "trace:freeze", "trace:check", "quotes", "entrypoints", "coverage", "findings",
  "progress", "ledger", "protected", "tripwire", "selftests",
  "digest", "metrics", "release", "slices", "plan", "plan:slices", "protected:strict",
  "independence", "fuzz", "sandbox", "calibrate",
];

// Artifact checks used by `phase done` where no single command can judge the work.
const ARTIFACTS = {
  digest: [{ path: () => cfg.digest, label: "Decision Digest" }],
  // Was a hard-coded docs/06-build/slice-*.md while `plan:slices` used cfg.slicesGlob, so a
  // configured glob checked two different sets of files (SECOND-OPINION-3 G-23).
  slices: [{ glob: () => cfg.slicesGlob, label: "at least one slice log" }],
  release: [
    { path: () => cfg.finalReport, label: "FINAL-REPORT.md" },
    { path: () => "README.md", label: "README.md" },
    { path: () => ".env.example", label: ".env.example" },
  ],
  metrics: [{ path: () => `${cfg.evalDir}/metrics.json`, label: "metrics.json" }],
};

function checkArtifacts(name) {
  const checks = ARTIFACTS[name] ?? [];
  const problems = [];
  for (const check of checks) {
    if (check.glob) {
      const pattern = typeof check.glob === "function" ? check.glob() : check.glob;
      const dir = abs(path.dirname(pattern));
      const base = path.basename(pattern);
      const star = base.indexOf("*");
      const prefix = star === -1 ? base : base.slice(0, star);
      const suffix = star === -1 ? "" : base.slice(star + 1);
      const hits = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith(suffix)) : [];
      if (hits.length === 0) problems.push(`missing ${check.label} (${pattern})`);
      continue;
    }
    const rel = check.path();
    if (!substantialFile(abs(rel))) problems.push(`missing or empty ${check.label} (${rel})`);
  }
  return problems;
}

// A gate is a command result, not an opinion — including when the command is one the
// caller chose. `--cmd` used to record `passed` for whatever it was given (`--cmd true`),
// which makes every gate advisory. Now an agent-supplied command is refused unless a
// human has allowlisted its hash in a protected control file.
const ALLOWLIST = "docs/00-control/allowed-commands.json";

// The allowlist is a human artefact, so it is read from the base commit and never from the
// working tree. It used to be read from the tree *with a flag that named a different file*,
// which meant the same command line that supplied `--cmd` could also supply the approval
// (SECOND-OPINION-3 G-02). Both routes are gone: no flag, no tree.
function allowlist() {
  const base = readProgress().baseCommit;
  const fromBase = base ? run(`git show ${base}:${ALLOWLIST}`, { cwd: projectRoot }) : { code: 1, stdout: "" };
  let body = fromBase.code === 0 ? fromBase.stdout : null;
  let warning = null;
  if (body === null) {
    // A human may allowlist a command after `init`. That is allowed, but it has to be a commit:
    // the working tree is the builder's, and a path the caller names is not an approval.
    const head = run(`git show HEAD:${ALLOWLIST}`, { cwd: projectRoot });
    if (head.code !== 0) {
      return {
        entries: {},
        error: base
          ? `${ALLOWLIST} is not committed (missing from ${base} and from HEAD)`
          : `no base commit is recorded and ${ALLOWLIST} is not committed`,
      };
    }
    body = head.stdout;
    warning = `${ALLOWLIST} is newer than the base commit ${base ?? "(none)"}; it is read from HEAD because it is committed`;
  }
  try {
    return { entries: JSON.parse(body).sha256 ?? {}, error: null, warning };
  } catch {
    return { entries: {}, error: `${ALLOWLIST} is not valid JSON` };
  }
}

function allowlisted(cmd) {
  return Boolean(allowlist().entries[sha256(cmd)]);
}

// The spec hash is only worth writing if something reads it. This is the reader.
function specDrift() {
  const specFile = abs(cfg.spec);
  const hashFile = abs(cfg.specHash);
  if (!fs.existsSync(hashFile)) return null;
  const frozen = fs.readFileSync(hashFile, "utf8").trim().split(/\s+/)[0];
  if (!fs.existsSync(specFile)) return `${cfg.specHash} exists but ${cfg.spec} does not`;
  const now = sha256(fs.readFileSync(specFile, "utf8"));
  if (frozen === now) return null;
  return `the spec changed after it was frozen (frozen ${frozen.slice(0, 12)}…, now ${now.slice(0, 12)}…). Write ${cfg.specChanges}, then: node pipeline/bin/pipeline.mjs freeze --refreeze`;
}

function doFreeze({ refreeze = false } = {}) {
  const specFile = abs(cfg.spec);
  if (!fs.existsSync(specFile)) fail(`cannot freeze: ${cfg.spec} does not exist`);
  const hash = sha256(fs.readFileSync(specFile, "utf8"));
  const hashFile = abs(cfg.specHash);
  const previous = fs.existsSync(hashFile) ? fs.readFileSync(hashFile, "utf8").trim().split(/\s+/)[0] : null;

  if (previous === hash) {
    ok(`spec already frozen at ${hash.slice(0, 12)}…`);
    return { changed: false, hash };
  }
  if (previous && previous !== hash) {
    // The change note is required on BOTH paths. `--refreeze` is the documented way to
    // accept a spec change, which made it the documented way to skip this check.
    const hasChangeNote = substantialFile(abs(cfg.specChanges), 40);
    console.error(paint.red(`spec changed after freeze`));
    console.error(`  frozen:  ${previous.slice(0, 12)}…`);
    console.error(`  current: ${hash.slice(0, 12)}…`);
    if (!hasChangeNote) {
      console.error(paint.red(`  ${cfg.specChanges} is missing or under 40 bytes`));
      console.error(`Write what changed and why, then re-run: node pipeline/bin/pipeline.mjs freeze --refreeze`);
      process.exit(1);
    }
    if (!refreeze) {
      console.error(`  ${cfg.specChanges} is present. Accept the change with: node pipeline/bin/pipeline.mjs freeze --refreeze`);
      process.exit(1);
    }
    warn(`re-freezing with a change note in ${cfg.specChanges}`);
  }
  ensureDir(path.dirname(hashFile));
  fs.writeFileSync(hashFile, `${hash}  ${path.basename(cfg.spec)}\n`);
  ok(`spec frozen: ${hash.slice(0, 12)}… → ${cfg.specHash}${previous ? " (re-frozen)" : ""}`);
  return { changed: true, hash };
}

function tail(text, lines = 12) {
  const parts = text.trim().split("\n");
  return parts.slice(-lines).join("\n");
}

// Files a gate decides on. They are hashed when the gate is recorded and re-hashed by `verify`:
// the *newest* pin per file wins, so a later gate that legitimately rewrites findings.json
// re-pins it, while a rewrite after the last gate that read it is drift (2.9.0 trust anchors).
// pipeline.config.json is deliberately NOT here: it is a protected path whose edits are reported,
// and the orchestrator itself tells the operator to edit independence.builderFamily after init.
const PINNED_INPUTS = [
  "entrypoints",
  "coverageLedger",
  "findings",
  "apiContract",
  "threatModel",
  "authzMatrix",
  "calibrationDir",
  "baseline",
  "specHash",
];
function pinInputs() {
  const pins = {};
  for (const key of PINNED_INPUTS) {
    const rel = cfg[key];
    if (!rel) continue;
    const file = abs(key === "calibrationDir" ? path.join(rel, "calibration.json") : rel);
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) continue;
    pins[key === "calibrationDir" ? path.join(rel, "calibration.json") : rel] = sha256(fs.readFileSync(file, "utf8"));
  }
  return Object.keys(pins).length ? pins : null;
}

function recordGate(gate, entry, extra = {}) {
  const progress = readProgress();
  const commandSource =
    entry.commandSource ?? (entry.command ? "builtin" : entry.evidence ? "evidence" : "manual");
  const attestedBy =
    entry.attestedBy ?? (HUMAN_GATES.includes(gate) && flags["attested-by"] ? String(flags["attested-by"]) : null);
  const verdict = attestedVerdict();
  progress.gates[gate] = {
    status: entry.status,
    command: entry.command ?? null,
    commandSource,
    evidence: entry.evidence ?? null,
    exitCode: entry.exitCode ?? null,
    reason: entry.reason ?? null,
    humanCommand: entry.humanCommand ?? null,
    attestedBy,
    verdictSha256: verdict?.sha256 ?? null,
    at: new Date().toISOString(),
    commit: commitSha(),
    ...extra,
  };
  // Any gate recorded after the report was written leaves it describing the previous ledger
  // (B-27). Regenerate it here rather than asking the operator to remember `pipeline report`.
  const reportExisted = fs.existsSync(abs(cfg.finalReport));
  if (!progress.gates[gate].command && !progress.gates[gate].evidence && entry.status === "passed") {
    progress.gates[gate].explicitApproval = true;
  }
  writeProgress(progress);
  appendLedger(
    abs(cfg.ledger),
    {
      phase: progress.phase,
      gate,
      status: entry.status,
      command: entry.command ?? null,
      commandSource,
      exitCode: entry.exitCode ?? null,
      commit: commitSha(),
      evidence: entry.evidence ?? null,
      filesGivenToVerifier: flags.files ? String(flags.files).split(",").map((s) => s.trim()) : null,
      modelFamily: flags.model ?? verdict?.model ?? null,
      attestedBy,
      verdictSha256: verdict?.sha256 ?? null,
      inputs: pinInputs(),
    },
    { cwd: projectRoot },
  );
  if (reportExisted) writeReport({ quiet: true });
  // A gate appends to the ledger, so the metrics snapshot is one row out of date: refresh it.
  refreshMetrics();
}

// A verdict is evidence of independence only when `verifier-route dispatch` produced it. The
// attestation proves the transport ran and that this file is the one it returned; it does not
// prove which model answered, and the report says so (SECOND-OPINION-3 G-05/G-06).
let verdictCache;
function attestedVerdict() {
  if (verdictCache !== undefined) return verdictCache;
  verdictCache = null;
  if (!flags.verdict) return null;
  const file = abs(String(flags.verdict));
  const attestFile = `${file}.attest`;
  if (!fs.existsSync(file)) fail(`--verdict ${flags.verdict} does not exist`);
  if (!fs.existsSync(attestFile)) {
    fail(
      `--verdict ${flags.verdict} has no ${path.basename(attestFile)}: it was not produced by \`verifier-route dispatch\`, so a typed flag is all it would prove`,
    );
  }
  const body = fs.readFileSync(file, "utf8");
  const digest = sha256(body);
  const attest = readJson(attestFile);
  if (attest.verdictSha256 !== digest) fail(`${attestFile} is for a different verdict (sha256 mismatch)`);
  let verdict = {};
  try {
    verdict = JSON.parse(body);
  } catch {
    fail(`${flags.verdict} is not JSON`);
  }
  verdictCache = { sha256: digest, at: attest.at ?? null, transport: attest.transport ?? null, model: verdict.model ?? null, family: verdict.family ?? null };
  console.log(paint.dim(`verdict ${digest.slice(0, 12)}… attested by dispatch${attest.at ? ` at ${attest.at}` : ""}`));
  return verdictCache;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------
// `report` is a function because it is now called from two places: the command, and the
// end of phases 10-12, where a stale FINAL-REPORT.md is worse than none (REVIEW-OF-SECOND-OPINION.md P5).
// `progress.rounds` is derived from the findings file, not typed (see lib/rounds.mjs).
// B-26: re-hash what docs/12-eval/metrics.json says it was computed from. Returns the list of
// problems (empty when fresh), or null when there is no computed file to check.
function metricsStaleness() {
  const file = abs(path.join(cfg.evalDir, "metrics.json"));
  if (!fs.existsSync(file)) return null;
  let doc;
  try {
    doc = readJson(file);
  } catch {
    return ["the file is not valid JSON"];
  }
  if (doc.computed !== true || !doc.derivedFrom) return ["the file was not computed by metrics-compute"];
  const problems = [];
  for (const [key, src] of Object.entries(doc.derivedFrom)) {
    // `derivedFrom` paths are relative to the project root; verify may run from elsewhere.
    const srcFile = src?.path ? abs(src.path) : null;
    if (!srcFile) problems.push(`${key}: no path recorded`);
    else if (!fs.existsSync(srcFile)) problems.push(`${key}: ${src.path} is gone`);
    else if (sha256(fs.readFileSync(srcFile, "utf8")) !== src.sha256) problems.push(`${key}: ${src.path} changed since the metrics were computed`);
  }
  return problems;
}

// Commands recorded in the ledger that write to the tree when re-run.
const READS_ONLY_UNSAFE = /(entrypoints\.mjs|dast\.mjs run|metrics-compute\.mjs|calibrate\.mjs (plan|score|template)|tripwire\.mjs|freeze)/;

function recordRound(progress, phaseId) {
  const before = JSON.stringify(progress.rounds ?? null);
  // A FULL round is a coverage claim, so it is checked against the coverage ledger rather than
  // taken from the findings file (G-13).
  const coverage = run(builtin("coverage"), { cwd: projectRoot, timeout: 900_000 });
  const after = recordRoundFromFile(progress, phaseId, abs(cfg.findings), { coverageVerified: coverage.code === 0 });
  if (!after) return;
  if (before !== JSON.stringify(after.rounds)) {
    console.log(paint.dim(`rounds recorded from ${cfg.findings}: FULL=${after.rounds.full} DIFF=${after.rounds.diff}`));
    const last = (after.roundLog ?? []).at(-1);
    if (last?.note) warn(`round ${phaseId}: ${last.note}`);
  }
}

function writeReport({ quiet = false } = {}) {
  const progress = readProgress();
  const ledger = verifyLedger(abs(cfg.ledger));
  let entries = [];
  try {
    entries = readLedger(abs(cfg.ledger));
  } catch (error) {
    warn(`ledger unreadable, report will treat it as empty: ${error.message}`);
  }
  const specFileAbs = abs(cfg.spec);
  const hashFileAbs = abs(cfg.specHash);
  const specProblemReport = specDrift();
  const specLine = !fs.existsSync(hashFileAbs)
    ? "**not frozen** — `pipeline freeze` has not run"
    : specProblemReport
      ? `**DRIFT** — ${specProblemReport}`
      : `frozen at ${fs.readFileSync(hashFileAbs, "utf8").trim().split(/\s+/)[0].slice(0, 12)}…`;
  const gateRows = GATE_IDS.map((id) => {
    const g = progress.gates[id];
    if (!g) return `| ${id} | not evaluated | — | — | — |`;
    const status = g.status === "passed" ? "passed" : g.status === "failed" ? "**failed**" : "NOT_VERIFIED";
    const cmd = g.command ? `\`${g.command.replace(/\|/g, "\\|")}\`` : g.evidence ? `evidence: ${g.evidence.join(", ")}` : "explicit approval";
    return `| ${id} | ${status} | ${g.exitCode ?? "—"} | ${cmd} | ${g.at ?? "—"} |`;
  });
  const notVerified = Object.entries(progress.gates).filter(([, g]) => g.status === "NOT_VERIFIED");
  const estimateFile = abs(path.join(cfg.evalDir, "estimate.json"));
  const estimate = fs.existsSync(estimateFile) ? readJson(estimateFile) : null;

  // Calibration and independence are the two claims a reader is most likely to over-read.
  const calibFile = path.join(cfg.calibrationDir, "calibration.json");
  const calib = fs.existsSync(abs(calibFile)) ? readJson(abs(calibFile)) : null;
  const calibrationLine = !calib
    ? `**not run** for ${cfg.pipelineVersion} — a zero-finding round is not evidence of a clean codebase (\`node pipeline/tools/calibrate.mjs plan --n 10 --seed <n>\`)`
    : calib.pipelineVersion !== cfg.pipelineVersion
      ? `**stale** — measured on ${calib.pipelineVersion}, this run is ${cfg.pipelineVersion}. Re-calibrate before trusting any recall claim.`
      : calib.calibrated
        ? `calibrated for ${calib.pipelineVersion}: recall ${(calib.recall * 100).toFixed(1)}% on ${calib.planted} planted bugs (small sample; an upper bound)`
        : `**inconclusive** for ${calib.pipelineVersion}: recall ${(calib.recall * 100).toFixed(1)}% on ${calib.planted} bugs${calib.zeroRecallClasses?.length ? `, no detection for ${calib.zeroRecallClasses.join(", ")}` : ""}`;

  const required = cfg.independence?.requireFor ?? ["G7", "G9", "G12"];
  // The family every "independent of what?" answer is measured against is the one pinned in the
  // genesis entry, not a config field (B-31). A config that disagrees with the pin is reported as
  // what it is: the record and the declaration cannot both be true.
  const pinEntry = [...entries].reverse().find((e) => e.builderFamily) ?? null;
  const pinnedFamily = String(pinEntry?.builderFamily ?? "unknown");
  const configFamily = String(cfg.independence?.builderFamily ?? "unknown");
  const familyDisagreement =
    pinnedFamily !== "unknown" && configFamily !== "unknown" && pinnedFamily !== configFamily
      ? `the ledger pins the builder as ${pinnedFamily}, pipeline.config.json says ${configFamily}`
      : null;
  const builderFamily = pinnedFamily !== "unknown" ? pinnedFamily : configFamily;
  const last = new Map(entries.map((e) => [e.gate, e]));
  const judged = required.filter((g) => last.has(g) && last.get(g).status !== "NOT_VERIFIED");
  const noModel = judged.filter((g) => !last.get(g).modelFamily);
  // `--model gpt-5` used to be enough for the report to say "verified by a model outside
  // anthropic" while nothing was dispatched. Only a verdict that `dispatch` produced and
  // `gate --verdict` recorded carries `verdictSha256` (SECOND-OPINION-3 G-05).
  const dispatched = judged.filter((g) => last.get(g).verdictSha256);
  const undeclared = judged.filter((g) => last.get(g).modelFamily && !last.get(g).verdictSha256);
  const sameFamily = judged.filter((g) => {
    const e = last.get(g);
    if (!e?.modelFamily) return false;
    const f = familyOf(e.modelFamily);
    return builderFamily !== "unknown" && f === builderFamily;
  });
  const independenceLine = familyDisagreement
    ? `**FAIL** — ${familyDisagreement}; neither can be used to judge independence`
    : sameFamily.length
    ? `**FAIL** — ${sameFamily.join(", ")} were verified inside the builder's own family (${builderFamily})`
    : noModel.length
      ? `**NOT_VERIFIED** — ${noModel.join(", ")} recorded no verifier model, so independence is unproven`
      : undeclared.length
        ? `**declared, not evidenced** — ${undeclared.join(", ")} carry a verifier model typed by the builder (\`--model\`) but no dispatched verdict; run \`node pipeline/tools/verifier-route.mjs dispatch\` and pass \`--verdict\``
        : builderFamily === "unknown"
          ? "unproven — set independence.builderFamily so the pipeline can judge it"
          : dispatched.length
            ? `every judged gate (${dispatched.join(", ")}) was verified by a dispatched verdict outside ${builderFamily}`
            : "no gate was judged: nothing recorded a verifier model";

  // metrics.json is either computed from evidence or hand-written. Say which: a report that
  // quotes hand-written numbers without saying so is the failure mode P5 exists to remove.
  let metricsLine;
  try {
    const m = readJson(abs(path.join(cfg.evalDir, "metrics.json")));
    if (m.computed === true && m.derivedFrom) {
      const stale = metricsStaleness() ?? [];
      metricsLine = `computed from ${Object.keys(m.derivedFrom).join(", ")}${m.at ? ` at ${m.at}` : ""}${
        stale.length ? ` — **STALE**: ${stale.join("; ")}; re-run \`pipeline gate G12 --builtin metrics\`` : ""
      }`;
    } else {
      metricsLine = "**hand-written** (`computed: false`) — these numbers are not derived from the ledger. Run `pipeline gate G12 --builtin metrics`.";
    }
  } catch {
    metricsLine = "**absent** — `pipeline gate G12 --builtin metrics` writes it from the ledger, progress and findings";
  }

  const body = [
    "# Final report",
    "",
    `Generated ${new Date().toISOString()} by \`pipeline report\` (also regenerated automatically when phase 10, 11 or 12 completes) from ${cfg.progress} and ${cfg.ledger}.`,
    "",
    `- commit: \`${commitSha() ?? "unknown"}\``,
    `- pipeline version: ${progress.pipelineVersion ?? cfg.pipelineVersion}`,
    `- phase: ${progress.phase ?? "none"}`,
    `- spec: ${specLine}`,
    `- diff base: \`${progress.baseCommit ?? "unset (protected-paths cannot see committed edits)"}\``,
    `- ledger: ${ledger.count} entries, chain ${ledger.ok ? "intact" : "**BROKEN**"}${ledger.ok ? "" : ` (${ledger.error})`}`,
    "",
    "## Gates",
    "",
    "Every row below is a command this pipeline ran itself. Re-run them all with `pipeline verify`.",
    "",
    "| Gate | Status | Exit | Command / evidence | Recorded |",
    "|---|---|---|---|---|",
    ...gateRows,
    "",
    ...(() => {
      const forced = Object.entries(progress.phases ?? {}).filter(([, ph]) => ph?.forced);
      if (!forced.length) return [];
      return [
        "## Forced",
        "",
        "These phases were marked done while a check was failing. The checks did not pass; a human overrode them.",
        "",
        "| Phase | Recorded | Overridden |",
        "|---|---|---|",
        ...forced.flatMap(([id, ph]) =>
          (ph.overridden ?? ["(no reason recorded)"]).map(
            (why, i) => `| ${i === 0 ? id : ""} | ${ph.at ?? "—"} | \`${String(why).replace(/\|/g, "\\|").slice(0, 160)}\` |`,
          ),
        ),
        "",
      ];
    })(),
    "## Not verified",
    "",
    notVerified.length
      ? [
          "These were **not** evaluated. They are not green.",
          "",
          "| Gate | Reason | Command a human must run |",
          "|---|---|---|",
          ...notVerified.map(([id, g]) => `| ${id} | ${g.reason ?? "—"} | \`${g.humanCommand ?? "—"}\` |`),
        ].join("\n")
      : "None recorded. Confirm this is true and not merely unexamined.",
    "",
    "## Red team",
    "",
    `- FULL rounds: ${progress.rounds?.full ?? 0} · DIFF rounds: ${progress.rounds?.diff ?? 0}`,
    estimate
      ? `- capture–recapture: ${estimate.ok ? `estimated total ${Number(estimate.total).toFixed(2)}, expected remaining ${Number(estimate.remaining).toFixed(2)}` : `no estimate (${estimate.reason})`}`
      : "- capture–recapture: not recorded (`pipeline estimate --a … --b … --m … --write`)",
    `- metrics: ${metricsLine}`,
    `- calibration: ${calibrationLine}`,
    `- verifier independence: ${independenceLine}`, 
    "",
    "## Blockers",
    "",
    progress.blockers?.length ? progress.blockers.map((b) => `- **${b.id}** (phase ${b.phase}): ${b.text}\n  - fallback taken: ${b.fallback}`).join("\n") : "None.",
    "",
    "## What this report must not say",
    "",
    '- Never "no vulnerabilities". State what was tested, how many rounds were FULL, and what remains unverified.',
    "- A DIFF round does not count toward the stop rule.",
    `- ${entries.filter((e) => !e.modelFamily).length} of ${entries.length} ledger entries record no verifier model family.`,
    "",
  ].join("\n");

  ensureDir(path.dirname(abs(cfg.finalReport)));
  fs.writeFileSync(abs(cfg.finalReport), body);
  if (quiet) {
    console.log(paint.dim(`report regenerated after the gate: ${cfg.finalReport}`));
  } else {
    ok(`wrote ${cfg.finalReport}`);
    console.log(`gate rows: ${GATE_IDS.length}, NOT_VERIFIED: ${notVerified.length}, blockers: ${progress.blockers?.length ?? 0}`);
  }
}

switch (command) {
  case "init": {
    const dirs = [
      "docs/00-intake", "docs/00-control", "docs/01-research/extracts", "docs/01-research/snapshots",
      "docs/02-spec", "docs/03-design", "docs/04-architecture", "docs/05-test", "docs/06-build",
      "docs/07-qa", "docs/08-redteam/run-1", "docs/09-patch", "docs/11-deploy", "docs/12-eval",
      cfg.calibrationDir,
    ];
    if (fs.existsSync(abs(cfg.progress)) && !flags.force) {
      fail(`${cfg.progress} already exists. Use --force to re-initialise (this does not delete artifacts).`);
    }
    for (const dir of dirs) ensureDir(abs(dir));

    if (!fs.existsSync(abs(cfg.configPath)) || flags.force) {
      const { commands, ...rest } = cfg;
      // Independence is judged against the builder's own family. If the runner already knows
      // the model, record it now: leaving "unknown" made every cross-family verifier look
      // independent of nothing (REVIEW-OF-SECOND-OPINION.md, F-02).
      const chosen = String(flags["builder-family"] ?? rest.independence?.builderFamily ?? "unknown");
      const derived = chosen === "unknown" ? familyOf(process.env.PIPELINE_BUILDER_MODEL ?? "") : "unknown";
      const builderFamily = chosen !== "unknown" ? chosen : derived === "unknown" ? "unknown" : derived;
      const independence = { ...(rest.independence ?? {}), builderFamily };
      writeJson(abs(cfg.configPath), { ...rest, independence, commands });
      if (builderFamily === "unknown") {
        warn("independence.builderFamily is unknown: independence will be NOT_VERIFIED (never green) until you set it — edit independence.builderFamily in pipeline.config.json, or run with PIPELINE_BUILDER_MODEL set");
      } else {
        console.log(paint.dim(`builder family: ${builderFamily} (independence is judged against it)`));
      }
    }
    // The commit everything is diffed against. Without it, a builder can `git commit` its
    // edits and protected-paths sees a clean tree (REVIEW-OF-SECOND-OPINION.md, F-14).
    // The builder's family is the thing every independence judgement is compared against, so it
    // is pinned in the hash-chained genesis rather than left as a config field the builder can
    // edit afterwards (B-31). A human present at init can attest it; the pipeline records when
    // they did, and `independence.mjs` reports attested vs declared.
    const builderFamily = String(flags["builder-family"] ?? (fs.existsSync(abs(cfg.configPath)) ? readJson(abs(cfg.configPath)).independence?.builderFamily : null) ?? "unknown");
    if (flags["attested-by"] && process.env.PIPELINE_HUMAN !== "1") {
      fail("--attested-by needs PIPELINE_HUMAN=1 in the environment, so the name is a human's claim and not the builder's");
    }
    const builderFamilyAttestedBy = flags["attested-by"] ? String(flags["attested-by"]).trim() : null;
    const baseCommit = commitSha();
    // Files `init` writes after the base commit live inside frozen areas, so a diff against the
    // base commit calls them "new file in a frozen area" the moment a project starts. Record the
    // digest of what init wrote: protected-paths accepts a bootstrap file only while it still
    // matches, so an edit after init is still a violation (B-34).
    const bootstrap = {};
    for (const rel of [cfg.configPath, ALLOWLIST]) {
      if (fs.existsSync(abs(rel))) bootstrap[rel] = sha256(fs.readFileSync(abs(rel), "utf8"));
    }
    writeProgress({ ...readProgress(), schemaVersion: 2, pipelineVersion: cfg.pipelineVersion, phase: "00", baseCommit, bootstrap, gates: {}, phases: {}, blockers: [], rounds: { full: 0, diff: 0 }, notVerified: [], createdAt: new Date().toISOString() });
    if (!baseCommit) warn("not a git repository: protected-paths cannot see committed edits, so it will report NOT_VERIFIED");
    else console.log(paint.dim(`base commit: ${baseCommit} (protected-paths diffs against this, not HEAD)`));

    const allowFile = abs(ALLOWLIST);
    if (!fs.existsSync(allowFile)) {
      writeJson(allowFile, {
        note: "Commands a human has allowlisted for `pipeline gate --cmd`. Agent-supplied commands are refused. This file is a protected path: adding an entry is visible to a reviewer.",
        sha256: {},
      });
    }

    const ledgerFile = abs(cfg.ledger);
    if (!fs.existsSync(ledgerFile) || flags.force) {
      fs.writeFileSync(ledgerFile, "");
      appendLedger(
        ledgerFile,
        {
          phase: "00",
          gate: "GENESIS",
          status: "passed",
          command: "pipeline init",
          commandSource: "orchestrator",
          exitCode: 0,
          commit: commitSha(),
          // Pinned here, not only in progress.json: progress.json is a file the agent can edit,
          // and baseCommit is what protects every later protected-path check (2.9.0).
          baseCommit,
          builderFamily,
          ...(builderFamilyAttestedBy ? { builderFamilyAttestedBy, builderFamilyAttestedAt: new Date().toISOString() } : {}),
          inputs: pinInputs(),
        },
        { cwd: projectRoot },
      );
    }

    fs.writeFileSync(
      abs("docs/00-control/protected-paths.txt"),
      [
        "# Paths the build agent may not modify (v2-00 §3).",
        "# Enforced by: node pipeline/tools/protected-paths.mjs",
        "# tests/**            — append-only after the phase-05 baseline",
        "# pipeline/tools/**   — the gate must not be edited by the agent it gates",
        "# pipeline/bin/**     — the orchestrator must not be edited by the agent it orchestrates",
        "# pipeline.config.json — maps every gate to the command it runs",
        "# docs/02-spec/SPEC.sha256 — only `pipeline freeze` writes it",
        "# docs/05-test/baseline.json — the frozen test baseline",
        "# docs/progress.json  — written only by the orchestrator",
        "# docs/gate-ledger.jsonl — append-only, hash-chained",
        "# docs/00-control/**  — guardrails are set before the run",
        "",
      ].join("\n"),
    );

    // The calibration answer file must never be committed: a plant the red team can read is
    // not a blind test. Add the ignore rule now, before anyone plants anything.
    const ignoreFile = abs(".gitignore");
    const ignoreLine = `${cfg.calibrationDir}/planted.answer.json`;
    const existingIgnore = fs.existsSync(ignoreFile) ? fs.readFileSync(ignoreFile, "utf8") : "";
    if (!existingIgnore.split("\n").some((l) => l.trim() === ignoreLine || l.trim() === `${cfg.calibrationDir}/`)) {
      fs.appendFileSync(ignoreFile, `${existingIgnore && !existingIgnore.endsWith("\n") ? "\n" : ""}\n# planted-bug calibration answers: never commit these\n${ignoreLine}\n`);
      console.log(`added ${ignoreLine} to .gitignore`);
    }

    ok(`initialised ${cfg.progress}, ${cfg.ledger} (genesis) and ${cfg.configPath}`);
    console.log(`next: node pipeline/bin/pipeline.mjs phase start 00`);
    break;
  }

  case "status": {
    const progress = readProgress();
    const ledger = verifyLedger(abs(cfg.ledger));
    const gates = Object.entries(progress.gates);

    console.log(paint.bold(`phase ${progress.phase ?? "none"} of ${PHASES[PHASES.length - 1].id}   pipeline v${progress.pipelineVersion ?? cfg.pipelineVersion}`));
    console.log(`ledger: ${ledger.count} entries, chain ${ledger.ok ? paint.green("intact") : paint.red("BROKEN")}${ledger.ok ? "" : ` — ${ledger.error}`}`);
    console.log("");

    for (const id of GATE_IDS) {
      const g = progress.gates[id];
      const label = g ? (g.status === "passed" ? paint.green("passed") : g.status === "failed" ? paint.red("failed") : paint.yellow("NOT_VERIFIED")) : paint.dim("—");
      const cmd = g?.command ? g.command.slice(0, 62) : g?.evidence ? `evidence: ${g.evidence.join(", ")}` : g?.reason ? `reason: ${g.reason}` : "";
      console.log(`  ${id.padEnd(4)} ${label.padEnd(22)} ${cmd}`);
    }

    const done = Object.entries(progress.phases).filter(([, p]) => p.status === "done").map(([id]) => id);
    console.log(`\nphases done: ${done.length ? done.join(" ") : "none"}`);
    if (progress.blockers?.length) console.log(`${paint.yellow("blockers")}: ${progress.blockers.length} (see ${cfg.blockers})`);
    console.log(`rounds: FULL=${progress.rounds?.full ?? 0} DIFF=${progress.rounds?.diff ?? 0}`);

    const entries = readLedger(abs(cfg.ledger));
    const noManifest = entries.filter((e) => !e.filesGivenToVerifier).length;
    const noModel = entries.filter((e) => !e.modelFamily).length;
    if (entries.length && (noManifest || noModel)) {
      console.log("");
      if (noManifest) warn(`${noManifest}/${entries.length} gate entries record no context manifest (--files)`);
      if (noModel) warn(`${noModel}/${entries.length} gate entries record no verifier model family (--model); single-model runs are NOT_VERIFIED for independence`);
    }
    if (!ledger.ok) process.exit(1);
    break;
  }

  case "next": {
    const progress = readProgress();
    const pending = PHASES.find((p) => progress.phases[p.id]?.status !== "done");
    if (!pending) {
      ok("every phase is marked done. Run `report` and check the NOT_VERIFIED list.");
      break;
    }
    const promptFile = path.join(PIPELINE_DIR, "prompts", pending.prompt);
    console.log(paint.bold(`next: phase ${pending.id} — ${pending.title}`));
    console.log(`prompt: ${path.relative(process.cwd(), promptFile)}`);
    console.log(`start:  node pipeline/bin/pipeline.mjs phase start ${pending.id}`);
    if (pending.gates.length) {
      for (const gate of pending.gates) {
        const suggestion = (GATE_SUGGESTIONS[gate] ?? []).join(",");
        console.log(`gate:   node pipeline/bin/pipeline.mjs gate ${gate} --builtin ${suggestion}`);
      }
    }
    break;
  }

  case "gate": {
    const gate = rest[0] ?? positional[1];
    if (!gate || !GATE_IDS.includes(gate)) fail(`specify a gate id from: ${GATE_IDS.join(" ")}`);

    // The flag that moved the allowlist is gone. Ignoring it silently would be the same defect
    // wearing a different hat (B-29), so naming it is a hard error.
    if (flags["allow-commands"] !== undefined) {
      fail(`--allow-commands was removed in 2.7.1: the allowlist is read from ${ALLOWLIST} at the base commit, and a path the caller names is not an approval (SECOND-OPINION-3 G-02)`);
    }

    if (flags.cmd) {
      const cmd = String(flags.cmd);
      if (!allowlisted(cmd)) {
        const h = sha256(cmd);
        const why = allowlist().error;
        const reason = `agent-supplied command is not evidence: "${cmd.slice(0, 80)}" would be recorded as a pass because the caller typed it`;
        recordGate(gate, { status: "NOT_VERIFIED", reason, humanCommand: cmd, commandSource: "refused-agent-command" });
        console.error(paint.red(`refusing to record ${gate} from an agent-supplied --cmd`));
        console.error(`  ${reason}`);
        console.error(`  Either a human runs it, or a human commits the exact command to ${ALLOWLIST} before the run:`);
        console.error(`    "${h}": ${JSON.stringify(cmd.slice(0, 120))}`);
        if (why) console.error(`  (the allowlist could not be read: ${why})`);
        console.log(`\n${gate} NOT_VERIFIED (recorded in ${cfg.ledger})`);
        process.exit(3);
      }
      const al = allowlist();
      if (al.warning) warn(al.warning);
      console.log(paint.dim(`--cmd matches a committed allowlist entry in ${ALLOWLIST} (sha256 ${sha256(cmd).slice(0, 12)}…)`));
    }

    if (flags["not-verified"]) {
      const reason = flags.reason;
      const humanCommand = flags["human-command"];
      if (!reason || String(reason).length < 8) fail("--not-verified needs --reason \"why it could not be evaluated\"");
      if (!humanCommand) fail("--not-verified needs --human-command \"what a human should run\" (fail closed, but leave a way out)");
      recordGate(gate, { status: "NOT_VERIFIED", reason, humanCommand, commandSource: "manual" });
      warn(`${gate} recorded NOT_VERIFIED: ${reason}`);
      console.log(`a human must run: ${humanCommand}`);
      break;
    }

    let cmds = [];
    if (flags.builtin) {
      const names = String(flags.builtin).split(",").map((s) => s.trim()).filter(Boolean);
      for (const name of names) {
        const resolved = builtin(name);
        // `manual` used to be silently dropped from the list, so `--builtin manual,unit`
        // certified a judgement gate from `unit` alone and the intent vanished without a word
        // (B-29). A name that resolves to nothing is now an error, and `manual` says what to do.
        if (resolved === null) {
          if (name === "manual") {
            fail(
              `"manual" is not a builtin. If ${gate} needs a human judgement, record it as a human judgement: --not-verified --reason "<what you could not run>" --human-command "<command a human runs>", or --attested-by <name> with PIPELINE_HUMAN=1. Dropping it from the list would leave the mechanical half certifying the gate.`,
            );
          }
          fail(`builtin "${name}" resolves to nothing in pipeline.config.json — nothing was run for it`);
        }
        cmds.push(resolved);
      }
      // G5: freeze the baseline before checking it, but only while the baseline is still being
      // established. Once phase 05 is done, a missing baseline is not an invitation to make a
      // new one from whatever the tests now say: that is how `rm baseline.json` turned gutted
      // tests into a pass (SECOND-OPINION-3 G-08).
      if (gate === "G5" && names.includes("trace:check") && !fs.existsSync(abs(cfg.baseline))) {
        const phase05 = readProgress().phases?.["05"]?.status;
        if (phase05 === "done") {
          fail(
            `${cfg.baseline} is missing and phase 05 is done. A baseline is not re-created after the fact — restore it with: git show <base>:${cfg.baseline} > ${cfg.baseline}`,
          );
        }
        cmds = [builtin("trace:freeze"), ...cmds.filter((c) => c !== builtin("trace:freeze"))];
        console.log(paint.dim("baseline missing: freezing it first (phase 05 is not done yet)"));
      }
    }
    if (flags.cmd) cmds.push(String(flags.cmd));

    const evidence = flags.evidence ? String(flags.evidence).split(",").map((s) => s.trim()) : null;

    // A human gate is closed by a named human, and by nothing else. This is a convention, not a
    // boundary — the builder shares the shell — but it cannot be silent, and the name lands in
    // the hash chain (SECOND-OPINION-3 G-22).
    if (HUMAN_GATES.includes(gate)) {
      const by = flags["attested-by"] ? String(flags["attested-by"]).trim() : "";
      if (!by || process.env.PIPELINE_HUMAN !== "1") {
        const reason = !by
          ? `${gate} is a human gate: it is closed by --attested-by <name>, not by a file or a command the builder ran`
          : `--attested-by ${by} needs PIPELINE_HUMAN=1 in the environment, so the name is a human's claim and not the builder's`;
        recordGate(gate, {
          status: "NOT_VERIFIED",
          reason,
          humanCommand: `PIPELINE_HUMAN=1 node pipeline/bin/pipeline.mjs gate ${gate} --attested-by "<your name>"`,
          commandSource: "human-gate-unattested",
        });
        console.error(paint.red(`${gate} is a human gate and no human attested to it`));
        console.error(`  ${reason}`);
        console.log(`\n${gate} NOT_VERIFIED (recorded in ${cfg.ledger})`);
        process.exit(3);
      }
      console.log(paint.dim(`${gate} attested by ${by} (PIPELINE_HUMAN=1)`));
    }

    if (cmds.length === 0 && evidence) {
      if (!EVIDENCE_GATES.includes(gate)) {
        const why = HUMAN_GATES.includes(gate)
          ? `${gate} is a human gate: --evidence is refused, use --attested-by <name> with PIPELINE_HUMAN=1`
          : `${gate} is a command gate: --evidence would record passed/exit 0 from a file the caller named, which is how nine gates were greened by 200 bytes of "a" (SECOND-OPINION-3 G-01)`;
        fail(why);
      }
      // Substance, not size: `--evidence` used to mean "these files exist and are ≥ 64 bytes",
      // which a file of "a" satisfies (SECOND-OPINION-3 B-33). The check is a real command, so it
      // is recorded and can be re-run by `verify`.
      // the files come first: `parseArgs` would read the first path after --substance as its value.
      const substanceCmd = `node ${tool("expect-files.mjs")} ${evidence.map((f) => JSON.stringify(f)).join(" ")} --substance`;
      const substance = run(substanceCmd, { cwd: projectRoot, timeout: 300_000 });
      if (substance.code !== 0) {
        recordGate(gate, { status: "failed", evidence, exitCode: substance.code, command: substanceCmd });
        if (substance.stdout) console.error(tail(substance.stdout, 12));
        fail(`evidence is not substantial enough to close ${gate}`);
      }
      recordGate(gate, { status: "passed", evidence, exitCode: 0, command: substanceCmd, commandSource: "evidence" });
      ok(`${gate} passed on evidence: ${evidence.join(", ")}`);
      console.log(paint.dim("note: an evidence gate is a judgement call. A fresh reviewer must still read it (07)."));
      break;
    }

    // An attested human gate with no command to run is closed by the attestation itself.
    if (cmds.length === 0 && HUMAN_GATES.includes(gate)) {
      recordGate(gate, {
        status: "passed",
        exitCode: 0,
        commandSource: "human-attestation",
        attestedBy: String(flags["attested-by"]),
      });
      ok(`${gate} passed on a human attestation from ${flags["attested-by"]} (recorded in ${cfg.ledger})`);
      break;
    }

    if (cmds.length === 0) {
      const suggestion = (GATE_SUGGESTIONS[gate] ?? [])[0] ?? "";
      if (suggestion.startsWith("evidence:")) {
        console.log(`gate ${gate} is an evidence gate. Suggested:`);
        console.log(`  node pipeline/bin/pipeline.mjs gate ${gate} --evidence ${suggestion.slice("evidence:".length)}`);
        fail("nothing to run. Use --evidence <files>, --builtin, or --not-verified --reason … --human-command …");
      }
      console.log(`gate ${gate} has no mechanical check by default. Suggested: --builtin ${(GATE_SUGGESTIONS[gate] ?? []).join(",")}`);
      fail("nothing to run. Use --builtin, --cmd, --evidence or --not-verified --reason … --human-command …");
    }

    // G10 is the gate that certifies the record. An unkeyed chain is tamper-evident only
    // against careless edits: an agent that rewrites a line recomputes the hash and the chain
    // still verifies. So G10 may not pass unless every entry carries an HMAC, which needs
    // PIPELINE_LEDGER_KEY set where the agent cannot read it (2.9.0, SECOND-OPINION-3 item 4).
    if (gate === "G10") {
      const sealed = verifyLedger(abs(cfg.ledger), { requireHmac: true });
      if (!sealed.ok) {
        const reason = `the ledger is not sealed: ${sealed.error}`;
        recordGate(gate, {
          status: "NOT_VERIFIED",
          reason,
          humanCommand: `PIPELINE_LEDGER_KEY=<key held outside the agent> node pipeline/bin/pipeline.mjs init --force   # then re-record the gates`,
          commandSource: "unsealed-ledger",
        });
        console.error(paint.red(`G10 refuses to certify an unsealed ledger`));
        console.error(`  ${reason}`);
        console.log(`\nG10 NOT_VERIFIED (recorded in ${cfg.ledger})`);
        process.exit(3);
      }
      console.log(paint.dim("G10: ledger is HMAC-sealed"));
    }

    const joined = cmds.join(" && ");
    const commandSource = flags.builtin ? (flags.cmd ? "builtin+allowlisted" : "builtin") : flags.cmd ? "allowlisted" : "manual";
    console.log(paint.dim(`run: ${joined}`));
    const started = Date.now();
    const res = run(joined, { cwd: projectRoot, timeout: Number(flags.timeout ?? 1_800_000) });
    const seconds = ((Date.now() - started) / 1000).toFixed(1);

    if (res.stdout) console.log(tail(res.stdout, 20));
    if (res.stderr) console.error(tail(res.stderr, 20));

    const passed = res.code === 0;
    // Exit 3 is the pipeline's NOT_VERIFIED protocol: the tool could not evaluate the work and
    // printed the command a human must run. It is recorded as such, never as a failure or a pass.
    if (!passed && res.code === 3) {
      const out = `${res.stdout ?? ""}\n${res.stderr ?? ""}`;
      const reason = (
        out.match(/NOT_VERIFIED:\s*(.+)/)?.[1] ??
        out.match(/RESULT: NOT_VERIFIED\s*—?\s*(.+)/)?.[1] ??
        "the tool reported NOT_VERIFIED"
      )
        .trim()
        .slice(0, 300);
      // A tool that exits 3 without printing a human command used to write null, which then
      // failed G10 — so an honest NOT_VERIFIED was punished harder than a lie. Fall back to
      // the command itself: it is exactly what a human must run.
      const humanCommand = (out.match(/human command:\s*(.+)/)?.[1] ?? "").trim().slice(0, 300) || joined;
      recordGate(gate, { status: "NOT_VERIFIED", command: joined, commandSource, exitCode: 3, reason, humanCommand, evidence });
      console.log("");
      console.log(paint.yellow(`${gate} NOT_VERIFIED (exit 3, recorded in ${cfg.ledger})`));
      console.log(`  reason: ${reason}`);
      if (humanCommand) console.log(`  human command: ${humanCommand}`);
      process.exit(3);
    }
    recordGate(gate, { status: passed ? "passed" : "failed", command: joined, commandSource, exitCode: res.code, evidence });

    console.log("");
    if (passed) ok(`${gate} PASSED in ${seconds}s (exit 0, recorded in ${cfg.ledger})`);
    else {
      console.error(paint.red(`${gate} FAILED in ${seconds}s (exit ${res.code}, recorded in ${cfg.ledger})`));
      console.error(`Repair loop: fix the cause, then re-run. Max 3 attempts, then write a blocker (pipeline blocker add).`);
      process.exit(1);
    }
    break;
  }

  case "verify": {
    if (flags.check) console.log(paint.dim("read-only check: commands that write files are not re-run"));
    const progress = readProgress();
    let blocked = false;

    // 1 · the frozen spec is the thing every later gate is judged against. Check it first.
    const specProblem = specDrift();
    if (specProblem) {
      console.error(paint.red(`spec drift: ${specProblem}`));
      blocked = true;
    }

    // 2 · the ledger must still describe the same history progress.json remembers.
    const ledgerCheck = verifyLedger(abs(cfg.ledger), {
      progress,
      requireHmac: Boolean(flags["require-hmac"]),
      cwd: projectRoot,
    });
    if (!ledgerCheck.ok) {
      console.error(paint.red(`ledger: ${ledgerCheck.error}`));
      blocked = true;
    } else {
      console.log(paint.dim(`ledger: ${ledgerCheck.count} entries, chain intact, ${Object.keys(progress.gates ?? {}).length} gate(s) cross-checked`));
    }
    // 3 · the protected paths, strictly: at release the orchestrator-owned files are checked
    // against the ledger instead of being reported as warnings (B-34). Read-only, so it runs
    // under --check too.
    const protectedCheck = run(builtin("protected:strict"), { cwd: projectRoot, timeout: 600_000 });
    if (protectedCheck.code !== 0) {
      console.error(paint.red(`protected paths: ${tail(protectedCheck.stdout || protectedCheck.stderr, 6)}`));
      blocked = true;
    } else {
      console.log(paint.dim("protected paths: clean (strict; orchestrator-owned files match the ledger)"));
    }
    // 4 · metrics.json must still describe the files it was computed from (B-26). Hashing is
    // read-only, so this runs under --check as well.
    const staleMetrics = metricsStaleness();
    if (staleMetrics === null) {
      console.log(paint.dim(`metrics: no ${cfg.evalDir}/metrics.json yet`));
    } else if (staleMetrics.length) {
      console.error(paint.red(`metrics: ${cfg.evalDir}/metrics.json is stale — ${staleMetrics.join("; ")}`));
      console.error(`human command: node pipeline/bin/pipeline.mjs gate G12 --builtin metrics`);
      blocked = true;
    } else {
      console.log(paint.dim(`metrics: ${cfg.evalDir}/metrics.json still matches its sources`));
    }
    if (blocked) process.exit(1);

    const only = flags.gate ? [String(flags.gate)] : null;
    const targets = Object.entries(progress.gates).filter(([id]) => !only || only.includes(id));
    if (targets.length === 0) fail("no gates recorded yet");

    let drift = 0;
    let skipped = 0;
    // The ledger is the record of what ran. progress.json is a convenience index that the
    // builder can edit, so `verify` re-runs the ledger's command (SECOND-OPINION-3 G-03).
    const ledgerEntry = new Map();
    for (const e of readLedger(abs(cfg.ledger))) if (e.gate) ledgerEntry.set(e.gate, e);

    console.log(paint.bold("re-running every recorded gate (never trust the recorded status)"));
    for (const [id, g0] of targets) {
      const g = { ...g0 };
      const fromLedger = ledgerEntry.get(id);
      if (fromLedger && fromLedger.command) g.command = fromLedger.command;

      if (g.status === "NOT_VERIFIED") {
        console.log(`  ${id.padEnd(4)} ${paint.yellow("NOT_VERIFIED")} — not re-runnable; a human must run: ${g.humanCommand ?? "(no command recorded)"}`);
        skipped++;
        continue;
      }
      // `verify` re-runs the recorded commands, and some of them write files: the enumerator
      // rewrites entrypoints.json, `dast run` clears and refills its artifact directory. That is
      // fine for a release check and wrong for a read-only one, so --check runs only the commands
      // that cannot change the tree and says which ones it left alone (review disagreement 4).
      if (flags.check && READS_ONLY_UNSAFE.test(g.command ?? "")) {
        console.log(`  ${id.padEnd(4)} ${paint.dim("not re-run: the command writes files; its inputs are pinned in the ledger and checked above")}`);
        skipped++;
        continue;
      }
      let passedNow;
      let detail;
      if (g.command) {
        if (flags.dry) {
          console.log(`  ${id.padEnd(4)} would run: ${g.command}`);
          continue;
        }
        const res = run(g.command, { cwd: projectRoot, timeout: Number(flags.timeout ?? 1_800_000) });
        passedNow = res.code === 0;
        detail = `exit ${res.code}`;
      } else if (g.evidence) {
        passedNow = g.evidence.every((f) => substantialFile(abs(f)));
        detail = passedNow ? "evidence present" : "evidence missing";
      } else if (g.attestedBy) {
        console.log(`  ${id.padEnd(4)} ${paint.dim(`attested by ${g.attestedBy}; a human gate is not re-runnable`)}`);
        skipped++;
        continue;
      } else {
        console.log(`  ${id.padEnd(4)} ${paint.dim("recorded by explicit approval; cannot verify")}`);
        skipped++;
        continue;
      }
      const recorded = g.status === "passed";
      const match = passedNow === recorded;
      if (!match) drift++;
      console.log(`  ${id.padEnd(4)} recorded=${String(g.status).padEnd(12)} now=${passedNow ? "pass" : "fail"} ${match ? paint.green("match") : paint.red("DRIFT")} (${detail})`);
    }

    console.log("");
    if (drift) {
      console.error(paint.red(`DRIFT: ${drift} gate(s) no longer agree with the recorded status.`));
      console.error("Either the code changed or the gate was recorded without running. Fix before shipping.");
      process.exit(1);
    }
    ok(`no drift across ${targets.length - skipped} re-run gate(s)${skipped ? ` (${skipped} not re-runnable)` : ""}`);
    break;
  }

  case "phase": {
    const action = rest[0];
    const id = rest[1];
    const spec = getPhase(id);
    if (!action || !["start", "done"].includes(action)) fail("usage: phase start <id> | phase done <id>");
    if (!spec) fail(`unknown phase "${id}". Known: ${PHASES.map((p) => p.id).join(" ")}`);

    const progress = readProgress();
    progress.phases ??= {};

    if (action === "start") {
      const blockers = [];
      for (const need of spec.requiresPhases) if (progress.phases[need]?.status !== "done") blockers.push(`phase ${need} is not done`);
      for (const gate of spec.requiresGates) {
        const g = progress.gates[gate];
        if (!g) blockers.push(`${gate} has not been recorded`);
        else if (g.status === "failed") blockers.push(`${gate} is failed`);
      }
      if (blockers.length && !flags.force) {
        console.error(paint.red(`cannot start phase ${id}:`));
        for (const b of blockers) console.error(`  - ${b}`);
        console.error("Fix the blocker, or re-run with --force and record why in docs/blockers.md.");
        process.exit(1);
      }
      const forcedStart = blockers.length > 0;
      progress.phase = id;
      progress.phases[id] = {
        status: "started",
        at: new Date().toISOString(),
        ...(forcedStart ? { forced: true, overridden: blockers } : {}),
      };
      writeProgress(progress);
      if (forcedStart) {
        // A forced start used to leave no trace at all: the phase simply began, and the report
        // read as if it had been allowed (SECOND-OPINION-3 G-04).
        warn(`phase ${id} started with --force over: ${blockers.join("; ")}`);
        appendLedger(
          abs(cfg.ledger),
          {
            phase: id,
            gate: `P${id}`,
            status: "forced",
            command: `pipeline phase start ${id} --force`,
            commandSource: "orchestrator-forced",
            exitCode: 0,
            commit: commitSha(),
            overridden: blockers,
          },
          { cwd: projectRoot },
        );
        refreshMetrics();
      }
      ok(`phase ${id} started: ${spec.title}`);
      console.log(`prompt: ${path.relative(process.cwd(), path.join(PIPELINE_DIR, "prompts", spec.prompt))}`);
      break;
    }

    // done
    if (progress.phases[id]?.status !== "started" && progress.phases[id]?.status !== "done") {
      fail(`phase ${id} was never started. Run: pipeline phase start ${id}`);
    }
    const problems = [];
    const specProblem = specDrift();
    if (specProblem) problems.push(`spec drift: ${specProblem}`);
    for (const gate of spec.gates) {
      const g = progress.gates[gate];
      if (!g) problems.push(`${gate} has not been recorded (run: pipeline gate ${gate} …)`);
      else if (g.status === "failed") problems.push(`${gate} is failed`);
      else if (g.status === "NOT_VERIFIED" && !g.reason) problems.push(`${gate} is NOT_VERIFIED with no reason`);
    }
    for (const check of spec.doneChecks) {
      if (check === "freeze") {
        // Establish or verify the spec hash. A changed spec without --refreeze exits here.
        doFreeze({ refreeze: Boolean(flags.refreeze) });
        if (!fs.existsSync(abs(cfg.specHash))) problems.push(`spec was not frozen (${cfg.specHash} missing)`);
      } else if (check in ARTIFACTS) {
        problems.push(...checkArtifacts(check));
      } else {
        const cmd = builtin(check);
        if (!cmd) continue;
        const res = run(cmd, { cwd: projectRoot, timeout: 900_000 });
        if (res.code !== 0) {
          problems.push(`${check} failed: ${tail(res.stderr || res.stdout, 6)}`);
        }
      }
    }
    if (problems.length && !flags.force) {
      console.error(paint.red(`cannot mark phase ${id} done:`));
      for (const p of problems) console.error(`  - ${p}`);
      process.exit(1);
    }
    const forced = problems.length > 0;
    progress.phases[id] = {
      ...progress.phases[id],
      status: "done",
      at: new Date().toISOString(),
      ...(forced ? { forced: true, overridden: problems } : {}),
    };
    progress.phase = nextPhase(id) ?? id;
    // A second red-team pass writes a different run directory; that is what makes it a round
    // rather than a re-run of the same one (G-13).
    if (flags.run) progress.runDir = String(flags.run);
    recordRound(progress, id);
    writeProgress(progress);
    // `phase done --force` used to write `passed, exitCode 0` and drop the problem list, so an
    // overridden phase was indistinguishable from one that met its own checks (G-04).
    if (forced) warn(`phase ${id} marked done with --force over ${problems.length} problem(s); they are in the ledger and the report`);
    appendLedger(
      abs(cfg.ledger),
      {
        phase: id,
        gate: `P${id}`,
        status: forced ? "forced" : "passed",
        command: `pipeline phase done ${id}${forced ? " --force" : ""}`,
        commandSource: forced ? "orchestrator-forced" : "orchestrator",
        exitCode: 0,
        commit: commitSha(),
        filesGivenToVerifier: flags.files ? String(flags.files).split(",").map((s) => s.trim()) : null,
        modelFamily: flags.model ?? null,
        ...(forced ? { overridden: problems } : {}),
      },
      { cwd: projectRoot },
    );
    // The ledger just grew, so the metrics snapshot would be one row out of date before the
    // report below quotes it.
    refreshMetrics();
    ok(`phase ${id} done.${nextPhase(id) ? ` Next: ${nextPhase(id)}` : ""}`);
    // A report that still describes yesterday's gates is worse than no report: regenerate it
    // as the release phases complete (REVIEW-OF-SECOND-OPINION.md §7 P5).
    if (["10", "11", "12"].includes(String(id))) {
      writeReport();
    }
    break;
  }

  case "freeze": {
    doFreeze({ refreeze: Boolean(flags.refreeze) });
    break;
  }

  // A human pins the builder's family into the hash chain, without re-initialising the run.
  // `independence.mjs` judges every verifier against this entry, so a family the builder typed
  // into a config file after init cannot become the standard (B-31).
  case "attest": {
    const family = flags["builder-family"] ?? flags.family;
    const by = flags["attested-by"] ? String(flags["attested-by"]).trim() : "";
    if (!family) fail('usage: pipeline attest --builder-family <anthropic|openai|google|…> --attested-by "<your name>"');
    if (!by || process.env.PIPELINE_HUMAN !== "1") {
      fail(
        !by
          ? "attest needs --attested-by <name>: this is a human's claim about a machine, not the builder's"
          : "--attested-by needs PIPELINE_HUMAN=1 in the environment, so the name is a human's claim and not the builder's",
      );
    }
    if (familyOf(String(family)) === "unknown") warn(`"${family}" is not in the family table; independence will not be able to judge a verifier against it`);
    const progress = readProgress();
    appendLedger(
      abs(cfg.ledger),
      {
        phase: progress.phase,
        gate: "BUILDER_FAMILY",
        status: "passed",
        command: `pipeline attest --builder-family ${family}`,
        commandSource: "human-attestation",
        exitCode: 0,
        commit: commitSha(),
        builderFamily: String(family),
        builderFamilyAttestedBy: by,
        builderFamilyAttestedAt: new Date().toISOString(),
      },
      { cwd: projectRoot },
    );
    refreshMetrics();
    ok(`builder family pinned: ${family} (attested by ${by}, recorded in ${cfg.ledger})`);
    break;
  }

  case "blocker": {
    const action = rest[0] ?? "list";
    const progress = readProgress();
    progress.blockers ??= [];
    if (action === "add") {
      const phase = flags.phase;
      const text = flags.text;
      const fallback = flags.fallback;
      if (!text) fail('--text "what is blocked"');
      if (!fallback) fail('--fallback "the safest thing to do instead" (the framework requires one)');
      const blocker = { id: `B-${String(progress.blockers.length + 1).padStart(2, "0")}`, phase: phase ?? progress.phase, text, fallback, at: new Date().toISOString() };
      progress.blockers.push(blocker);
      writeProgress(progress);
      ensureDir(path.dirname(abs(cfg.blockers)));
      fs.appendFileSync(abs(cfg.blockers), `\n## ${blocker.id} · phase ${blocker.phase} · ${blocker.at}\n\n${text}\n\n**Fallback taken:** ${fallback}\n`);
      warn(`${blocker.id} recorded in ${cfg.progress} and ${cfg.blockers}`);
    } else {
      if (!progress.blockers.length) console.log("no blockers");
      for (const b of progress.blockers) console.log(`${b.id} [phase ${b.phase}] ${b.text}\n     fallback: ${b.fallback}`);
    }
    break;
  }

  case "estimate": {
    const cmd = `node ${tool("estimate.mjs")} --a ${Number(flags.a)} --b ${Number(flags.b)} --m ${Number(flags.m)} --json`;
    const res = run(cmd, { cwd: projectRoot });
    if (!res.stdout.trim()) fail(res.stderr.trim() || "estimate failed");
    const data = JSON.parse(res.stdout);
    if (data.ok) {
      console.log(`union ${data.union} · estimated total ${data.total.toFixed(2)} · remaining ${data.remaining.toFixed(2)} · ${data.stop ? "STOP permitted" : "CONTINUE"}`);
      console.log(paint.dim("optimistic: assumes independent hunts and equally findable bugs"));
    } else {
      console.log(`no estimate: ${data.reason}`);
    }
    if (flags.write) {
      writeJson(abs(path.join(cfg.evalDir, "estimate.json")), { ...data, at: new Date().toISOString() });
      console.log(`written: ${cfg.evalDir}/estimate.json`);
    }
    break;
  }

  case "report": {
    writeReport();
    break;
  }

  case "live": {
    // P6 · what this environment cannot do yet, and the one command that would fix each item.
    // It is not a gate: the four items flip gates that already exist (G0, G8, G9, G12).
    const mode = rest[0] ?? "probe";
    if (!["probe", "prep", "verify"].includes(mode)) fail("usage: pipeline live [probe|prep|verify] [--run]");
    const args = ["--cwd", projectRoot];
    if (mode === "verify" && flags.run) args.push("--run");
    const res = run(`node ${tool("live-check.mjs")} ${mode} ${args.join(" ")}`, { cwd: projectRoot });
    console.log(res.stdout);
    if (res.stderr) console.error(res.stderr);
    process.exit(res.code ?? 1);
  }

  case "selftests": {
    const res = run(`node ${tool("run-selftests.mjs")}`, { cwd: projectRoot });
    console.log(res.stdout);
    if (res.stderr) console.error(res.stderr);
    process.exit(res.code);
    break;
  }

  case "builtins": {
    console.log("builtins:");
    for (const name of BUILTINS) console.log(`  ${name}`);
    break;
  }

  case "help":
  case "--help": {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 22).join("\n"));
    break;
  }

  default:
    fail(`unknown command "${command}". Try: init | status | next | gate | verify | phase | freeze | attest | blocker | estimate | report | live | selftests`);
}

void STATUSES;
