import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const TOOL = fileURLToPath(new URL("./tripwire.mjs", import.meta.url));

function run(checks, extra = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tw-"));
  const config = path.join(dir, "pipeline.config.json");
  fs.writeFileSync(config, JSON.stringify({ tripwire: checks }));
  const log = path.join(dir, "slice-01-tripwire.log");
  const res = spawnSync("node", [TOOL, "--config", config, "--log", log, ...extra], { encoding: "utf8", cwd: dir });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, log };
}

const PASS = { name: "ok", cmd: 'node -e "process.exit(0)"' };
const FAIL = { name: "bad", cmd: 'node -e "console.error(\'boom\'); process.exit(1)"' };
const MISSING = { name: "missing", cmd: "definitely-not-a-real-tool-xyz --check" };

test("all green checks pass", () => {
  const { status, stdout } = run([PASS]);
  assert.equal(status, 0);
  assert.match(stdout, /RESULT: PASS/);
});

test("a failing check fails the tripwire and prints its output", () => {
  const { status, stdout } = run([PASS, FAIL]);
  assert.equal(status, 1);
  assert.match(stdout, /FAIL/);
  assert.match(stdout, /boom/);
  assert.match(stdout, /RESULT: FAIL/);
});

test("a missing tool is NOT_VERIFIED, which is not a pass", () => {
  const { status, stdout } = run([PASS, MISSING]);
  // Exit 3 is the pipeline's NOT_VERIFIED protocol. Exiting 0 here is what let a tripwire
  // that evaluated nothing read as green (F-13).
  assert.equal(status, 3, "NOT_VERIFIED must exit 3, not 0");
  assert.match(stdout, /RESULT: NOT_VERIFIED/);
  assert.match(stdout, /A human must run:/);
  assert.match(stdout, /definitely-not-a-real-tool-xyz/);
  assert.match(stdout, /human command:/);
});

const NOT_FOUND = { name: "trace", cmd: 'node -e "console.error(\'spec not found: docs/02-spec/SPEC.md\'); process.exit(2)"' };

test("a mandatory check is never downgraded to NOT_VERIFIED", () => {
  // This is the F-13 shape: stderr says "spec not found", exit 2, and the old heuristic
  // matched /not found/ and recorded a hard failure as "tool unavailable".
  const { status, stdout } = run([NOT_FOUND]);
  assert.equal(status, 1, "a mandatory check that cannot run is a failure");
  assert.match(stdout, /RESULT: FAIL/);
});

test("only a check declared optional may be downgraded", () => {
  const { status, stdout } = run([{ ...NOT_FOUND, name: "sast", optional: true }]);
  assert.equal(status, 3);
  assert.match(stdout, /NOT_VERIFIED/);
});

test("--strict turns NOT_VERIFIED into a failure for release gates", () => {
  const { status, stdout } = run([PASS, MISSING], ["--strict"]);
  assert.equal(status, 1);
  assert.match(stdout, /RESULT: FAIL/);
});

test("--only filters the checks", () => {
  const { status, stdout } = run([PASS, FAIL], ["--only", "ok"]);
  assert.equal(status, 0);
  assert.doesNotMatch(stdout, /boom/);
});

test("writes a log with one row per check", () => {
  const { log } = run([PASS, FAIL, MISSING]);
  const text = fs.readFileSync(log, "utf8");
  assert.match(text, /PASS\s+ok/);
  assert.match(text, /FAIL\s+bad/);
  assert.match(text, /NOT_VERIFIED\s+missing/);
});

// ---------------------------------------------------------------------------
// P7 · 2.8.1 — a tripwire with no checks cannot fail (G-21)
// ---------------------------------------------------------------------------
test("no checks configured is NOT_VERIFIED, not a pass", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tw-"));
  fs.writeFileSync(path.join(dir, "pipeline.config.json"), JSON.stringify({ tripwire: [] }));
  const res = spawnSync("node", [TOOL], { cwd: dir, encoding: "utf8" });
  assert.equal(res.status, 3, res.stdout + res.stderr);
  assert.match(res.stdout, /no tripwire checks are configured/);
  fs.rmSync(dir, { recursive: true, force: true });
});
