#!/usr/bin/env node
// Planted-bug calibration (v2-12 part 2). A zero-finding red team means nothing until you know
// what that red team would have found. This tool runs the whole protocol around a blind plant:
//
//   node pipeline/tools/calibrate.mjs plan --n 10 --seed 42 --out calibration/planted.plan.json
//   node pipeline/tools/calibrate.mjs template --plan calibration/planted.plan.json --out calibration/planted.answer.json
//        (a separate agent plants the bugs and fills the answer in; it is git-ignored)
//   node pipeline/tools/calibrate.mjs score --plan … --answer … --findings docs/08-redteam/run-1/findings.json \
//        --out calibration/calibration-report.md
//   node pipeline/tools/calibrate.mjs status --dir calibration
//
// Refusals are deliberate: a tracked answer file, an answer that does not match the plan, or a
// DIFF round as evidence all make the recall number meaningless.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ensureDir, fail, ok, paint, parseArgs, readJson, warn, writeJson } from "./lib/common.mjs";
import { BUG_CLASSES, classById, normaliseClass, selectClasses } from "./lib/bug-classes.mjs";

const { flags, positional } = parseArgs();
const [command = "status"] = positional;

const THRESHOLDS = Object.freeze({ overall: 0.7, perClassFloor: 1 });
const here = path.dirname(new URL(import.meta.url).pathname);
const pipelineVersion = (() => {
  try {
    return fs.readFileSync(path.resolve(here, "..", "VERSION"), "utf8").trim();
  } catch {
    return "unknown";
  }
})();

