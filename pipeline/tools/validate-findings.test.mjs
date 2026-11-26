import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const TOOL = fileURLToPath(new URL("./validate-findings.mjs", import.meta.url));

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
    findings: [finding({ evidenceTier: "T3", severity: "medium", controlsChecked: ["middleware", "schema validation", "db constraint"], verifiers: ["gpt-5", "claude-opus"] })],
  });
  assert.equal(good.status, 0, good.out.problems.join("\n"));
});

test("T3 caps severity at medium unless reproduced", () => {
  const { status, out } = validate({
    mode: "FULL",
    findings: [finding({ evidenceTier: "T3", severity: "high", controlsChecked: ["a", "b", "c"], verifiers: ["gpt-5", "gemini-2.5-pro"] })],
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

test("a DIFF run is supplementary: fine as evidence, fatal if it claims clean", () => {
  // It used to fail on sight, which pushed people to label a scan of the changed files as
  // FULL. The rule that matters is the claim, not the mode.
  const ok = validate({ mode: "DIFF", findings: [] });
  assert.equal(ok.status, 0, ok.out.problems.join("\n"));
  assert.equal(ok.out.supplementary, true);

  const liar = validate({ mode: "DIFF", findings: [], result: "clean" });
  assert.equal(liar.status, 1);
  assert.match(liar.out.problems.join("\n"), /cannot claim the codebase is clean/);
});

test("unknown/duplicate ids and bad severity are caught", () => {
  const { status, out } = validate({
    mode: "FULL",
    findings: [finding({ evidenceTier: "T3", test: undefined, controlsChecked: ["a", "b", "c"], verifiers: ["x", "y"], severity: "medium" }), finding({ title: "another one", evidenceTier: "T3", controlsChecked: ["a", "b", "c"], verifiers: ["x", "y"] })],
  });
  assert.equal(status, 1);
  assert.match(out.problems.join("\n"), /duplicate id/);
});

// ---- P3 · the evidence tiers must not be satisfiable by prose --------------------------
test("a commented-out assertion is not an assertion (T1)", () => {
  // This passed before: the T1 rule searched the whole file for /expect\(/.
  const { status, out } = validate(
    { mode: "FULL", findings: [finding()] },
    { withTest: `// @finding F-01\nit("x", () => {});\n// expect(res.status).toBe(404);\n/* assert.equal(a, b) */\n` },
  );
  assert.equal(status, 1);
  assert.match(out.problems.join("\n"), /no assertion after the @finding F-01 tag/);
});

test("an assertion before the tag does not count for this finding (T1)", () => {
  const { status, out } = validate(
    { mode: "FULL", findings: [finding()] },
    { withTest: `import { expect } from "vitest";\nexpect(1).toBe(1);\n// @finding F-01\nit("x", () => {});\n` },
  );
  assert.equal(status, 1);
  assert.match(out.problems.join("\n"), /no assertion after the @finding F-01 tag/);
});

test("a T2 rate of 0 or above 1 is not a confirmed finding", () => {
  const zero = validate({ mode: "FULL", findings: [finding({ evidenceTier: "T2", iterations: 50, failureRate: 0 })] });
  assert.equal(zero.status, 1);
  assert.match(zero.out.problems.join("\n"), /failureRate must be a number in \(0, 1\]/);

  const absurd = validate({ mode: "FULL", findings: [finding({ evidenceTier: "T2", iterations: 50, failureRate: 3 })] });
  assert.equal(absurd.status, 1);
  assert.match(absurd.out.problems.join("\n"), /failureRate must be a number in \(0, 1\]/);

  const text = validate({ mode: "FULL", findings: [finding({ evidenceTier: "T2", iterations: 50, failureRate: "high" })] });
  assert.equal(text.status, 1);
});

test("two spellings of one model are not two independent verifiers (T3)", () => {
  const same = validate({
    mode: "FULL",
    findings: [finding({ evidenceTier: "T3", severity: "medium", controlsChecked: ["a", "b", "c"], verifiers: ["claude-opus", "claude-sonnet-4"] })],
  });
  assert.equal(same.status, 1);
  assert.match(same.out.problems.join("\n"), />= 2 distinct families/);

  const unknown = validate({
    mode: "FULL",
    findings: [finding({ evidenceTier: "T3", severity: "medium", controlsChecked: ["a", "b", "c"], verifiers: ["model-a", "model-b"] })],
  });
  assert.equal(unknown.status, 1);
  assert.match(unknown.out.problems.join("\n"), /no known family/);
});
