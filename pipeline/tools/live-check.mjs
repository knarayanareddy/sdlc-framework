#!/usr/bin/env node
// P6 · the live environment, as a checklist an agent can fill in and a human can finish.
//
// Four things cannot be done from inside this repository: a verifier model from another family,
// a container runtime, `nuclei` + `schemathesis`, and a blind calibration round on a real
// product. Everything that *can* be done without those is done by `prep`; what is left is
// printed as one copy-pasteable command per item, and nothing is ever reported as ready because
// a file exists.
//
//   node pipeline/tools/live-check.mjs probe  [--json] [--out docs/13-live/live-readiness.json]
//   node pipeline/tools/live-check.mjs prep   [--out docs/13-live]
//   node pipeline/tools/live-check.mjs verify [--run] [--out docs/13-live/live-readiness.json]
//
// Exit: 0 every item is in place · 3 NOT_VERIFIED (the list of what is left) · 1 NOT_VERIFIED
// with a broken item. There is deliberately no exit code that means "probably fine".
//
// This tool does not add a gate. Each item names the gate that already consumes its evidence:
// a verifier flips `G9 --builtin independence`, a sandbox flips `G0 --builtin sandbox`, scanners
// flip `G8 --builtin dast`, a calibration flips `G12 --builtin calibrate`. Inventing a fifth
// gate for readiness would just be a gate that passes when a directory exists.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ensureDir, ok, paint, parseArgs, readJson, writeJson } from "./lib/common.mjs";
import { DEFAULT_FAMILIES, familyOf, mergeFamilies } from "./lib/families.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PIPELINE = path.resolve(HERE, "..");
const VERSION = fs.readFileSync(path.join(PIPELINE, "VERSION"), "utf8").trim();

const { flags, positional } = parseArgs();
const [command = "probe"] = positional;
const cwd = path.resolve(String(flags.cwd ?? process.cwd()));
const outDir = path.resolve(cwd, String(flags.out ?? "docs/13-live"));
const asJson = Boolean(flags.json);

const at = (p) => path.resolve(cwd, p);
const readIfJson = (p) => {
  try {
    return readJson(at(p));
  } catch {
    return null;
  }
};
const toolPath = (name) => path.join(HERE, name);

/** Run a pipeline tool (or any binary) and return {status, stdout, stderr}; never throws. */
function run(cmd, args = [], opts = {}) {
  const res = spawnSync(cmd, args, { encoding: "utf8", cwd: opts.cwd ?? cwd, timeout: opts.timeout ?? 60_000, input: opts.input, env: { ...process.env, ...(opts.env ?? {}) } });
  return { status: res.status ?? (res.error ? 127 : 1), stdout: res.stdout ?? "", stderr: res.stderr ?? "", error: res.error?.message ?? null };
}
const pipelineTool = (file, args, opts) => run(process.execPath, [toolPath(file), ...args], opts);

function config() {
  const file = at(flags.config ?? "pipeline.config.json");
  const doc = fs.existsSync(file) ? readJson(file) : {};
  return { file, doc };
}

function familiesTable(cfg) {
  const fromConfig = cfg.doc.verifierFamilies ?? null;
  return mergeFamilies(fromConfig, (f) => (typeof f === "string" ? readJson(at(f)) : f));
}

// ---------------------------------------------------------------------------------------
// The four items. Each returns { id, title, state, why, next, accept, flips, evidence }.
// `state` is one of ready | partial | blocked. Nothing returns ready from a file existing
// unless that file is the evidence the gate itself reads.
// ---------------------------------------------------------------------------------------

