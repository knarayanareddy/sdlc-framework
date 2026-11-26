import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const TOOL = fileURLToPath(new URL("./protected-paths.mjs", import.meta.url));

function git(cwd, ...args) {
  return spawnSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=test", ...args], { cwd, encoding: "utf8" });
}

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pp-"));
  const write = (rel, body) => {
    const target = path.join(dir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body);
  };
  write("tests/a.test.ts", 'it("a", () => { expect(1).toBe(1) })\n');
  write("pipeline/tools/x.mjs", "// tool\n");
  write("docs/progress.json", "{}\n");
  write("src/app.js", "export const a = 1\n");
  git(dir, "init", "-q");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "init");
  return { dir, write };
}

const check = (dir, ...extra) => spawnSync("node", [TOOL, ...extra], { cwd: dir, encoding: "utf8" });

test("an unchanged tree passes", () => {
  const { dir } = repo();
  const res = check(dir);
  assert.equal(res.status, 0, res.stdout + res.stderr);
});

test("editing an existing test is a violation", () => {
  const { dir, write } = repo();
  write("tests/a.test.ts", 'it("a", () => {})\n');
  const res = check(dir);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /tests\/a\.test\.ts — modified-or-deleted/);
});

test("adding a new test file is allowed", () => {
  const { dir, write } = repo();
  write("tests/new.test.ts", 'it("new", () => { expect(1).toBe(1) })\n');
  const res = check(dir);
  assert.equal(res.status, 0, res.stdout);
});

test("deleting a test is a violation", () => {
  const { dir } = repo();
  fs.rmSync(path.join(dir, "tests/a.test.ts"));
  const res = check(dir);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /modified-or-deleted/);
});

test("the orchestrator-owned state file warns by default and fails under --strict", () => {
  const { dir, write } = repo();
  write("docs/progress.json", '{"gates":{"G7":{"status":"passed"}}}\n');
  const loose = check(dir);
  assert.equal(loose.status, 0);
  assert.match(loose.stdout, /warn docs\/progress\.json/);
  const strict = check(dir, "--strict");
  assert.equal(strict.status, 1);
  assert.match(strict.stdout, /PROBLEM docs\/progress\.json/);
});

test("editing the gate tool in place is a violation", () => {
  const { dir, write } = repo();
  write("pipeline/tools/x.mjs", "// weakened\n");
  const res = check(dir);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /pipeline\/tools\/x\.mjs/);
});

test("ordinary source changes are allowed", () => {
  const { dir, write } = repo();
  write("src/app.js", "export const a = 2\n");
  const res = check(dir);
  assert.equal(res.status, 0, res.stdout);
});

test("without git the check is NOT_VERIFIED (exit 3), never a pass", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pp-nogit-"));
  const res = spawnSync("node", [TOOL], { cwd: dir, encoding: "utf8" });
  assert.equal(res.status, 3);
  assert.match(res.stdout, /NOT_VERIFIED/);
});
