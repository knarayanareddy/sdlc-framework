import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const TOOL = fileURLToPath(new URL("./estimate.mjs", import.meta.url));

const run = (...args) => {
  const res = spawnSync("node", [TOOL, ...args], { encoding: "utf8" });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
};

const json = (...args) => {
  const res = run(...args, "--json");
  return { status: res.status, data: JSON.parse(res.stdout) };
};

test("matches the hand-computed Chapman value for 6, 5, 4", () => {
  const { data } = json("--a", "6", "--b", "5", "--m", "4");
  assert.equal(data.ok, true);
  assert.equal(data.union, 7);
  assert.ok(Math.abs(data.total - 7.4) < 1e-9);
  assert.ok(Math.abs(data.remaining - 0.4) < 1e-9);
  assert.equal(data.stop, true);
});

test("keeps going when the runs barely overlap", () => {
  const { data } = json("--a", "4", "--b", "4", "--m", "1");
  assert.equal(data.stop, false);
  assert.ok(Math.abs(data.remaining - 4.5) < 1e-9);
});

test("no overlap gives no estimate", () => {
  const { data } = json("--a", "3", "--b", "2", "--m", "0");
  assert.equal(data.ok, false);
  assert.match(data.reason, /no overlap/i);
});

test("two empty runs are not evidence of a clean codebase", () => {
  const { data } = json("--a", "0", "--b", "0", "--m", "0");
  assert.equal(data.ok, false);
  assert.match(data.reason, /not evidence/i);
});

test("rejects impossible or malformed input", () => {
  assert.equal(run("--a", "2", "--b", "5", "--m", "3").status, 1);
  assert.equal(run("--a", "-1", "--b", "5", "--m", "0").status, 1);
  assert.equal(run("--a", "1.5", "--b", "5", "--m", "1").status, 1);
  assert.equal(run("--a", "x", "--b", "5", "--m", "1").status, 1);
});

test("remaining is never negative", () => {
  const { data } = json("--a", "5", "--b", "5", "--m", "5");
  assert.ok(data.remaining >= 0);
});

test("--fail-if-continue turns 'continue' into a non-zero exit", () => {
  assert.equal(run("--a", "4", "--b", "4", "--m", "1", "--fail-if-continue").status, 1);
  assert.equal(run("--a", "6", "--b", "5", "--m", "4", "--fail-if-continue").status, 0);
});
