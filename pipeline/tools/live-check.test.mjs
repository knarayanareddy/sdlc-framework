// P6 · the live-environment harness, tested without a live environment.
//
// The point of these tests is the fail-closed rule: a binary on PATH is not a runtime, a
// config key is not a working verifier, and a calibration file from another version is not a
// calibration. Each test supplies exactly the stub that would fool a sloppier probe and asserts
// the row stays out of `ready`.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validate, loadSchema } from "./lib/jsonschema.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CALIBRATE = path.join(HERE, "calibrate.mjs");
const TOOL = path.join(HERE, "live-check.mjs");
const VERSION = fs.readFileSync(path.resolve(HERE, "..", "VERSION"), "utf8").trim();
const schema = loadSchema("live-readiness.schema.json");

function stubDir(scripts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stub-"));
  for (const [name, body] of Object.entries(scripts)) {
    const file = path.join(dir, name);
    fs.writeFileSync(file, `#!/bin/sh\n${body}\n`);
    fs.chmodSync(file, 0o755);
  }
  return dir;
}

function project({ config = null, calibration = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "live-"));
  fs.mkdirSync(path.join(dir, "docs/02-spec"), { recursive: true });
  fs.writeFileSync(path.join(dir, "docs/02-spec/SPEC.md"), "# SPEC\n\n### REQ-001 a\n\n### SEC-001 b\n");
  fs.writeFileSync(path.join(dir, "README.md"), "# x\n");
  if (config) fs.writeFileSync(path.join(dir, "pipeline.config.json"), JSON.stringify(config));
  if (calibration) {
    fs.mkdirSync(path.join(dir, "calibration"), { recursive: true });
    fs.writeFileSync(path.join(dir, "calibration/calibration.json"), JSON.stringify(calibration));
  }
  return dir;
}

// The probes look for binaries on PATH, so the tests own the PATH completely. `/usr/bin:/bin`
// is NOT safe to keep: GitHub's ubuntu runner has a working docker there, and the "nothing is
// installed" test would quietly pass for the wrong reason. Only `git` is carried over, by
// symlink, because `calibrate.mjs` shells out to it.
function minimalPath(keep = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "minbin-"));
  for (const bin of keep) {
    const found = String(process.env.PATH ?? "")
      .split(path.delimiter)
      .filter(Boolean)
      .map((d) => path.join(d, bin))
      .find((p) => {
        try {
          fs.accessSync(p, fs.constants.X_OK);
          return true;
        } catch {
          return false;
        }
      });
    if (found) fs.symlinkSync(found, path.join(dir, bin));
  }
  return dir;
}

const MINIMAL = minimalPath(["git"]);
const HEADLESS = stubDir({}); // a PATH with no docker, nuclei or schemathesis

// A calibration file is only evidence when it was produced by scoring a plan against a blind
// answer, so the fixture runs the real tool rather than writing {"calibrated": true} by hand
// (SECOND-OPINION-3 G-14: that used to be enough to turn this item green).
function genuineCalibration(dir) {
  const cal = path.join(dir, "calibration");
  fs.mkdirSync(cal, { recursive: true });
  const planPath = path.join(cal, "planted.plan.json");
  const answerPath = path.join(cal, "planted.answer.json");
  const findingsPath = path.join(dir, "docs/08-redteam/run-1/findings.json");
  fs.mkdirSync(path.dirname(findingsPath), { recursive: true });

  const plan = spawnSync("node", [CALIBRATE, "plan", "--n", "10", "--seed", "1729", "--out", planPath], { cwd: dir, encoding: "utf8" });
  assert.equal(plan.status, 0, plan.stdout + plan.stderr);
  const planned = JSON.parse(fs.readFileSync(planPath, "utf8"));
  const bugs = planned.classes.map((c, i) => ({ id: `P${i + 1}`, class: c.id, file: "src/app/api/items/route.ts", line: 10 + i * 5, description: c.plant }));
  fs.writeFileSync(answerPath, JSON.stringify({ pipelineVersion: planned.pipelineVersion, plantedBy: "planter", bugs }, null, 2));
  fs.writeFileSync(
    findingsPath,
    JSON.stringify({
      run: "cal",
      mode: "FULL",
      findings: bugs.map((b, i) => ({ id: `F-${i + 1}`, title: b.class, class: b.class, severity: "high", status: "confirmed", evidenceTier: "T1", location: `${b.file}:${b.line}` })),
    }, null, 2),
  );
  const scored = spawnSync("node", [CALIBRATE, "score", "--plan", planPath, "--answer", answerPath, "--findings", findingsPath, "--out", path.join(cal, "calibration-report.md")], { cwd: dir, encoding: "utf8" });
  assert.equal(scored.status, 0, scored.stdout + scored.stderr);
  return JSON.parse(fs.readFileSync(path.join(cal, "calibration.json"), "utf8"));
}

