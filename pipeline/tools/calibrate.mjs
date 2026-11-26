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
import crypto from "node:crypto";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ensureDir, fail, ok, paint, parseArgs, readJson, warn, writeJson } from "./lib/common.mjs";
import { BUG_CLASSES, classById, normaliseClass, selectClasses } from "./lib/bug-classes.mjs";
import { fileURLToPath } from "node:url";

const { flags, positional } = parseArgs();
const [command = "status"] = positional;

const THRESHOLDS = Object.freeze({ overall: 0.7, minPlanted: 5 });
// The pass mark is derived from the sample, not asserted independently of it: below
// `minPlanted`, a recall of 3/4 and 4/4 are the same observation, so only a perfect run
// counts; above it, the target is ceil(0.7 x n) hits. A class that was never detected is a
// failure at any sample size — that is evidence of absence, not a rate.
const here = path.dirname(fileURLToPath(import.meta.url));

const sha256 = (text) => crypto.createHash("sha256").update(String(text), "utf8").digest("hex");
const sha256File = (file) => (fs.existsSync(file) ? sha256(fs.readFileSync(file, "utf8")) : null);

// The rule is "changing the red-team prompts invalidates calibration", so these are what the
// artefact is keyed to — not the version string, which changes for doc fixes and tool tweaks
// that have nothing to do with the red team (SECOND-OPINION-3 G-14, disagreement 3).
const PROMPT_FILES = [
  "prompts/v2-08-redteam.md",
  "prompts/v2-09-patch-and-validate.md",
  "tools/lib/bug-classes.mjs",
];
const promptFingerprint = () => {
  const rows = PROMPT_FILES.map((rel) => ({ path: rel, sha256: sha256File(path.resolve(here, "..", rel)) }));
  return sha256(rows.map((r) => `${r.path}:${r.sha256}`).join("|"));
};
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

