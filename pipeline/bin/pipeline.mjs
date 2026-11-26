#!/usr/bin/env node
// The v2 build orchestrator. It does not write product code and it does not decide
// whether a gate passed: it runs the gate's command itself, records the exit code,
// and appends a hash-chained ledger entry.
//
//   node pipeline/bin/pipeline.mjs init | status | next | report
//   node pipeline/bin/pipeline.mjs gate G5 --builtin trace:check,unit
//   node pipeline/bin/pipeline.mjs gate G7 --not-verified --reason "no browser" --human-command "npx playwright test"
//   node pipeline/bin/pipeline.mjs verify            # re-run every recorded gate
//   node pipeline/bin/pipeline.mjs phase start 06
//   node pipeline/bin/pipeline.mjs phase done 05
//   node pipeline/bin/pipeline.mjs freeze --refreeze
//   node pipeline/bin/pipeline.mjs blocker add --phase 06 --text "..." --fallback "..."
import fs from "node:fs";
import path from "node:path";
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
import { GATE_IDS, STATUSES, PHASES, GATE_SUGGESTIONS, phase as getPhase, nextPhase } from "../tools/lib/gates.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PIPELINE_DIR = path.resolve(HERE, "..");
const TOOLS_DIR = path.join(PIPELINE_DIR, "tools");

const { flags, positional } = parseArgs();
const [command = "status", ...rest] = positional;

// ---------------------------------------------------------------------------
// Project resolution
// ---------------------------------------------------------------------------
const projectRoot = path.resolve(flags.cwd ?? process.cwd());

const DEFAULTS = {
  configPath: "pipeline.config.json",
  pipelineVersion: "2.0.0",
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
  speccChanges: "docs/02-spec/CHANGES.md",
  entrypoints: "docs/08-redteam/run-1/entrypoints.json",
  coverageLedger: "docs/08-redteam/run-1/coverage-ledger.json",
  findings: "docs/08-redteam/run-1/findings.json",
  finalReport: "docs/FINAL-REPORT.md",
  evalDir: "docs/12-eval",
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
    dast: "npx @zaproxy/zap-cli quick-scan --self-contained",
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

const writeProgress = (p) => {
  p.updatedAt = new Date().toISOString();
  writeJson(abs(cfg.progress), p);
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
      return `node ${tool("trace-check-v2.mjs")} ${c.spec} ${c.tests} --allow-uncovered --check-baseline ${c.baseline}`;
    case "quotes":
      return `node ${tool("quote-verify.mjs")} --extracts ${c.researchExtracts} --snapshots ${c.researchSnapshots} --log ${c.quoteLog} --write-ledger ${c.evidenceLedger}${c.fetchQuotes ? " --fetch" : ""}`;
    case "entrypoints":
      return `node ${tool("entrypoints.mjs")} --root . --out ${c.entrypoints}`;
    case "coverage":
      return `node ${tool("coverage-gate.mjs")} --entrypoints ${c.entrypoints} --ledger ${c.coverageLedger}`;
    case "findings":
      return `node ${tool("validate-findings.mjs")} ${c.findings}`;
    case "progress":
      return `node ${tool("validate-progress.mjs")} ${c.progress}`;
    case "ledger":
      return `node ${tool("gate-ledger.mjs")} verify --path ${c.ledger}`;
    case "protected":
      return `node ${tool("protected-paths.mjs")} --config ${c.configPath}`;
    case "tripwire":
      return `node ${tool("tripwire.mjs")} --config ${c.configPath}`;
    case "selftests":
      return `node ${tool("run-selftests.mjs")}`;
    case "digest":
      return `node ${tool("expect-files.mjs")} ${c.digest}`;
    case "metrics":
      return `node ${tool("expect-files.mjs")} ${c.evalDir}/metrics.json`;
    case "release":
      return `node ${tool("expect-files.mjs")} ${c.finalReport} README.md .env.example`;
    case "slices":
      return `node ${tool("expect-files.mjs")} --glob "docs/06-build/slice-*.md"`;
    default:
      fail(`unknown builtin "${name}". Known: ${BUILTINS.join(", ")}`);
  }
}

const BUILTINS = [
  "types", "lint", "unit", "build", "e2e", "a11y", "mutation", "sast", "secrets", "deps", "dast",
  "trace:structure", "trace:freeze", "trace:check", "quotes", "entrypoints", "coverage", "findings",
  "progress", "ledger", "protected", "tripwire", "selftests",
  "digest", "metrics", "release", "slices", "manual",
];