function probeVerifier(cfg, table, { exercise = false } = {}) {
  const builderModel = cfg.doc.independence?.builderFamily && cfg.doc.independence.builderFamily !== "unknown" ? null : process.env.PIPELINE_BUILDER_MODEL ?? null;
  const declared = cfg.doc.independence?.builderFamily ?? null;
  const builder = declared && declared !== "unknown" ? declared : familyOf(builderModel, table);
  const verifierModel = process.env.PIPELINE_VERIFIER_MODEL ?? cfg.doc.verifier?.model ?? "";
  const transport = process.env.PIPELINE_VERIFIER_CMD ?? cfg.doc.verifier?.cmd ?? "";
  const family = familyOf(verifierModel, table);

  const evidence = [
    { what: "builder family", value: builder === "unknown" ? "unknown" : builder, from: declared ? "pipeline.config.json → independence.builderFamily" : "PIPELINE_BUILDER_MODEL" },
    { what: "verifier model", value: verifierModel || "(not set)", from: "PIPELINE_VERIFIER_MODEL or pipeline.config.json → verifier.model" },
    { what: "verifier family", value: family, from: "lib/families.mjs table" },
    { what: "transport", value: transport || "(not set)", from: "PIPELINE_VERIFIER_CMD or pipeline.config.json → verifier.cmd" },
  ];

  // Absent configuration is BLOCKED; present-but-wrong is PARTIAL. A same-family verifier is
  // configured, and still not a second opinion — it must not read as "nearly there".
  const absent = [];
  const wrong = [];
  if (builder === "unknown") absent.push("no known builder family");
  if (!verifierModel) absent.push("no verifier model named");
  if (!transport) absent.push("no verifier transport configured");
  if (verifierModel && family === "unknown") wrong.push(`verifier model "${verifierModel}" has no known family (add it to verifierFamilies)`);
  if (builder !== "unknown" && family !== "unknown" && builder === family) wrong.push(`verifier is the same family as the builder ("${family}")`);
  const missing = [...absent, ...wrong];

  const next = [
    !declared || declared === "unknown" ? `export PIPELINE_BUILDER_MODEL="${builderModel ?? "claude-sonnet-4"}"   # or set independence.builderFamily in pipeline.config.json` : null,
    !verifierModel ? "export PIPELINE_VERIFIER_MODEL=\"gpt-5\"   # any model from another family" : null,
    !transport ? 'export PIPELINE_VERIFIER_CMD="node pipeline/examples/verifier-transport.example.mjs"' : null,
    "export PIPELINE_VERIFIER_URL=\"https://…/v1/chat/completions\" PIPELINE_VERIFIER_KEY=\"…\"",
    "node pipeline/tools/verifier-route.mjs dispatch --envelope docs/13-live/verifier-envelope.json --out docs/13-live/verdicts.json",
  ].filter(Boolean);

  // probe reads strings; it dispatches nothing. READY is reserved for `verify --run`, which is
  // the only command in this file that executes the transport (SECOND-OPINION-3 G-19).
  return {
    id: "verifier",
    title: "a verifier model from another family, with a transport",
    state: wrong.length ? "partial" : absent.length ? "blocked" : exercise ? "ready" : "partial",
    why: missing.length
      ? missing.join("; ")
      : exercise
        ? `${family} verifies ${builder}; the transport was exercised`
        : `${family} verifies ${builder} — configured, not executed; \`live-check verify --run\` is what dispatches`,
    next,
    accept: "verifier-route.mjs check --envelope docs/13-live/verifier-envelope.json --verdict docs/13-live/verdicts.json exits 0, and the ledger row records modelFamily",
    flips: "G9 --builtin independence (and G7 when used there)",
    evidence,
  };
}

function probeSandbox(cfg) {
  const check = pipelineTool("sandbox.mjs", ["check", "--json"]);
  let caps = null;
  try {
    caps = JSON.parse(check.stdout);
  } catch {
    caps = null;
  }
  if (!caps) {
    return { id: "sandbox", title: "a container runtime", state: "blocked", why: `sandbox.mjs check failed (exit ${check.status}): ${(check.stderr || check.stdout).split("\n")[0]}`, next: ["node pipeline/tools/sandbox.mjs check"], accept: "sandbox.mjs check exits 0 with docker available", flips: "G0 --builtin sandbox", evidence: [] };
  }
  const dockerOnPath = Boolean(caps.docker?.available);
  // `command -v docker` proves a file exists, not that a daemon answers. Ask it, once.
  const dockerInfo = dockerOnPath ? run("docker", ["info", "--format", "{{.ServerVersion}}"], { timeout: 20_000 }) : null;
  // A stub that exits 0 with no output is not a daemon. `docker info --format` prints a version
  // when something answers, and nothing when a script pretends to (G-19).
  const docker = dockerOnPath && dockerInfo?.status === 0 && String(dockerInfo.stdout ?? "").trim().length > 0;
  const bubblewrap = Boolean(caps.bubblewrap?.available && caps.networkNamespace?.available);
  const ready = docker || bubblewrap;
  const next = [];
  if (dockerOnPath && !docker) next.push(`the docker binary is on PATH but the daemon did not answer (exit ${dockerInfo?.status}): ${(dockerInfo?.stderr || dockerInfo?.stdout || "").trim().split("\n")[0] || "no output"} — start it, or add yourself to the docker group`);
  if (!ready) {
    next.push("install docker (or bubblewrap + an unprivileged network namespace), then re-run this probe");
    next.push("node pipeline/tools/sandbox.mjs check");
  }
  next.push("node pipeline/tools/live-check.mjs prep    # writes docs/13-live/sandbox.compose.yml and verifies it");
  next.push("docker compose -f " + String(cfg.profile ?? "docs/13-live/sandbox.compose.yml") + " run --rm sandbox node --version");
  return {
    id: "sandbox",
    title: "a container runtime that can actually run the workload",
    state: ready ? "ready" : dockerOnPath ? "partial" : "blocked",
    why: ready
      ? docker
        ? `docker daemon ${dockerInfo.stdout.trim()}`
        : "bubblewrap + network namespace"
      : dockerOnPath
        ? "docker is installed but the daemon does not answer, so nothing can be run in it yet"
        : "no docker and no bubblewrap+netns: every sandbox run is NOT_VERIFIED for the controls it cannot apply",
    next,
    accept: "a command executed inside the container, with --network none, and its output recorded",
    flips: "G0 --builtin sandbox",
    evidence: [
      ...Object.entries(caps).filter(([k]) => k !== "platform").map(([what, v]) => ({ what, value: v.available ? "available" : "missing", from: v.how })),
      { what: "docker info", value: dockerInfo ? (dockerInfo.status === 0 ? dockerInfo.stdout.trim() : `exit ${dockerInfo.status}`) : "not on PATH", from: "docker info --format {{.ServerVersion}}" },
    ],
  };
}

