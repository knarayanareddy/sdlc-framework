// The traceability gate, tested where the bypass lived: `trace:check` used to pass a spec in
// which 2 of 5 requirements had no test at all, because the pipeline ran it with
// `--allow-uncovered` (REVIEW-OF-SECOND-OPINION.md §7 P3 / §14).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PIPELINE = path.resolve(HERE, "..");
const TRACE = path.join(HERE, "trace-check-v2.mjs");
const CLI = path.join(PIPELINE, "bin", "pipeline.mjs");

const SPEC_REQ = (id, extra = []) =>
  [
    `### ${id} A requirement`,
    "- Priority: P0",
    "- Rationale: E-01",
    `- Statement: When a member submits, the system shall store ${id}.`,
    "- Acceptance:",
    "  - Given a member, When they submit, Then it is stored.",
    "- Test level: unit",
    ...extra,
    "- Done-when: the test passes.",
    "",
  ].join("\n");

function project({ spec = [SPEC_REQ("REQ-001"), SPEC_REQ("REQ-002")].join("\n# SECTION\n"), tests = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tc-"));
  fs.mkdirSync(path.join(dir, "docs", "02-spec"), { recursive: true });
  fs.mkdirSync(path.join(dir, "tests"), { recursive: true });
  fs.writeFileSync(path.join(dir, "docs", "02-spec", "SPEC.md"), `# SPEC\n\n## 8. Requirements\n\n${spec}`);
  for (const [rel, body] of Object.entries(tests)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  return dir;
}

// One asserting case per tagged requirement: coverage is per case since 2.9.1 (B-30), so a
// single case tagged with two ids is a bypass, not a fixture.
const GOOD_TEST = (ids) =>
  `// @req ${ids.join(" ")}\nimport { test } from "node:test";\nimport assert from "node:assert/strict";\n${ids
    .map((id) => `test("${id}: x", () => { assert.equal(1, 1); });`)
    .join("\n")}\n`;
const run = (dir, args) => spawnSync("node", [TRACE, ...args], { encoding: "utf8", cwd: dir });

test("a structure run is labelled as one and is not a coverage claim", () => {
  const dir = project({ tests: {} });
  const r = run(dir, ["docs/02-spec/SPEC.md", "tests", "--allow-uncovered"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /structure only; not a coverage claim/);
});

test("the coverage run fails on an untested requirement", () => {
  const dir = project({ tests: { "tests/a.test.mjs": GOOD_TEST(["REQ-001"]) } });
  const r = run(dir, ["docs/02-spec/SPEC.md", "tests"]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /uncovered: REQ-002/);
});

test("a spec that names a Test file which does not exist is a failure", () => {
  const dir = project({
    spec: [SPEC_REQ("REQ-001", ["- Test file: tests/gone.test.mjs"])].join("\n"),
    // The tag exists, but in a different file than the spec claims.
    tests: { "tests/a.test.mjs": GOOD_TEST(["REQ-001"]) },
  });
  const r = run(dir, ["docs/02-spec/SPEC.md", "tests"]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /REQ-001: Test file tests\/gone\.test\.mjs does not exist/);
});

test("a declared Test file that does not carry the tag is a failure", () => {
  // Both requirements are covered, so only the declared-file rule can fail here: REQ-001
  // says its test is b.test.mjs, and b.test.mjs tests REQ-002.
  const dir = project({
    spec: [SPEC_REQ("REQ-001", ["- Test file: tests/b.test.mjs"]), SPEC_REQ("REQ-002")].join("\n# SECTION\n"),
    tests: { "tests/a.test.mjs": GOOD_TEST(["REQ-001"]), "tests/b.test.mjs": GOOD_TEST(["REQ-002"]) },
  });
  const r = run(dir, ["docs/02-spec/SPEC.md", "tests"]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /REQ-001: declared Test file tests\/b\.test\.mjs does not carry the @req REQ-001 tag/);
});

test("the command `pipeline gate` actually runs for trace:check carries no exemption", () => {
  const dir = project({ tests: { "tests/a.test.mjs": GOOD_TEST(["REQ-001", "REQ-002"]) } });
  const git = (...args) => spawnSync("git", ["-c", "user.email=t@e.com", "-c", "user.name=t", ...args], { cwd: dir, encoding: "utf8" });
  git("init", "-q");
  git("add", "-A");
  git("commit", "-qm", "base");
  const init = spawnSync("node", [CLI, "init", "--cwd", dir], { encoding: "utf8", cwd: dir });
  assert.equal(init.status, 0, init.stdout + init.stderr);

  // Freeze the baseline the way phase 05 does, then check the gate's own command line.
  const base = path.join(dir, "docs", "05-test", "baseline.json");
  const froze = run(dir, ["docs/02-spec/SPEC.md", "tests", "--baseline", base]);
  assert.equal(froze.status, 0, froze.stdout + froze.stderr);

  const gate = spawnSync("node", [CLI, "gate", "G7", "--builtin", "trace:check", "--cwd", dir], { encoding: "utf8", cwd: dir });
  const entry = fs
    .readFileSync(path.join(dir, "docs", "gate-ledger.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l))
    .filter((e) => e.gate === "G7")
    .pop();
  assert.ok(entry, "no G7 ledger entry");
  assert.doesNotMatch(entry.command, /--allow-uncovered/, `the gate still exempts itself: ${entry.command}`);
  assert.equal(entry.status, "passed", gate.stdout + gate.stderr);
});

test("the default tripwire trace check carries no exemption either", () => {
  const source = fs.readFileSync(path.join(HERE, "tripwire.mjs"), "utf8");
  const line = source.split("\n").find((l) => /name: "trace"/.test(l));
  assert.ok(line, "no default trace check found");
  assert.doesNotMatch(line, /--allow-uncovered/);
});

// ---- P4 · a scoped trace run is tag hygiene, not a coverage claim ----------------------
test("a scoped run says it is scoped and does not pretend to cover the suite", () => {
  const dir = project({ tests: { "tests/a.test.mjs": GOOD_TEST(["REQ-001"]) } });
  const r = run(dir, ["docs/02-spec/SPEC.md", "tests", "--scope", "tests"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /SCOPED \(under tests\)/);
  assert.match(r.stdout, /RESULT: PASS \(scoped to under tests; tag hygiene only, not a coverage claim\)/);
  // The uncovered list is still printed (it is information), but the verdict is not a pass
  // on coverage: a bare "RESULT: PASS" would let a scoped run stand in for trace:check.
  assert.doesNotMatch(r.stdout, /^RESULT: PASS$/m);
});

test("a scope that reads no test files is NOT_VERIFIED", () => {
  const dir = project({ tests: { "tests/a.test.mjs": GOOD_TEST(["REQ-001"]) } });
  const r = run(dir, ["docs/02-spec/SPEC.md", "tests", "--scope", "src/nope"]);
  assert.equal(r.status, 3);
  assert.match(r.stdout, /the scope \(under src\/nope\) contains no test files/);
});

test("--changed-since selects the changed test files", () => {
  const dir = project({ tests: { "tests/a.test.mjs": GOOD_TEST(["REQ-001"]), "tests/b.test.mjs": GOOD_TEST(["REQ-002"]) } });
  const git = (...args) => spawnSync("git", ["-c", "user.email=t@e.com", "-c", "user.name=t", ...args], { cwd: dir, encoding: "utf8" });
  git("init", "-q");
  git("add", "-A");
  git("commit", "-qm", "base");
  fs.writeFileSync(path.join(dir, "tests/b.test.mjs"), GOOD_TEST(["REQ-001", "REQ-002"]));
  const r = run(dir, ["docs/02-spec/SPEC.md", "tests", "--changed-since", "HEAD"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /test files: 1/);
  assert.match(r.stdout, /SCOPED \(changed since HEAD \(1 file\)\)/);
});