// Only the noise is stripped: a leading `./` and the repo root. It used to cut everything
// before the first src/|app/|lib/|tests/, so `packages/a/src/h.ts` and `packages/b/src/h.ts`
// were the same path and a finding in one package matched a bug planted in the other
// (SECOND-OPINION-3 G-14).
const normalisePath = (p) => {
  let out = String(p ?? "").replace(/\\/g, "/").replace(/^\.\//, "");
  while (out.startsWith("/")) out = out.slice(1);
  return out;
};

// `src/a.ts`, `src/a.ts:12`, `src/a.ts:12:5` and `src/a.ts:12-20` all have to parse: the
// old reader took the last colon-separated token, so a line:col location was read as the
// column and a range was read as NaN (which then skipped the line check entirely).
function parseLocation(value) {
  const raw = String(value ?? "").trim();
  const m = raw.match(/^(.*?):(\d+)(?::\d+)?(?:\s*[-–]\s*(\d+))?$/);
  if (!m) return { file: normalisePath(raw), from: null, to: null };
  const from = Number(m[2]);
  const to = m[3] === undefined ? from : Number(m[3]);
  return { file: normalisePath(m[1]), from, to: Math.max(from, to) };
}

// A path is a path, not a prefix: `src/app/api/item` used to match `src/app/api/items2/…`.
function samePath(actual, expected) {
  if (!actual || !expected) return false;
  return actual === expected || actual.startsWith(`${expected}/`);
}

const WINDOW = 25;

function matchPlanted(bug, findings, taken) {
  const wanted = normaliseClass(bug.class);
  const { file } = parseLocation(bug.file);
  const plantedLine = Number(bug.line);
  const locate = (f) => {
    const loc = parseLocation(f.location);
    if (!samePath(loc.file, file)) return null;
    const distance = plantedLine && loc.from ? Math.min(Math.abs(loc.from - plantedLine), Math.abs(loc.to - plantedLine)) : 0;
    return { loc, distance };
  };

  // 1 · the class, in the right file, near the planted line.
  let best = null;
  let bestDistance = Infinity;
  for (const f of findings) {
    if (taken.has(f)) continue;
    const fc = normaliseClass([f.class, f.title, f.cwe, f.category].filter(Boolean).join(" "));
    if (wanted && fc !== wanted) continue;
    const at = locate(f);
    if (!at) continue;
    if (plantedLine && at.loc.from && at.distance > WINDOW) continue;
    if (at.distance < bestDistance) {
      best = f;
      bestDistance = at.distance;
    }
  }
  if (best) return { finding: best, by: "class" };

  // 2 · the place, whatever the finding called it. A reviewer who describes a missing ownership
  // check as "the handler trusts the id from the URL" has found the planted bug; scoring that a
  // miss measured the plant's vocabulary, not the red team (B-32). Counted, and reported apart.
  let near = null;
  let nearDistance = Infinity;
  for (const f of findings) {
    if (taken.has(f)) continue;
    const at = locate(f);
    if (!at || !at.loc.from) continue;
    if (plantedLine && at.distance > WINDOW) continue;
    if (at.distance < nearDistance) {
      near = f;
      nearDistance = at.distance;
    }
  }
  return near ? { finding: near, by: "location" } : null;
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

  // 4 · match, WITHOUT replacement: one finding satisfying two planted bugs double-counts
  // the red team's work and inflates recall.
  const taken = new Set();
  const rows = (answer.bugs ?? []).map((bug) => {
    const hit = matchPlanted(bug, confirmed, taken);
    if (hit) taken.add(hit.finding);
    return { planted: bug, matched: Boolean(hit), findingId: hit?.finding?.id ?? null, by: hit?.by ?? null };
  });
  const byLocation = rows.filter((r) => r.by === "location").length;
  const found = rows.filter((r) => r.matched).length;
  const recall = rows.length ? found / rows.length : 0;
  const plantedCount = rows.length;
  const sampleSufficient = plantedCount >= THRESHOLDS.minPlanted;
  const requiredHits = sampleSufficient ? Math.ceil(THRESHOLDS.overall * plantedCount) : plantedCount;

  const perClass = {};
  for (const r of rows) {
    const id = normaliseClass(r.planted.class) ?? String(r.planted.class);
    perClass[id] = perClass[id] ?? { planted: 0, found: 0, name: classById(id)?.name ?? id };
    perClass[id].planted++;
    if (r.matched) perClass[id].found++;
  }
  const zeroClasses = Object.entries(perClass).filter(([, v]) => v.found === 0).map(([k]) => k);
  // Classes with a single instance have no rate; only zero detection is scored for them.
  const singleInstance = Object.entries(perClass).filter(([, v]) => v.planted === 1).map(([k]) => k);

  const unplanted = confirmed.filter((f) => !rows.some((r) => r.findingId === f.id));
  const calibrated = sampleSufficient && found >= requiredHits && zeroClasses.length === 0;

  // The file used to be a bag of numbers: a hand-written `{calibrated: true}` was believed.
  // Record what produced it, so `status` can recompute instead of trusting (G-14).
  const promptHashes = PROMPT_FILES.map((rel) => ({ path: rel, sha256: sha256File(path.resolve(here, "..", rel)) }));
  const result = {
    pipelineVersion: plan.pipelineVersion,
    planSha256: sha256(fs.readFileSync(planPath, "utf8")),
    answerSha256: sha256(fs.readFileSync(String(flags.answer), "utf8")),
    findingsSha256: sha256(fs.readFileSync(String(flags.findings ?? "docs/08-redteam/run-1/findings.json"), "utf8")),
    promptHashes,
    promptFingerprint: promptFingerprint(),
    sources: {
      plan: path.relative(process.cwd(), planPath).split(path.sep).join("/"),
      answer: path.relative(process.cwd(), String(flags.answer)).split(path.sep).join("/"),
      findings: path.relative(process.cwd(), String(flags.findings ?? "docs/08-redteam/run-1/findings.json")).split(path.sep).join("/"),
    },
    calibrated,
    recall,
    planted: plantedCount,
    found,
    threshold: THRESHOLDS.overall,
    requiredHits,
    sampleSufficient,
    minPlanted: THRESHOLDS.minPlanted,
    singleInstanceClasses: singleInstance,
    perClass,
    zeroRecallClasses: zeroClasses,
    matchedByLocation: byLocation,
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
    `| Recall | ${(recall * 100).toFixed(1)}% (${found}/${plantedCount}; pass mark ${requiredHits}/${plantedCount}${sampleSufficient ? "" : ` — below the minimum of ${THRESHOLDS.minPlanted} planted bugs`}) |`,
    `| Matched by location only | ${byLocation} (the finding named a different class; counted as a catch, not as a class hit) |`,
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

  // A calibration file is a claim, and this is the check that decides whether to believe it.
  // Before 2.8.2 it was believed on sight: `{"calibrated": true, "pipelineVersion": "2.7.0"}`
  // printed "calibrated — recall 100.0% on undefined planted bugs" (SECOND-OPINION-3 G-14).
  const problems = [];
  if (!Number.isFinite(r.recall) || !Number.isFinite(r.planted)) problems.push("the file has no recall/planted numbers");
  if (typeof r.calibrated !== "boolean") problems.push("the file does not say whether it is calibrated");
  if (!r.sources || !r.sources.plan || !r.sources.answer) {
    problems.push("the file does not name the plan and blind answer it was computed from");
  } else {
    const recompute = (key) => {
      const rel = r.sources[key];
      if (!rel) return `no ${key} recorded`;
      if (!fs.existsSync(rel)) return `the ${key} it was computed from is gone (${rel})`;
      const now = sha256(fs.readFileSync(rel, "utf8"));
      if (r[`${key}Sha256`] !== now) return `the ${key} changed since it was scored (${rel})`;
      return null;
    };
    for (const key of ["plan", "answer", "findings"]) {
      const problem = recompute(key);
      if (problem) problems.push(problem);
    }
  }
  if (r.promptFingerprint && r.promptFingerprint !== promptFingerprint()) {
    problems.push("the red-team prompts changed since the calibration was run");
  }

  const stale = r.pipelineVersion !== pipelineVersion && !r.promptFingerprint;
  if (problems.length) {
    console.log(paint.yellow(`NOT_VERIFIED: the calibration file cannot be trusted — ${problems.join("; ")}`));
    console.log("human command: node pipeline/tools/calibrate.mjs plan --n 10 --seed <n> … then score it against a FULL round");
    console.log('the report must say "red team not calibrated" next to any zero-finding claim');
    process.exit(3);
  }
  if (r.calibrated) {
    ok(`calibration: calibrated — recall ${(r.recall * 100).toFixed(1)}% on ${r.planted} planted bugs (prompts ${String(r.promptFingerprint).slice(0, 12)}…)`);
    process.exit(0);
  }
  console.log(paint.yellow(`NOT_VERIFIED: calibration is ${stale ? `stale (measured on ${r.pipelineVersion}, pipeline is ${pipelineVersion})` : "inconclusive"} — recall ${(r.recall * 100).toFixed(1)}%`));
  console.log("human command: node pipeline/tools/calibrate.mjs plan --n 10 --seed <n> --out calibration/planted.plan.json, then score it against a FULL round");
  console.log('the report must say "red team not calibrated" next to any zero-finding claim');
  process.exit(3);
}


function cmdClasses() {
  for (const c of BUG_CLASSES) console.log(`  ${c.id.padEnd(22)} ${c.severity.padEnd(9)} ${c.name}`);
  console.log(`\n${BUG_CLASSES.length} classes in the catalogue`);
}

const commands = { plan: cmdPlan, template: cmdTemplate, score: cmdScore, status: cmdStatus, classes: cmdClasses, help: cmdClasses };
if (!commands[command]) fail(`unknown command "${command}". Known: ${Object.keys(commands).join(", ")}`);
commands[command]();
