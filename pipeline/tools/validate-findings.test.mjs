import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const TOOL = new URL("./validate-findings.mjs", import.meta.url).pathname;

const finding = (over = {}) => ({
  id: "F-01",
  title: "IDOR on /api/items/:id",
  severity: "high",
  status: "confirmed",
  evidenceTier: "T1",
  location: "src/app/api/items/[id]/route.ts:12",
  ...over,
});

function validate(doc, { withTest } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vf-"));
  if (withTest) {
    const testFile = path.join(dir, "idor.test.ts");
    fs.writeFileSync(testFile, withTest);
    doc.findings = doc.findings.map((f) => ({ ...f, test: testFile }));
  }
  const file = path.join(dir, "findings.json");
  fs.writeFileSync(file, JSON.stringify(doc));
  const res = spawnSync("node", [TOOL, file, "--json"], { encoding: "utf8" });
  return { status: res.status, out: JSON.parse(res.stdout) };
}

const GOOD_TEST = `// @finding F-01\n// @req SEC-004\nit("B cannot read A", async () => { expect(res.status).toBe(404); });\n`;

test("a T1 finding with a tagged, asserting test passes", () => {
  const { status, out } = validate({ mode: "FULL", findings: [finding()] }, { withTest: GOOD_TEST });
  assert.equal(status, 0, out.problems.join("\n"));
  assert.equal(out.byTier.T1, 1);
});

test("T1 without a test path fails", () => {
  const { status, out } = validate({ mode: "FULL", findings: [finding({ test: undefined })] });
  assert.equal(status, 1);
  assert.match(out.problems.join("\n"), /T1 requires a reproduction test/);
});

test("T1 whose test does not reference the finding id fails", () => {
  const { status, out } = validate({ mode: "FULL", findings: [finding()] }, { withTest: `it("x", () => { expect(1).toBe(2) })` });
  assert.equal(status, 1);
  assert.match(out.problems.join("\n"), /not tagged with "@finding F-01"/);
});

test("T1 whose test has no assertion fails", () => {
  const { status, out } = validate({ mode: "FULL", findings: [finding()] }, { withTest: `// @finding F-01\nit("x", () => {})` });
  assert.equal(status, 1);
  assert.match(out.problems.join("\n"), /no assertion/);
});

test("T2 requires 20+ iterations and a recorded rate", () => {
  const bad = validate({ mode: "FULL", findings: [finding({ evidenceTier: "T2", iterations: 5, failureRate: 0.4 })] });
  assert.equal(bad.status, 1);
  assert.match(bad.out.problems.join("\n"), /iterations >= 20/);

  const good = validate({ mode: "FULL", findings: [finding({ evidenceTier: "T2", iterations: 25, failureRate: 0.4 })] });
  assert.equal(good.status, 0, good.out.problems.join("\n"));
});

test("T3 needs two verifiers and at least three controls checked", () => {
  const bad = validate({ mode: "FULL", findings: [finding({ evidenceTier: "T3", severity: "medium" })] });
  assert.equal(bad.status, 1);
  assert.match(bad.out.problems.join("\n"), />= 3 controls/);

  const good = validate({
    mode: "FULL",
    findings: [finding({ evidenceTier: "T3", severity: "medium", controlsChecked: ["middleware", "schema validation", "db constraint"], verifiers: ["model-a", "model-b"] })],
  });
  assert.equal(good.status, 0, good.out.problems.join("\n"));
});

test("T3 caps severity at medium unless reproduced", () => {
  const { status, out } = validate({
    mode: "FULL",
    findings: [finding({ evidenceTier: "T3", severity: "high", controlsChecked: ["a", "b", "c"], verifiers: ["x", "y"] })],
  });
  assert.equal(status, 1);
  assert.match(out.problems.join("\n"), /T3 caps severity/);
});

test("rejected needs a written disproof", () => {
  const { status, out } = validate({ mode: "FULL", findings: [finding({ status: "rejected", evidenceTier: undefined })] });
  assert.equal(status, 1);
  assert.match(out.problems.join("\n"), /rejected without a written disproof/);
});

test("needs_validation must name one missing fact and the command to settle it", () => {
  const { status, out } = validate({ mode: "FULL", findings: [finding({ status: "needs_validation", evidenceTier: undefined })] });
  assert.equal(status, 1);
  assert.match(out.problems.join("\n"), /must name the single missing fact/);
});

test("a DIFF run can never be reported as clean", () => {
  const { status, out } = validate({ mode: "DIFF", findings: [] });
  assert.equal(status, 1);
  assert.match(out.problems.join("\n"), /DIFF run cannot be used to claim the codebase is clean/);
});

test("unknown/duplicate ids and bad severity are caught", () => {
  const { status, out } = validate({
    mode: "FULL",
    findings: [finding({ evidenceTier: "T3", test: undefined, controlsChecked: ["a", "b", "c"], verifiers: ["x", "y"], severity: "medium" }), finding({ title: "another one", evidenceTier: "T3", controlsChecked: ["a", "b", "c"], verifiers: ["x", "y"] })],
  });
  assert.equal(status, 1);
  assert.match(out.problems.join("\n"), /duplicate id/);
});
