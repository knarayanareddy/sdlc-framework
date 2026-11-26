import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const TOOL = fileURLToPath(new URL("./validate-progress.mjs", import.meta.url));

function check(progress) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vp-"));
  const file = path.join(dir, "progress.json");
  fs.writeFileSync(file, JSON.stringify(progress));
  const res = spawnSync("node", [TOOL, file, "--json"], { encoding: "utf8" });
  return { status: res.status, out: JSON.parse(res.stdout) };
}

const base = {
  schemaVersion: 2,
  phase: "06",
  gates: {
    G0: { status: "passed", command: "true", exitCode: 0 },
    G7: { status: "NOT_VERIFIED", reason: "no browser in this environment", humanCommand: "npx playwright test" },
  },
  phases: { "00": { status: "done" }, "06": { status: "started" } },
  blockers: [{ id: "B-01", text: "flaky e2e", fallback: "quarantine the test and ship with a note" }],
  rounds: { full: 1, diff: 0 },
};

test("a well-formed progress file passes", () => {
  const { status, out } = check(base);
  assert.equal(status, 0, out.problems.join("\n"));
});

test("schemaVersion must be 2", () => {
  const { status, out } = check({ ...base, schemaVersion: 1 });
  assert.equal(status, 1);
  assert.match(out.problems.join("\n"), /schemaVersion must be 2/);
});

test("a passed gate without an exit code is rejected", () => {
  const { status, out } = check({ ...base, gates: { G0: { status: "passed", command: "true" } } });
  assert.equal(status, 1);
  assert.match(out.problems.join("\n"), /passed without an exitCode/);
});

test("a passed gate with a non-zero exit code is rejected", () => {
  const { status, out } = check({ ...base, gates: { G0: { status: "passed", command: "false", exitCode: 1 } } });
  assert.equal(status, 1);
  assert.match(out.problems.join("\n"), /exitCode is 1/);
});

test("NOT_VERIFIED without a reason or a human command is rejected", () => {
  const noReason = check({ ...base, gates: { G7: { status: "NOT_VERIFIED", humanCommand: "x" } } });
  assert.equal(noReason.status, 1);
  assert.match(noReason.out.problems.join("\n"), /NOT_VERIFIED without a reason/);

  const noCommand = check({ ...base, gates: { G7: { status: "NOT_VERIFIED", reason: "no browser available here" } } });
  assert.equal(noCommand.status, 1);
  assert.match(noCommand.out.problems.join("\n"), /without humanCommand/);
});

test("unknown gate and phase ids are rejected", () => {
  const { status, out } = check({ ...base, gates: { G6: { status: "passed", command: "true", exitCode: 0 } } });
  assert.equal(status, 1);
  assert.match(out.problems.join("\n"), /G6: not a known gate id/);

  const phase = check({ ...base, phases: { "13": { status: "done" } } });
  assert.equal(phase.status, 1);
  assert.match(phase.out.problems.join("\n"), /not a known phase id/);
});

test("a blocker without a fallback is rejected", () => {
  const { status, out } = check({ ...base, blockers: [{ id: "B-01", text: "stuck" }] });
  assert.equal(status, 1);
  assert.match(out.problems.join("\n"), /no fallback recorded/);
});

test("more than three FULL rounds is rejected", () => {
  const { status, out } = check({ ...base, rounds: { full: 4, diff: 1 } });
  assert.equal(status, 1);
  assert.match(out.problems.join("\n"), /exceeds 3/);
});