function cmdPlan() {
  const n = Number(flags.n ?? 10);
  const seed = Number(flags.seed ?? 1);
  const only = String(flags.classes ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const { classes, error } = selectClasses({ n, seed, only });
  if (error) fail(error);

  const plan = {
    pipelineVersion,
    seed,
    n,
    createdAt: new Date().toISOString(),
    instructions: [
      "A separate agent plants these bugs in code that already exists, on a throwaway branch that is never merged.",
      "It records file, line and a one-line description in the answer file, and shows that file to nobody else.",
      "The red team runs v2-08 unchanged, blind: the answer file is not in its context.",
      "Planted bugs must be real: reachable from an entry point the app actually has.",
    ],
    classes: classes.map((c) => ({ id: c.id, name: c.name, appliesTo: c.appliesTo, plant: c.plant, observe: c.observe, severity: c.severity })),
  };
  const out = String(flags.out ?? "calibration/planted.plan.json");
  writeJson(out, plan);
  console.log(`plan: ${classes.length} classes (seed ${seed}) → ${out}`);
  for (const c of classes) console.log(`  ${c.id.padEnd(22)} ${c.plant}`);
  console.log(`\nnext: node pipeline/tools/calibrate.mjs template --plan ${out} --out ${path.join(path.dirname(out), "planted.answer.json")}`);
}

function cmdTemplate() {
  const planPath = String(flags.plan ?? "calibration/planted.plan.json");
  if (!fs.existsSync(planPath)) fail(`no plan at ${planPath}`);
  const plan = readJson(planPath);
  const answer = {
    pipelineVersion: plan.pipelineVersion,
    plantedBy: "REPLACE: the agent that planted these must not be on the red team",
    plantedAt: new Date().toISOString(),
    branch: "REPLACE: calibration/<pipeline-version>",
    bugs: plan.classes.map((c, i) => ({ id: `P${i + 1}`, class: c.id, file: "REPLACE/path/to/file.ts", line: 0, description: `REPLACE: ${c.plant}` })),
  };
  const out = String(flags.out ?? path.join(path.dirname(planPath), "planted.answer.json"));
  ensureDir(path.dirname(out));
  fs.writeFileSync(out, `${JSON.stringify(answer, null, 2)}\n`);
  console.log(`template: ${out} (${answer.bugs.length} rows to fill)`);
  console.log("this file must be git-ignored before anyone plants anything:");
  console.log(`  echo "${path.basename(out)}" >> .gitignore   # or the whole calibration/ directory`);
}

function isIgnored(file) {
  const res = spawnSync(`git check-ignore -q "${file}"`, { shell: true, encoding: "utf8", cwd: process.cwd() });
  if (res.status === 0) return { ignored: true };
  const inside = spawnSync("git rev-parse --is-inside-work-tree", { shell: true, encoding: "utf8", cwd: process.cwd() });
  if (inside.status !== 0 || inside.stdout.trim() !== "true") return { ignored: false, noRepo: true };
  return { ignored: false };
}

const normalisePath = (p) => String(p ?? "").replace(/\\/g, "/").replace(/^\.\//, "").replace(/^.*?(?=src\/|app\/|lib\/|tests\/)/, "");

function matchPlanted(bug, findings) {
  const wanted = normaliseClass(bug.class);
  const file = normalisePath(bug.file);
  for (const f of findings) {
    const fc = normaliseClass([f.class, f.title, f.cwe, f.category].filter(Boolean).join(" "));
    if (wanted && fc !== wanted) continue;
    const loc = normalisePath(f.location);
    const sameFile = file && loc.startsWith(file);
    if (!sameFile) continue;
    const line = Number(String(f.location ?? "").split(":").pop());
    if (bug.line && Number.isFinite(line) && line > 0 && Math.abs(line - Number(bug.line)) > 25) continue;
    return f;
  }
  return null;
}

function cmdScore() {
  const planPath = String(flags.plan ?? "calibration/planted.plan.json");
  const answerPath = String(flags.answer ?? "calibration/planted.answer.json");
  const findingsPath = String(flags.findings ?? "docs/08-redteam/run-1/findings.json");
  for (const [label, p] of [["plan", planPath], ["answer", answerPath], ["findings", findingsPath]]) {
    if (!fs.existsSync(p)) fail(`no ${label} at ${p}`);
  }

  const plan = readJson(planPath);
  const answer = readJson(answerPath);
  const findingsFile = readJson(findingsPath);

  // 1 · the answer must be hidden
  const hidden = isIgnored(answerPath);
  if (!hidden.ignored && !hidden.noRepo && !flags["allow-tracked"]) {
    fail(`${answerPath} is tracked by git — a plant that can be read is not a blind test (add it to .gitignore, or pass --allow-tracked)`);
  }
  if (hidden.noRepo) warn("not inside a git repository, so the answer file cannot be committed by accident");

  // 2 · the answer must answer this plan
  const planned = plan.classes.map((c) => c.id).sort();
  const planted = (answer.bugs ?? []).map((b) => normaliseClass(b.class) ?? String(b.class)).sort();
  const notInPlan = planted.filter((c) => !planned.includes(c));
  if (notInPlan.length) fail(`the answer plants ${[...new Set(notInPlan)].join(", ")}, which the plan did not ask for — rerun plan and answer together`);
  const missing = planned.filter((c) => !planted.includes(c));
  if (missing.length) fail(`the plan asked for ${missing.join(", ")} and the answer does not include them`);

  // 3 · the evidence must be a FULL round, blind
  if (findingsFile.mode && findingsFile.mode !== "FULL") {
    fail(`the findings file is a ${findingsFile.mode} round; a differential run cannot measure recall`);
  }
  const confirmed = (findingsFile.findings ?? []).filter((f) => f.status === "confirmed");

  // 4 · match
  const rows = (answer.bugs ?? []).map((bug) => {
    const hit = matchPlanted(bug, confirmed);
    return { planted: bug, matched: Boolean(hit), findingId: hit?.id ?? null };
  });
  const found = rows.filter((r) => r.matched).length;
  const recall = rows.length ? found / rows.length : 0;

  const perClass = {};
  for (const r of rows) {
    const id = normaliseClass(r.planted.class) ?? String(r.planted.class);
    perClass[id] = perClass[id] ?? { planted: 0, found: 0, name: classById(id)?.name ?? id };
    perClass[id].planted++;
    if (r.matched) perClass[id].found++;
  }
  const zeroClasses = Object.entries(perClass).filter(([, v]) => v.found === 0).map(([k]) => k);

  const unplanted = confirmed.filter((f) => !rows.some((r) => r.findingId === f.id));
  const calibrated = recall >= THRESHOLDS.overall && zeroClasses.length === 0;

  const result = {
    pipelineVersion: plan.pipelineVersion,
    calibrated,
    recall,
    planted: rows.length,
    found,
    threshold: THRESHOLDS.overall,
    perClass,
    zeroRecallClasses: zeroClasses,
    unplantedConfirmed: unplanted.map((f) => f.id),
    findingsRound: findingsFile.mode ?? "unknown",
    example: plan.seed,
    byRule: { potted: rows.length },
    at: new Date().toISOString(),
  };

  const reportPath = String(flags.out ?? path.join(path.dirname(planPath), "calibration-report.md"));
  const jsonPath = String(flags.json_out ?? flags["json-out"] ?? path.join(path.dirname(planPath), "calibration.json"));
  writeJson(jsonPath, result);

  const lines = [
    `# Red-team calibration — pipeline ${plan.pipelineVersion}`,
    "",
    `**Verdict: ${calibrated ? "calibrated" : "INCONCLUSIVE"}**`,
    "",
    `| | |`,
    `|---|---|`,
    `| Planted | ${rows.length} |`,
    `| Confirmed by the red team | ${found} |`,
    `| Recall | ${(recall * 100).toFixed(1)}% (threshold ${(THRESHOLDS.overall * 100).toFixed(0)}%) |`,
    `| Findings round | ${findingsFile.mode ?? "unknown"} |`,
    `| Plan seed | ${plan.seed} |`,
    "",
    "## Per class",
    "",
    "| Class | Planted | Found |",
    "|---|---|---|",
    ...Object.entries(perClass).map(([id, v]) => `| ${v.name} (\`${id}\`) | ${v.planted} | ${v.found} |`),
    "",
    ...(zeroClasses.length ? [`**Classes with zero recall:** ${zeroClasses.join(", ")} — the red team does not detect these at all.`, ""] : []),
    ...(unplanted.length
      ? [`## Confirmed findings that were not planted (${unplanted.length})`, "", "These are either real bugs the plant did not include, or false positives. Both need triage:", "", ...unplanted.map((f) => `- ${f.id} ${f.severity}: ${f.title}`), ""]
      : []),
    "## Caveats that must travel with these numbers",
    "",
    "- Sample size is small by construction; a single miss moves recall by more than ten points.",
    "- Planted bugs are usually easier to find than natural ones, so recall is an **upper bound** on real detection.",
    "- Recall says nothing about precision: read the unplanted list before celebrating.",
    "- This measures *this* pipeline version with *this* model set. Re-calibrate after changing the `08` prompts.",
    "",
    `Generated ${new Date().toISOString()} by pipeline/tools/calibrate.mjs`,
    "",
  ];
  ensureDir(path.dirname(reportPath));
  fs.writeFileSync(reportPath, lines.join("\n"));

  console.log(`planted ${rows.length} · found ${found} · recall ${(recall * 100).toFixed(1)}%`);
  for (const [id, v] of Object.entries(perClass)) console.log(`  ${v.found === 0 ? paint.red("MISS") : paint.green("ok  ")} ${id.padEnd(22)} ${v.found}/${v.planted}`);
  console.log(`report: ${reportPath}`);
  console.log(`machine record: ${jsonPath}`);
  if (!calibrated) {
    console.log(paint.red("RESULT: INCONCLUSIVE"));
    if (recall < THRESHOLDS.overall) console.log(`  recall ${(recall * 100).toFixed(1)}% is below the ${(THRESHOLDS.overall * 100).toFixed(0)}% floor`);
    if (zeroClasses.length) console.log(`  no detection at all for: ${zeroClasses.join(", ")}`);
    console.log("  every report from this pipeline version must say \"red team inconclusive\" until this passes");
    process.exit(1);
  }
  ok("RESULT: CALIBRATED");
  process.exit(0);
}

function cmdStatus() {
  const dir = String(flags.dir ?? "calibration");
  const jsonPath = path.join(dir, "calibration.json");
  if (!fs.existsSync(jsonPath)) {
    console.log(paint.yellow(`NOT_VERIFIED: calibration has not been run for pipeline ${pipelineVersion}`));
    console.log(`human command: node pipeline/tools/calibrate.mjs plan --n 10 --seed <n> --out ${path.join(dir, "planted.plan.json")}`);
    process.exit(3);
  }
  const r = readJson(jsonPath);
  const stale = r.pipelineVersion !== pipelineVersion;
  if (r.calibrated && !stale) {
    ok(`calibration: calibrated for ${r.pipelineVersion} — recall ${(r.recall * 100).toFixed(1)}% on ${r.planted} planted bugs`);
    process.exit(0);
  }
  console.log(paint.yellow(`NOT_VERIFIED: calibration is ${stale ? `stale (measured on ${r.pipelineVersion}, pipeline is ${pipelineVersion})` : "inconclusive"} — recall ${(r.recall * 100).toFixed(1)}%`));
  console.log("human command: node pipeline/tools/calibrate.mjs plan --n 10 --seed <n> --out calibration/planted.plan.json, then score it against a FULL round");
  console.log("the report must say \"red team not calibrated\" next to any zero-finding claim");
  process.exit(3);
}

function cmdClasses() {
  for (const c of BUG_CLASSES) console.log(`  ${c.id.padEnd(22)} ${c.severity.padEnd(9)} ${c.name}`);
  console.log(`\n${BUG_CLASSES.length} classes in the catalogue`);
}

const commands = { plan: cmdPlan, template: cmdTemplate, score: cmdScore, status: cmdStatus, classes: cmdClasses, help: cmdClasses };
if (!commands[command]) fail(`unknown command "${command}". Known: ${Object.keys(commands).join(", ")}`);
commands[command]();
