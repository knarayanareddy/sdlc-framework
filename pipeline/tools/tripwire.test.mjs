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

test("a missing tool is NOT_VERIFIED, not a pass", () => {
  const { status, stdout } = run([PASS, MISSING]);
  assert.equal(status, 0, "non-strict: NOT_VERIFIED does not fail the slice");
  assert.match(stdout, /NOT_VERIFIED/);
  assert.match(stdout, /A human must run:/);
  assert.match(stdout, /definitely-not-a-real-tool-xyz/);
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
