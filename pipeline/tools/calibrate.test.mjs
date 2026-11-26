// Calibration is a measurement, so the tests are about the arithmetic and the refusals:
// a recall number that can be reached by accident is worse than no number.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { BUG_CLASSES, normaliseClass, selectClasses } from "./lib/bug-classes.mjs";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const cal = path.join(here, "calibrate.mjs");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "cal-"));
const cli = (args, cwd) => spawnSync("node", [cal, ...args], { encoding: "utf8", cwd: cwd ?? process.cwd(), timeout: 60_000 });

function makePlan(d, { n = 6, seed = 42, classes } = {}) {
  const args = ["plan", "--n", String(n), "--seed", String(seed), "--out", path.join(d, "plan.json")];
  if (classes) args.push("--classes", classes);
  const r = cli(args, d);
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(fs.readFileSync(path.join(d, "plan.json"), "utf8"));
}

function makeAnswer(d, plan, { file = "src/app/api/items/route.ts", miss = [] } = {}) {
  const bugs = plan.classes.map((c, i) => ({ id: `P${i + 1}`, class: c.id, file, line: 10 + i * 5, description: c.plant }));
  fs.writeFileSync(path.join(d, "answer.json"), JSON.stringify({ pipelineVersion: plan.pipelineVersion, plantedBy: "planter", branch: "calibration/test", bugs: bugs.filter((b) => !miss.includes(b.class)) }, null, 2));
  return bugs;
}

function makeFindings(d, bugs, { mode = "FULL", hit = () => true, extra = [] } = {}) {
  const findings = bugs
    .filter(hit)
    .map((b, i) => ({ id: `F-${i + 1}`, title: b.class, class: b.class, severity: "high", status: "confirmed", evidenceTier: "T1", location: `${b.file}:${b.line}` }));
  fs.writeFileSync(path.join(d, "findings.json"), JSON.stringify({ run: "cal", mode, findings: [...findings, ...extra] }, null, 2));
}

function score(d, extra = []) {
  return cli(["score", "--plan", path.join(d, "plan.json"), "--answer", path.join(d, "answer.json"), "--findings", path.join(d, "findings.json"), "--out", path.join(d, "report.md"), ...extra], d);
}

test("class vocabulary maps onto the catalogue", () => {
  assert.equal(normaliseClass("BOLA"), "idor");
  assert.equal(normaliseClass("object-level authorization"), "idor");
  assert.equal(normaliseClass("over-posting"), "mass-assignment");
  assert.equal(normaliseClass("Sqli"), "sql-injection");
  assert.equal(normaliseClass("something nobody has heard of"), null);
});

test("a plan is reproducible from its seed and refuses more than the catalogue", () => {
  const a = selectClasses({ n: 8, seed: 7 });
  const b = selectClasses({ n: 8, seed: 7 });
  const c = selectClasses({ n: 8, seed: 8 });
  assert.deepEqual(a.classes.map((x) => x.id), b.classes.map((x) => x.id));
  assert.notDeepEqual(a.classes.map((x) => x.id), c.classes.map((x) => x.id));
  assert.match(selectClasses({ n: 99 }).error, /only \d+ are eligible/);
});

test("plan → template → answer are consistent, and the CLI writes all three", () => {
  const d = tmp();
  const plan = makePlan(d);
  const t = cli(["template", "--plan", path.join(d, "plan.json"), "--out", path.join(d, "answer.json")], d);
  assert.equal(t.status, 0, t.stderr);
  const answer = JSON.parse(fs.readFileSync(path.join(d, "answer.json"), "utf8"));
  assert.deepEqual(answer.bugs.map((b) => b.class), plan.classes.map((c) => c.id));
  assert.match(t.stdout, /git-ignored/);
});

test("a full detection run is CALIBRATED", () => {
  const d = tmp();
  const plan = makePlan(d);
  const bugs = makeAnswer(d, plan);
  makeFindings(d, bugs);
  const r = score(d);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /RESULT: CALIBRATED/);
  const report = fs.readFileSync(path.join(d, "report.md"), "utf8");
  assert.match(report, /Recall \| 100\.0%/);
  assert.match(report, /upper bound/);
  assert.match(report, /Sample size is small/);
  const json = JSON.parse(fs.readFileSync(path.join(d, "calibration.json"), "utf8"));
  assert.equal(json.calibrated, true);
  assert.equal(json.planted, 6);
});

test("70% recall with one class at zero is still INCONCLUSIVE", () => {
  const d = tmp();
  const plan = makePlan(d);
  const bugs = makeAnswer(d, plan);
  makeFindings(d, bugs, { hit: (b) => b.class !== plan.classes[0].id });
  const r = score(d);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /MISS/);
  assert.match(r.stdout, /no detection at all for/);
  assert.match(r.stdout, /INCONCLUSIVE/);
});

