#!/usr/bin/env node
// Self-test: every case that fooled trace-check v1 must fail here, and a genuine test must pass.
// Run: node pipeline/tools/trace-check-v2.selftest.mjs   (exit 0 = all behaviours as expected)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const tool = path.join(path.dirname(fileURLToPath(import.meta.url)), "trace-check-v2.mjs");
const SPEC = `# Demo
## 8. Requirements

### SEC-001 Owner scoping
- Priority: P0
- Statement: The system shall scope every item query by the session user id.
- Acceptance:
  - Given users A and B, When B requests A's item, Then the response is 404.
- Test level: security
- Done-when: matrix passes.
`;

function run(name, testSource, expectExit, extraArgs = [], spec = SPEC, mutate, expectStdout) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tcv2-"));
  fs.mkdirSync(path.join(dir, "tests"));
  fs.writeFileSync(path.join(dir, "SPEC.md"), spec);
  if (testSource !== null) fs.writeFileSync(path.join(dir, "tests", "t.test.ts"), testSource);
  mutate?.(dir);
  const r = spawnSync("node", [tool, path.join(dir, "SPEC.md"), path.join(dir, "tests"), ...extraArgs.map((a) => a.replace("$DIR", dir))], { encoding: "utf8" });
  let okExit = r.status === expectExit;
  const out = `${r.stdout}${r.stderr}`;
  if (okExit && expectStdout && !out.includes(expectStdout)) okExit = false;
  console.log(`${okExit ? "ok  " : "FAIL"} ${name} (exit ${r.status}, wanted ${expectExit}${expectStdout ? `, stdout must contain "${expectStdout}"` : ""})`);
  if (!okExit) console.log(out);
  return okExit;
}

const results = [
  run("skipped assertion-free test is NOT coverage", `// @req SEC-001\nimport { it } from "vitest";\nit.skip("B cannot read A", () => {});\n`, 1),
  run("tautology + trailing-comment tag is NOT coverage", `import { it, expect } from "vitest";\nit("x", () => { expect(1).toBe(1); }); /* @req SEC-001 */\n`, 1),
  run("tag in comment but zero assertions is NOT coverage", `// @req SEC-001\nimport { it } from "vitest";\nit("x", () => {});\n`, 1),
  run("genuine tagged test with a real assertion passes", `// @req SEC-001\nimport { it, expect } from "vitest";\nit("B gets 404 for A's item", async () => { const res = { status: 404 }; expect(res.status).toBe(404); });\n`, 0),
  run("zero-requirement spec fails with an explanation", `// @req SEC-001\nexpect(1).toBe(2)\n`, 1, [], "# empty\n", undefined, "no '### REQ-001'"),
  run("baseline: removing assertions after baseline fails", `// @req SEC-001\nexpect(a).toBe(1); expect(b).toBe(2);\n`, 1, ["--check-baseline", "$DIR/base.json"], SPEC, (dir) => {
    fs.writeFileSync(path.join(dir, "base.json"), JSON.stringify({ [path.join(dir, "tests", "t.test.ts")]: { sha: "x", asserts: 5, skips: 0, cases: 2 } }));
  }),
  run("baseline: deleting a test file fails", null, 1, ["--check-baseline", "$DIR/base.json", "--allow-uncovered"], SPEC, (dir) => {
    fs.writeFileSync(path.join(dir, "base.json"), JSON.stringify({ [path.join(dir, "tests", "gone.test.ts")]: { sha: "x", asserts: 3, skips: 0, cases: 1 } }));
  }),
  // New in the pipeline build: deleting a case while keeping an assertion elsewhere is caught.
  run("baseline: losing a test case fails even when assertions remain", `// @req SEC-001\nit("a", () => { expect(x).toBe(1); expect(y).toBe(2); });\n`, 1, ["--check-baseline", "$DIR/base.json"], SPEC, (dir) => {
    fs.writeFileSync(path.join(dir, "base.json"), JSON.stringify({ [path.join(dir, "tests", "t.test.ts")]: { sha: "x", asserts: 1, skips: 0, cases: 2 } }));
  }),
  // New: a missing baseline is a failure, not a silent pass.
  run("baseline: a missing baseline file fails closed", `// @req SEC-001\nexpect(1).toBe(2);\n`, 1, ["--check-baseline", "$DIR/nope.json"]),
  // New: machine-readable output for the orchestrator.
  run("--json emits a parseable result", `// @req SEC-001\nexpect(1).toBe(2);\n`, 0, ["--json"], SPEC, undefined, '"result": "PASS"'),
];

const failed = results.filter((r) => !r).length;
console.log(failed === 0 ? `\nall ${results.length} behaviours as expected` : `\n${failed} unexpected result(s)`);
process.exit(failed === 0 ? 0 : 1);