function probeScanners() {
  const plan = pipelineTool("dast.mjs", ["plan", "--json"]);
  let rows = null;
  try {
    rows = JSON.parse(plan.stdout);
  } catch {
    rows = null;
  }
  if (!Array.isArray(rows)) {
    return { id: "scanners", title: "nuclei + schemathesis", state: "blocked", why: `dast.mjs plan failed (exit ${plan.status})`, next: ["node pipeline/tools/dast.mjs plan"], accept: "nuclei and schemathesis both report a version", flips: "G8 --builtin dast", evidence: [] };
  }
  const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
  const required = ["nuclei", "schemathesis"];
  const missing = required.filter((n) => !byName[n]?.available);
  const optionalMissing = Object.keys(byName).filter((n) => !byName[n].available && !required.includes(n) && n !== "pipeline-fuzz");
  return {
    id: "scanners",
    title: "nuclei + schemathesis on PATH",
    state: missing.length === 0 ? "ready" : missing.length === required.length ? "blocked" : "partial",
    why: missing.length ? `not installed: ${missing.join(", ")}${optionalMissing.length ? ` (optional: ${optionalMissing.join(", ")})` : ""}` : `installed${optionalMissing.length ? `; optional missing: ${optionalMissing.join(", ")}` : ""}`,
    next: missing.length ? [...missing.map((n) => byName[n]?.install ?? `install ${n}`), "node pipeline/tools/dast.mjs plan"] : ["node pipeline/tools/dast.mjs run --target <url> --contract api-contract.json --out docs/13-live"],
    accept: "dast.mjs run produces a parseable artifact from a real target, and the leads are triaged",
    flips: "G8 --builtin dast",
    evidence: rows.map((r) => ({ what: r.name, value: r.available ? "installed" : "missing", from: r.install })),
  };
}