test("recall below the floor is INCONCLUSIVE even if every class has a hit", () => {
  const d = tmp();
  const plan = makePlan(d, { n: 10 });
  const bugs = makeAnswer(d, plan);
  // One hit per class is impossible here: only 6 of 10 are found, but two classes are missed
  // twice each so the floor is tested independently of the per-class rule.
  makeFindings(d, bugs, { hit: (b) => bugs.indexOf(b) < 6 });
  const r = score(d);
  assert.equal(r.status, 1);
  const json = JSON.parse(fs.readFileSync(path.join(d, "calibration.json"), "utf8"));
  assert.ok(json.recall < 0.7, `recall ${json.recall}`);
});

test("an answer that does not match the plan is refused in both directions", () => {
  const d = tmp();
  const plan = makePlan(d);

  const bugs = makeAnswer(d, plan);
  // A class the plan did not ask for, chosen from the catalogue rather than hard-coded.
  const foreign = BUG_CLASSES.find((c) => !plan.classes.some((p) => p.id === c.id)).id;
  bugs.push({ id: "P99", class: foreign, file: "src/x.ts", line: 1 });
  fs.writeFileSync(path.join(d, "answer.json"), JSON.stringify({ pipelineVersion: plan.pipelineVersion, bugs }, null, 2));
  makeFindings(d, bugs);
  const extra = score(d);
  assert.equal(extra.status, 1);
  assert.match(extra.stderr, /did not ask for/);

  const missing = makeAnswer(d, plan, { miss: [plan.classes[1].id] });
  makeFindings(d, missing);
  const short = score(d);
  assert.equal(short.status, 1);
  assert.match(short.stderr, /does not include/);
});

test("a DIFF round cannot be used as calibration evidence", () => {
  const d = tmp();
  const plan = makePlan(d);
  const bugs = makeAnswer(d, plan);
  makeFindings(d, bugs, { mode: "DIFF" });
  const r = score(d);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /differential run cannot measure recall/);
});

test("a tracked answer file is refused unless explicitly allowed", () => {
  const d = tmp();
  makePlan(d);
  const plan = JSON.parse(fs.readFileSync(path.join(d, "plan.json"), "utf8"));
  const bugs = makeAnswer(d, plan);
  makeFindings(d, bugs);

  const g = spawnSync("git init -q", { cwd: d, shell: true });
  assert.equal(g.status, 0);
  const tracked = score(d);
  assert.equal(tracked.status, 1);
  assert.match(tracked.stderr, /not a blind test/);

  fs.writeFileSync(path.join(d, ".gitignore"), "answer.json\n");
  const ignored = score(d);
  assert.equal(ignored.status, 0, ignored.stdout + ignored.stderr);

  fs.rmSync(path.join(d, ".gitignore"));
  const allowed = score(d, ["--allow-tracked"]);
  assert.equal(allowed.status, 0, allowed.stdout + allowed.stderr);
});

test("confirmed findings that were not planted are listed, not ignored", () => {
  const d = tmp();
  const plan = makePlan(d);
  const bugs = makeAnswer(d, plan);
  makeFindings(d, bugs, { extra: [{ id: "F-42", title: "unrelated real bug", severity: "low", status: "confirmed", evidenceTier: "T3", location: "src/other.ts:3" }] });
  const r = score(d);
  assert.equal(r.status, 0, r.stderr);
  const report = fs.readFileSync(path.join(d, "report.md"), "utf8");
  assert.match(report, /Confirmed findings that were not planted \(1\)/);
  assert.match(report, /F-42/);
});

test("status reports absent, calibrated and stale honestly", () => {
  const d = tmp();
  const absent = cli(["status", "--dir", path.join(d, "calibration")], d);
  assert.equal(absent.status, 3);
  assert.match(absent.stdout, /has not been run for pipeline/);
  assert.match(absent.stdout, /human command/);

  const plan = makePlan(d);
  const bugs = makeAnswer(d, plan);
  makeFindings(d, bugs);
  score(d);
  const good = cli(["status", "--dir", d], d);
  assert.equal(good.status, 0, good.stdout);
  assert.match(good.stdout, /calibrated/);

  const jsonPath = path.join(d, "calibration.json");
  const json = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  json.pipelineVersion = "0.0.1-ancient";
  fs.writeFileSync(jsonPath, JSON.stringify(json));
  const stale = cli(["status", "--dir", d], d);
  assert.equal(stale.status, 3);
  assert.match(stale.stdout, /stale/);
});