// Artifact checks used by `phase done` where no single command can judge the work.
const ARTIFACTS = {
  digest: [{ path: () => cfg.digest, label: "Decision Digest" }],
  slices: [{ glob: "docs/06-build/slice-*.md", label: "at least one slice log" }],
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
      const dir = abs(path.dirname(check.glob));
      const base = path.basename(check.glob);
      const star = base.indexOf("*");
      const prefix = star === -1 ? base : base.slice(0, star);
      const suffix = star === -1 ? "" : base.slice(star + 1);
      const hits = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith(suffix)) : [];
      if (hits.length === 0) problems.push(`missing ${check.label} (${check.glob})`);
      continue;
    }
    const rel = check.path();
    if (!substantialFile(abs(rel))) problems.push(`missing or empty ${check.label} (${rel})`);
  }
  return problems;
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
  if (previous && !refreeze) {
    const hasChangeNote = substantialFile(abs(cfg.speccChanges), 40);
    console.error(paint.red(`spec changed after freeze`));
    console.error(`  frozen:  ${previous.slice(0, 12)}…`);
    console.error(`  current: ${hash.slice(0, 12)}…`);
    if (!hasChangeNote) console.error(`  and ${cfg.speccChanges} does not exist or is empty`);
    console.error(`Write the change note, then re-freeze: node pipeline/bin/pipeline.mjs freeze --refreeze`);
    process.exit(1);
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

function recordGate(gate, entry, extra = {}) {
  const progress = readProgress();
  progress.gates[gate] = {
    status: entry.status,
    command: entry.command ?? null,
    evidence: entry.evidence ?? null,
    exitCode: entry.exitCode ?? null,
    reason: entry.reason ?? null,
    humanCommand: entry.humanCommand ?? null,
    at: new Date().toISOString(),
    commit: commitSha(),
    ...extra,
  };
  if (!progress.gates[gate].command && !progress.gates[gate].evidence && entry.status === "passed") {
    progress.gates[gate].explicitApproval = true;
  }
  writeProgress(progress);
  appendLedger(abs(cfg.ledger), {
    phase: progress.phase,
    gate,
    status: entry.status,
    command: entry.command ?? null,
    exitCode: entry.exitCode ?? null,
    commit: commitSha(),
    evidence: entry.evidence ?? null,
    filesGivenToVerifier: flags.files ? String(flags.files).split(",").map((s) => s.trim()) : null,
    modelFamily: flags.model ?? null,
  });
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------
switch (command) {
  case "init": {
    const dirs = [
      "docs/00-intake", "docs/00-control", "docs/01-research/extracts", "docs/01-research/snapshots",
      "docs/02-spec", "docs/03-design", "docs/04-architecture", "docs/05-test", "docs/06-build",
      "docs/07-qa", "docs/08-redteam/run-1", "docs/09-patch", "docs/11-deploy", "docs/12-eval",
    ];
    if (fs.existsSync(abs(cfg.progress)) && !flags.force) {
      fail(`${cfg.progress} already exists. Use --force to re-initialise (this does not delete artifacts).`);
    }
    for (const dir of dirs) ensureDir(abs(dir));

    if (!fs.existsSync(abs(cfg.configPath)) || flags.force) {
      const { commands, ...rest } = cfg;
      writeJson(abs(cfg.configPath), { ...rest, commands });
    }
    writeProgress({ ...readProgress(), schemaVersion: 2, pipelineVersion: cfg.pipelineVersion, phase: "00", gates: {}, phases: {}, blockers: [], rounds: { full: 0, diff: 0 }, notVerified: [], createdAt: new Date().toISOString() });

    const ledgerFile = abs(cfg.ledger);
    if (!fs.existsSync(ledgerFile) || flags.force) {
      fs.writeFileSync(ledgerFile, "");
      appendLedger(ledgerFile, { phase: "00", gate: "GENESIS", status: "passed", command: "pipeline init", exitCode: 0, commit: commitSha() });
    }

    fs.writeFileSync(
      abs("docs/00-control/protected-paths.txt"),
      [
        "# Paths the build agent may not modify (v2-00 §3).",
        "# Enforced by: node pipeline/tools/protected-paths.mjs",
        "# tests/**            — append-only after the phase-05 baseline",
        "# pipeline/tools/**   — the gate must not be edited by the agent it gates",
        "# docs/progress.json  — written only by the orchestrator",
        "# docs/gate-ledger.jsonl — append-only, hash-chained",
        "# docs/00-control/**  — guardrails are set before the run",
        "",
      ].join("\n"),
    );

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

    if (flags["not-verified"]) {
      const reason = flags.reason;
      const humanCommand = flags["human-command"];
      if (!reason || String(reason).length < 8) fail("--not-verified needs --reason \"why it could not be evaluated\"");
      if (!humanCommand) fail("--not-verified needs --human-command \"what a human should run\" (fail closed, but leave a way out)");
      recordGate(gate, { status: "NOT_VERIFIED", reason, humanCommand });
      warn(`${gate} recorded NOT_VERIFIED: ${reason}`);
      console.log(`a human must run: ${humanCommand}`);
      break;
    }

    let cmds = [];
    if (flags.builtin) {
      const names = String(flags.builtin).split(",").map((s) => s.trim()).filter(Boolean);
      for (const name of names) {
        const resolved = builtin(name);
        if (resolved === null) continue;
        cmds.push(resolved);
      }
      // G5: freeze the baseline before checking it, if it does not exist yet.
      if (gate === "G5" && names.includes("trace:check") && !fs.existsSync(abs(cfg.baseline))) {
        cmds = [builtin("trace:freeze"), ...cmds.filter((c) => c !== builtin("trace:freeze"))];
        console.log(paint.dim("baseline missing: freezing it first"));
      }
    }
    if (flags.cmd) cmds.push(String(flags.cmd));

    const evidence = flags.evidence ? String(flags.evidence).split(",").map((s) => s.trim()) : null;

    if (cmds.length === 0 && evidence) {
      const missing = evidence.filter((f) => !substantialFile(abs(f)));
      if (missing.length) {
        recordGate(gate, { status: "failed", evidence, exitCode: 1 });
        fail(`evidence not found or empty: ${missing.join(", ")}`);
      }
      recordGate(gate, { status: "passed", evidence, exitCode: 0 });
      ok(`${gate} passed on evidence: ${evidence.join(", ")}`);
      console.log(paint.dim("note: an evidence gate is a judgement call. A fresh reviewer must still read it (07)."));
      break;
    }

    if (cmds.length === 0) {
      console.log(`gate ${gate} has no mechanical check by default. Suggested: --builtin ${(GATE_SUGGESTIONS[gate] ?? []).join(",")}`);
      fail("nothing to run. Use --builtin, --cmd, --evidence or --not-verified --reason … --human-command …");
    }

    const joined = cmds.join(" && ");
    console.log(paint.dim(`run: ${joined}`));
    const started = Date.now();
    const res = run(joined, { cwd: projectRoot, timeout: Number(flags.timeout ?? 1_800_000) });
    const seconds = ((Date.now() - started) / 1000).toFixed(1);

    if (res.stdout) console.log(tail(res.stdout, 20));
    if (res.stderr) console.error(tail(res.stderr, 20));

    const passed = res.code === 0;
    recordGate(gate, { status: passed ? "passed" : "failed", command: joined, exitCode: res.code, evidence });

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
    const progress = readProgress();
    const only = flags.gate ? [String(flags.gate)] : null;
    const targets = Object.entries(progress.gates).filter(([id]) => !only || only.includes(id));
    if (targets.length === 0) fail("no gates recorded yet");

    let drift = 0;
    let skipped = 0;
    console.log(paint.bold("re-running every recorded gate (never trust the recorded status)"));
    for (const [id, g] of targets) {
      if (g.status === "NOT_VERIFIED") {
        console.log(`  ${id.padEnd(4)} ${paint.yellow("NOT_VERIFIED")} — not re-runnable; a human must run: ${g.humanCommand ?? "(no command recorded)"}`);
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
      progress.phase = id;
      progress.phases[id] = { status: "started", at: new Date().toISOString() };
      writeProgress(progress);
      ok(`phase ${id} started: ${spec.title}`);
      console.log(`prompt: ${path.relative(process.cwd(), path.join(PIPELINE_DIR, "prompts", spec.prompt))}`);
      break;
    }

    // done
    if (progress.phases[id]?.status !== "started" && progress.phases[id]?.status !== "done") {
      fail(`phase ${id} was never started. Run: pipeline phase start ${id}`);
    }
    const problems = [];
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
    progress.phases[id] = { ...progress.phases[id], status: "done", at: new Date().toISOString() };
    progress.phase = nextPhase(id) ?? id;
    writeProgress(progress);
    appendLedger(abs(cfg.ledger), {
      phase: id,
      gate: `P${id}`,
      status: "passed",
      command: `pipeline phase done ${id}`,
      exitCode: 0,
      commit: commitSha(),
      filesGivenToVerifier: flags.files ? String(flags.files).split(",").map((s) => s.trim()) : null,
      modelFamily: flags.model ?? null,
    });
    ok(`phase ${id} done.${nextPhase(id) ? ` Next: ${nextPhase(id)}` : ""}`);
    break;
  }

  case "freeze": {
    doFreeze({ refreeze: Boolean(flags.refreeze) });
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
    const progress = readProgress();
    const ledger = verifyLedger(abs(cfg.ledger));
    const entries = readLedger(abs(cfg.ledger));
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

    const body = [
      "# Final report",
      "",
      `Generated ${new Date().toISOString()} by \`pipeline report\` from ${cfg.progress} and ${cfg.ledger}.`,
      "",
      `- commit: \`${commitSha() ?? "unknown"}\``,
      `- pipeline version: ${progress.pipelineVersion ?? cfg.pipelineVersion}`,
      `- phase: ${progress.phase ?? "none"}`,
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
      "- calibration: see docs/12-eval/calibration-report.md. Without it, a zero-finding round is **not** evidence of a clean codebase.",
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
    ok(`wrote ${cfg.finalReport}`);
    console.log(`gate rows: ${GATE_IDS.length}, NOT_VERIFIED: ${notVerified.length}, blockers: ${progress.blockers?.length ?? 0}`);
    break;
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
    fail(`unknown command "${command}". Try: init | status | next | gate | verify | phase | freeze | blocker | estimate | report | selftests`);
}

void STATUSES;