function probeCalibration(cfg, seed = 1729) {
  const dir = String(cfg.calibrationDir ?? "calibration");
  const status = pipelineTool("calibrate.mjs", ["status", "--dir", dir]);
  const plan = fs.existsSync(at(path.join(dir, "planted.plan.json")));
  const answer = fs.existsSync(at(path.join(dir, "planted.answer.json")));
  const report = fs.existsSync(at(path.join(dir, "calibration.json")));
  const ready = status.status === 0;
  const next = [];
  if (!plan) next.push(`node pipeline/tools/calibrate.mjs plan --n 10 --seed ${seed} --out ${dir}/planted.plan.json`);
  if (!answer) next.push(`node pipeline/tools/calibrate.mjs template --plan ${dir}/planted.plan.json --out ${dir}/planted.answer.json   # an agent that is NOT on the red team fills this in`);
  if (!report) next.push(`node pipeline/tools/calibrate.mjs score --plan ${dir}/planted.plan.json --answer ${dir}/planted.answer.json --findings docs/08-redteam/run-1/findings.json --out ${dir}/calibration-report.md`);
  next.push("the whole procedure is in pipeline/P6-LIVE.md §4 — a thrown-away branch, a blind round, one linear list");
  return {
    id: "calibration",
    title: "a blind planted-bug round on a real product",
    state: ready ? "ready" : plan || answer || report ? "partial" : "blocked",
    why: ready ? `calibrated for ${VERSION}` : report ? `a calibration file exists but does not cover ${VERSION}` : plan ? "planned; the plants are not scored yet" : "no plan: the red team has never been measured",
    next,
    accept: "calibrate.mjs status exits 0 for this pipeline version, and the report quotes recall with n",
    flips: "G12 --builtin calibrate",
    evidence: [
      { what: "plan", value: plan ? "present" : "missing", from: `${dir}/planted.plan.json` },
      { what: "blind answer", value: answer ? "present" : "missing", from: `${dir}/planted.answer.json (gitignored)` },
      { what: "score", value: report ? "present" : "missing", from: `${dir}/calibration.json` },
      { what: "status", value: `exit ${status.status}`, from: (status.stdout || status.stderr).trim().split("\n")[0] },
    ],
  };
}

function probeAll({ exercise = false } = {}) {
  const cfg = config();
  const table = familiesTable(cfg);
  const items = [probeVerifier(cfg, table, { exercise }), probeSandbox({ profile: cfg.doc.sandboxProfile ?? "docs/13-live/sandbox.compose.yml" }), probeScanners(), probeCalibration({ calibrationDir: cfg.doc.calibrationDir }, Number(flags.seed ?? 1729))];

  if (exercise) {
    // Exercises that need no credential and change nothing: prove the binary can answer, not
    // that a file with its name exists on PATH.
    const byId = Object.fromEntries(items.map((i) => [i.id, i]));
    const nuclei = run("nuclei", ["-version"], { timeout: 20_000 });
    if (byId.scanners) byId.scanners.evidence.push({ what: "nuclei -version", value: nuclei.status === 0 ? (nuclei.stdout || nuclei.stderr).trim().split("\n")[0] : `exit ${nuclei.status}`, from: "nuclei -version" });
    const schema = run("schemathesis", ["--version"], { timeout: 20_000 });
    if (byId.scanners) byId.scanners.evidence.push({ what: "schemathesis --version", value: schema.status === 0 ? (schema.stdout || schema.stderr).trim().split("\n")[0] : `exit ${schema.status}`, from: "schemathesis --version" });
    // The transport is exercised against the staged envelope: request shape only, no network.
    const envelope = at("docs/13-live/verifier-envelope.json");
    if (fs.existsSync(envelope)) {
      const env = readJson(envelope);
      const dry = run(process.execPath, [path.join(PIPELINE, "examples", "verifier-transport.example.mjs"), "--dry-run"], { input: JSON.stringify({ prompt: "dry run", envelope: env }), timeout: 30_000 });
      if (byId.verifier) {
        byId.verifier.evidence.push({ what: "transport --dry-run", value: dry.status === 0 ? "request built" : `exit ${dry.status}`, from: "examples/verifier-transport.example.mjs --dry-run" });
        if (dry.status === 0 && fs.existsSync(at("docs/13-live/verifier-request.json")) === false) writeJson(at("docs/13-live/verifier-request.json"), { ...JSON.parse(dry.stdout), at: new Date().toISOString() });
      }
    }
  }

  return { pipelineVersion: VERSION, probedAt: new Date().toISOString(), cwd, items };
}

// ---------------------------------------------------------------------------------------
function summarise(report) {
  const ready = report.items.filter((i) => i.state === "ready").length;
  return { ready, total: report.items.length, allReady: ready === report.items.length };
}

function printReport(report) {
  const { ready, total } = summarise(report);
  console.log(paint.bold(`P6 · live environment — ${ready}/${total} in place`));
  for (const item of report.items) {
    const mark = item.state === "ready" ? paint.green("READY  ") : item.state === "partial" ? paint.yellow("PARTIAL") : paint.red("BLOCKED");
    console.log(`  ${mark} ${item.id.padEnd(12)} ${item.why}`);
    if (item.state !== "ready") {
      for (const n of item.next) console.log(`          ${paint.dim("→")} ${n}`);
    }
    console.log(`          ${paint.dim(`flips: ${item.flips}`)}`);
  }
  if (ready === total) {
    ok("RESULT: PASS — all four P6 items are in place; the gates they feed can now be recorded as evidence");
  } else {
    console.log(paint.yellow(`RESULT: NOT_VERIFIED — ${total - ready} item(s) not in place. Every line above is the last mile; nothing else in P6 is outstanding.`));
  }
}