function live(dir, args, { path: pathEnv = HEADLESS, env = {} } = {}) {
  // process.execPath, not "node": the PATH is replaced by stubs below.
  const res = spawnSync(process.execPath, [TOOL, ...args, "--cwd", dir], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${pathEnv}${path.delimiter}${MINIMAL}`, ...env },
    timeout: 120_000,
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

const readiness = (dir) => JSON.parse(fs.readFileSync(path.join(dir, "docs/13-live/live-readiness.json"), "utf8"));
const row = (report, id) => report.items.find((i) => i.id === id);

const READY_CONFIG = {
  independence: { builderFamily: "anthropic", requireFor: ["G9"] },
  verifier: { model: "gpt-5", cmd: "node pipeline/examples/verifier-transport.example.mjs" },
  calibrationDir: "calibration",
};

test("nothing installed: four blocked rows, exit 3, and the artifact is still written", () => {
  const dir = project();
  const r = live(dir, ["probe"]);
  assert.equal(r.status, 3);
  assert.match(r.stdout, /0\/4 in place/);
  assert.match(r.stdout, /RESULT: NOT_VERIFIED/);
  const report = readiness(dir);
  assert.equal(report.items.length, 4);
  assert.equal(report.pipelineVersion, VERSION);
  assert.deepEqual(validate(report, schema), [], "the artifact must satisfy its schema");
  for (const item of report.items) {
    assert.notEqual(item.state, "ready", `${item.id} cannot be ready on a bare host`);
    assert.ok(item.next.length >= 1, `${item.id} must say what to do next`);
    assert.match(item.flips, /G\d+/);
  }
});

test("docker on PATH but the daemon is dead is PARTIAL, not ready", () => {
  const dir = project();
  const stubs = stubDir({ docker: 'echo "Cannot connect to the Docker daemon" >&2\nexit 1' });
  const r = live(dir, ["probe"], { path: stubs });
  assert.equal(r.status, 3);
  const sandbox = row(readiness(dir), "sandbox");
  assert.equal(sandbox.state, "partial", sandbox.why);
  assert.match(sandbox.why, /daemon does not answer/);
});

test("a docker daemon that answers makes the sandbox ready — and it is asked, not assumed", () => {
  const dir = project();
  const stubs = stubDir({ docker: 'if [ "$1" = "info" ]; then echo "24.0.7"; exit 0; fi\nexit 1' });
  live(dir, ["probe"], { path: stubs });
  const sandbox = row(readiness(dir), "sandbox");
  assert.equal(sandbox.state, "ready", sandbox.why);
  assert.ok(sandbox.evidence.some((e) => e.what === "docker info" && e.value === "24.0.7"));
});

test("a verifier in the builder's own family never counts as independent", () => {
  const dir = project({ config: { ...READY_CONFIG, verifier: { model: "claude-opus-4", cmd: "node t.mjs" } } });
  const r = live(dir, ["probe"]);
  const verifier = row(readiness(dir), "verifier");
  // Configured, and still not a second opinion: PARTIAL, never ready.
  assert.equal(verifier.state, "partial");
  assert.match(verifier.why, /same family/);
  assert.notEqual(r.status, 0);
});

test("a configured verifier is PARTIAL until something is dispatched", () => {
  // probe reads three strings and runs nothing, so it may not say READY (SECOND-OPINION-3 G-19).
  // READY comes from `verify --run`, which exercises the transport.
  const dir = project({ config: READY_CONFIG });
  live(dir, ["probe"]);
  const verifier = row(readiness(dir), "verifier");
  assert.equal(verifier.state, "partial", verifier.why);
  assert.match(verifier.why, /openai verifies anthropic/);
  assert.match(verifier.why, /configured, not executed/);
});

test("one scanner is not two: nuclei alone is PARTIAL", () => {
  const dir = project();
  const stubs = stubDir({ nuclei: "exit 0" });
  live(dir, ["probe"], { path: stubs });
  const scanners = row(readiness(dir), "scanners");
  assert.equal(scanners.state, "partial");
  assert.match(scanners.why, /not installed: schemathesis/);

  const both = stubDir({ nuclei: "exit 0", schemathesis: "exit 0" });
  live(dir, ["probe"], { path: both });
  assert.equal(row(readiness(dir), "scanners").state, "ready");
});

test("a hand-written calibration file is not a calibration", () => {
  // {"calibrated": true} with no plan behind it used to read as ready (G-14).
  const dir = project({ calibration: { pipelineVersion: VERSION, calibrated: true, recall: 0.9, planted: 10 } });
  live(dir, ["probe"]);
  const calibration = row(readiness(dir), "calibration");
  assert.equal(calibration.state, "partial", calibration.why);
  assert.match(calibration.why, /does not cover/);
});

test("a calibration scored from a plan, a blind answer and the findings is ready", () => {
  const dir = project();
  genuineCalibration(dir);
  const r = live(dir, ["probe"]);
  const calibration = row(readiness(dir), "calibration");
  assert.equal(calibration.state, "ready", calibration.why + "\n" + r.stdout);
  assert.match(calibration.why, /calibrated for /);
});

test("all four in place: exit 0 and a PASS that names the gates they feed", () => {
  const dir = project({ config: READY_CONFIG });
  genuineCalibration(dir);
  const stubs = stubDir({ docker: 'if [ "$1" = "info" ]; then echo "24.0.7"; exit 0; fi\nexit 1', nuclei: "echo nuclei 3.1\nexit 0", schemathesis: "echo 4.0.0\nexit 0" });
  const r = live(dir, ["verify", "--run"], { path: stubs });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /RESULT: PASS/);
  const report = readiness(dir);
  assert.equal(report.exercised, true);
  assert.equal(report.items.filter((i) => i.state === "ready").length, 4);
  assert.deepEqual(validate(report, schema), []);
  const scanners = row(report, "scanners");
  assert.ok(scanners.evidence.some((e) => e.what === "nuclei -version" && /nuclei 3\.1/.test(e.value)), "verify --run must ask the binary, not the PATH");
});

test("prep does every safe step once, and never overwrites what you already edited", () => {
  const dir = project({ config: READY_CONFIG });
  const first = live(dir, ["prep"]);
  assert.equal(first.status, 0, first.stderr);
  for (const rel of [
    "docs/13-live/live-plan.md",
    "docs/13-live/config.snippet.json",
    "docs/13-live/dast-plan.json",
    "docs/13-live/verifier-envelope.json",
    "docs/13-live/sandbox.compose.yml",
    "calibration/planted.plan.json",
    "calibration/planted.answer.json",
  ]) {
    assert.ok(fs.existsSync(path.join(dir, rel)), `prep did not write ${rel}`);
  }
  const plan = fs.readFileSync(path.join(dir, "docs/13-live/live-plan.md"), "utf8");
  assert.match(plan, /# P6 · live environment/);
  assert.match(plan, /## The last mile, in order/);

  // A second run leaves the prepared artifacts alone.
  const marker = path.join(dir, "docs/13-live/config.snippet.json");
  fs.writeFileSync(marker, '{"edited":"by hand"}');
  const second = live(dir, ["prep"]);
  assert.equal(second.status, 0);
  assert.match(second.stdout, /exists, left alone/);
  assert.equal(fs.readFileSync(marker, "utf8"), '{"edited":"by hand"}');
});

test("prep does not claim the phase is done, and still exits 3 on probe", () => {
  const dir = project();
  const prep = live(dir, ["prep"]);
  assert.equal(prep.status, 0, "prep is a preparation step; it has nothing to certify");
  assert.match(prep.stdout, /RESULT: NOT_VERIFIED/);
  assert.equal(live(dir, ["probe"]).status, 3);
});

// B-24: `verify --run` used to dispatch the reference example whatever transport was configured,
// so a broken PIPELINE_VERIFIER_CMD still produced "transport --dry-run: request built".
test("verify --run exercises the transport the run will use, not the reference example", () => {
  const dir = project({ config: READY_CONFIG });
  fs.mkdirSync(path.join(dir, "docs/13-live"), { recursive: true });
  fs.writeFileSync(path.join(dir, "docs/13-live/verifier-envelope.json"), JSON.stringify({ model: "gpt-5", messages: [] }));

  // A transport that fails on --dry-run: the item may not say READY.
  const broken = stubDir({ "bad-transport": "exit 7" });
  const badTransport = path.join(broken, "bad-transport");
  fs.chmodSync(badTransport, 0o755);
  const bad = live(dir, ["verify", "--run"], {
    path: stubDir({ docker: 'if [ "$1" = "info" ]; then echo 24.0.7; exit 0; fi\nexit 1', nuclei: "echo nuclei 3.1\nexit 0", schemathesis: "echo 4.0.0\nexit 0" }),
    env: { PIPELINE_VERIFIER_CMD: `${badTransport} --envelope docs/13-live/verifier-envelope.json` },
  });
  const v1 = row(readiness(dir), "verifier");
  assert.equal(v1.state, "partial", `${v1.why}\n${bad.stdout}`);
  assert.ok(v1.evidence.some((e) => e.what === "transport --dry-run" && e.from.startsWith(badTransport)), JSON.stringify(v1.evidence));
  assert.ok(v1.evidence.some((e) => e.what === "transport --dry-run" && /exit 7/.test(e.value)), JSON.stringify(v1.evidence));

  // A transport that builds a request: the evidence names it, and the reference example is absent.
  const good = stubDir({ "good-transport": 'if [ "$1" = "--dry-run" ]; then echo \'{"request":true}\'; exit 0; fi\nexit 1' });
  const goodTransport = path.join(good, "good-transport");
  fs.chmodSync(goodTransport, 0o755);
  live(dir, ["verify", "--run"], {
    path: stubDir({ docker: 'if [ "$1" = "info" ]; then echo 24.0.7; exit 0; fi\nexit 1', nuclei: "echo nuclei 3.1\nexit 0", schemathesis: "echo 4.0.0\nexit 0" }),
    env: { PIPELINE_VERIFIER_CMD: `${goodTransport} --envelope docs/13-live/verifier-envelope.json` },
  });
  const v2 = row(readiness(dir), "verifier");
  const dry = v2.evidence.find((e) => e.what === "transport --dry-run");
  assert.ok(dry, JSON.stringify(v2.evidence));
  assert.ok(dry.from.startsWith(goodTransport), dry.from);
  assert.doesNotMatch(JSON.stringify(v2.evidence), /verifier-transport\.example\.mjs/);
  fs.rmSync(dir, { recursive: true, force: true });
});