function withArtifact(report, { write = true } = {}) {
  if (write) {
    ensureDir(outDir);
    const file = path.join(outDir, "live-readiness.json");
    writeJson(file, report);
    console.log(paint.dim(`written: ${path.relative(cwd, file)}`));
  }
}

// ---------------------------------------------------------------------------------------
// prep · everything that can be done without the four missing pieces.
// ---------------------------------------------------------------------------------------
function prep() {
  ensureDir(outDir);
  const cfg = config();
  const table = familiesTable(cfg);
  const did = [];
  const exists = (p) => fs.existsSync(at(p));
  const step = (label, file, fn) => {
    if (file && exists(file)) {
      did.push({ what: label, result: `exists, left alone (${file})` });
      return;
    }
    const res = fn();
    did.push({ what: label, result: res });
  };

  // 1 · the two config blocks, as a paste-ready snippet (never edit their config for them).
  step("config snippet", "docs/13-live/config.snippet.json", () => {
    const snippet = {
      independence: { builderFamily: process.env.PIPELINE_BUILDER_MODEL ? familyOf(process.env.PIPELINE_BUILDER_MODEL, table) : "anthropic", requireFor: ["G7", "G9"] },
      verifier: { model: process.env.PIPELINE_VERIFIER_MODEL ?? "gpt-5", cmd: process.env.PIPELINE_VERIFIER_CMD ?? "node pipeline/examples/verifier-transport.example.mjs" },
      sandboxProfile: "docs/13-live/sandbox.compose.yml",
    };
    writeJson(at("docs/13-live/config.snippet.json"), snippet);
    return "wrote the two blocks to merge into pipeline.config.json";
  });

  // 2 · sandbox profile, generated and validated (validating never needs docker).
  step("sandbox profile", "docs/13-live/sandbox.compose.yml", () => {
    const gen = pipelineTool("sandbox.mjs", ["profile", "--out", "docs/13-live/sandbox.compose.yml"]);
    if (gen.status !== 0) return `FAILED to generate (exit ${gen.status}): ${(gen.stderr || gen.stdout).split("\n")[0]}`;
    const ver = pipelineTool("sandbox.mjs", ["verify", "--file", "docs/13-live/sandbox.compose.yml"]);
    return ver.status === 0 ? "generated and verified against the hardening floor" : `generated, but verify failed: ${(ver.stdout || ver.stderr).split("\n")[0]}`;
  });

  // 3 · what the scanners would run, so the install lines and the exact commands are on disk.
  step("DAST plan", "docs/13-live/dast-plan.json", () => {
    const plan = pipelineTool("dast.mjs", ["plan", "--json"]);
    if (plan.status !== 0) return `FAILED (exit ${plan.status})`;
    let rows;
    try {
      rows = JSON.parse(plan.stdout);
    } catch {
      return "FAILED: dast plan did not emit JSON";
    }
    writeJson(at("docs/13-live/dast-plan.json"), { at: new Date().toISOString(), tools: rows });
    const missing = rows.filter((r) => !r.available).map((r) => r.name);
    return `wrote the plan (${rows.length} adapters, ${missing.length} not installed: ${missing.join(", ")})`;
  });

  // 4 · the verifier envelope, built from the real spec — dispatchable the moment a key exists.
  step("verifier envelope", "docs/13-live/verifier-envelope.json", () => {
    const spec = exists("docs/02-spec/SPEC.md") ? "docs/02-spec/SPEC.md" : exists("README.md") ? "README.md" : null;
    if (!spec) return "SKIPPED: no docs/02-spec/SPEC.md and no README.md to seal into an envelope";
    const builder = cfg.doc.independence?.builderFamily ?? familyOf(process.env.PIPELINE_BUILDER_MODEL ?? "claude-sonnet", table);
    const res = pipelineTool("verifier-route.mjs", ["route", "--phase", "07", "--gate", "G7", "--author-model", process.env.PIPELINE_BUILDER_MODEL ?? `${builder}-unknown-model`, "--task", "the build matches the spec", "--files", spec, "--out", "docs/13-live/verifier-envelope.json"]);
    return res.status === 0 ? `built from ${spec} (hash-sealed; dispatch it when a key exists)` : `FAILED (exit ${res.status}): ${(res.stderr || res.stdout).split("\n")[0]}`;
  });

  // 5 · a calibration plan and its blind answer template. The plan is deterministic from the
  // seed, so this is safe to prepare; the answer file stays gitignored and unfilled.
  step("calibration plan", "calibration/planted.plan.json", () => {
    const seed = Number(flags.seed ?? 1729);
    const res = pipelineTool("calibrate.mjs", ["plan", "--n", String(flags.n ?? 10), "--seed", String(seed), "--out", "calibration/planted.plan.json"]);
    return res.status === 0 ? `planned ${flags.n ?? 10} plants, seed ${seed}` : `FAILED (exit ${res.status}): ${(res.stderr || res.stdout).split("\n")[0]}`;
  });
  step("calibration answer template", "calibration/planted.answer.json", () => {
    const res = pipelineTool("calibrate.mjs", ["template", "--plan", "calibration/planted.plan.json", "--out", "calibration/planted.answer.json"]);
    return res.status === 0 ? "wrote the blank answer file (gitignored; a different agent fills it in)" : `SKIPPED: ${(res.stderr || res.stdout).split("\n")[0]}`;
  });

  // 6 · the written plan, generated from the probes so it cannot drift from the tool.
  const report = probeAll();
  const lines = [
    "# P6 · live environment — what is prepared, and what is left",
    "",
    `Generated ${report.probedAt} by \`node pipeline/tools/live-check.mjs prep\` from pipeline ${report.pipelineVersion}.`,
    "Regenerate it; do not hand-edit it. The four items below are the only part of the",
    "framework that cannot be completed inside this repository.",
    "",
    "| Item | State | Why | Flips |",
    "|---|---|---|---|",
    ...report.items.map((i) => `| ${i.id} | ${i.state} | ${i.why.replace(/\|/g, "\\|")} | ${i.flips} |`),
    "",
    "## The last mile, in order",
    "",
    ...report.items.flatMap((i, n) => [
      `### ${n + 1} · ${i.id} — ${i.title}`,
      "",
      `State: **${i.state}** — ${i.why}`,
      "",
      "```bash",
      ...i.next,
      "```",
      "",
      `**Accepted when:** ${i.accept}`,
      "",
    ]),
    "## Acceptance for the whole phase",
    "",
    "```bash",
    "node pipeline/tools/live-check.mjs verify --run    # exit 0 only when all four are in place",
    "```",
    "",
    "Then re-record the gates these feed (`G0 --builtin sandbox`, `G8 --builtin dast`,",
    "`G9 --builtin independence`, `G12 --builtin calibrate`) and regenerate the report.",
    "",
  ];
  fs.writeFileSync(at("docs/13-live/live-plan.md"), lines.join("\n"));

  if (asJson) {
    console.log(JSON.stringify({ prepared: did, plan: "docs/13-live/live-plan.md", report }, null, 2));
  } else {
    console.log(paint.bold("prepared (nothing here needs your key, docker or a scanner):"));
    for (const d of did) console.log(`  ${d.what.padEnd(28)} ${d.result}`);
    console.log(`\nwritten: docs/13-live/live-plan.md`);
    console.log("");
    printReport(report);
  }
  // prep never claims the phase is done: it prepares, the human finishes.
  process.exit(0);
}

// ---------------------------------------------------------------------------------------
const commands = {
  probe() {
    const report = probeAll();
    if (asJson) {
      console.log(JSON.stringify(report, null, 2));
      if (flags.out) withArtifact(report);
    } else {
      printReport(report);
      withArtifact(report);
    }
    process.exit(summarise(report).allReady ? 0 : 3);
  },
  verify() {
    const report = probeAll({ exercise: Boolean(flags.run) });
    report.verifiedAt = new Date().toISOString();
    report.exercised = Boolean(flags.run);
    printReport(report);
    withArtifact(report);
    process.exit(summarise(report).allReady ? 0 : 3);
  },
  prep,
  help() {
    console.log("usage: live-check.mjs probe|verify|prep [--json] [--out docs/13-live] [--run] [--cwd .]");
    console.log(`P6 items: verifier (cross-family model), sandbox (container runtime), scanners (nuclei + schemathesis), calibration (blind planted-bug round)`);
    console.log("Families known: " + Object.keys(DEFAULT_FAMILIES).join(" "));
  },
};
if (!commands[command]) {
  console.error(`unknown command "${command}". Known: ${Object.keys(commands).join(", ")}`);
  process.exit(1);
}
commands[command]();
