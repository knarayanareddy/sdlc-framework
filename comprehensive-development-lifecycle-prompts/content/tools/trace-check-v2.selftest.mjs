#!/usr/bin/env node
// Self-test: every case that fooled trace-check v1 must fail here, and a genuine test must pass.
// Run: node content/tools/trace-check-v2.selftest.mjs   (exit 0 = all behaviours as expected)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const tool = path.join(path.dirname(new URL(import.meta.url).pathname), "trace-check-v2.mjs");
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

function run(name, testSource, expectExit, extraArgs = [], spec = SPEC, mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tcv2-"));
  fs.mkdirSync(path.join(dir, "tests"));
  fs.writeFileSync(path.join(dir, "SPEC.md"), spec);
  if (testSource !== null) fs.writeFileSync(path.join(dir, "tests", "t.test.ts"), testSource);
  mutate?.(dir);
  const r = spawnSync("node", [tool, path.join(dir, "SPEC.md"), path.join(dir, "tests"), ...extraArgs.map((a) => a.replace("$DIR", dir))], { encoding: "utf8" });
  const ok = r.status === expectExit;
  console.log(`${ok ? "ok  " : "FAIL"} ${name} (exit ${r.status}, wanted ${expectExit})`);
  if (!ok) console.log(r.stdout + r.stderr);
  return ok;
}

const results = [
  run("skipped assertion-free test is NOT coverage", `// @req SEC-001\nimport { it } from "vitest";\nit.skip("B cannot read A", () => {});\n`, 1),
  run("tautology + trailing-comment tag is NOT coverage", `import { it, expect } from "vitest";\nit("x", () => { expect(1).toBe(1); }); /* @req SEC-001 */\n`, 1),
  run("tag in comment but zero assertions is NOT coverage", `// @req SEC-001\nimport { it } from "vitest";\nit("x", () => {});\n`, 1),
  run("genuine tagged test with a real assertion passes", `// @req SEC-001\nimport { it, expect } from "vitest";\nit("B gets 404 for A's item", async () => { const res = { status: 404 }; expect(res.status).toBe(404); });\n`, 0),
  run("zero-requirement spec fails with an explanation", `// @req SEC-001\nexpect(1).toBe(2)\n`, 1, [], "# empty\n"),
  run("baseline: removing assertions after baseline fails", `// @req SEC-001\nexpect(a).toBe(1); expect(b).toBe(2);\n`, 1, ["--check-baseline", "$DIR/base.json"], SPEC, (dir) => {
    fs.writeFileSync(path.join(dir, "base.json"), JSON.stringify({ [path.join(dir, "tests", "t.test.ts")]: { sha: "x", asserts: 5, skips: 0 } }));
  }),
  run("baseline: deleting a test file fails", null, 1, ["--check-baseline", "$DIR/base.json", "--allow-uncovered"], SPEC, (dir) => {
    fs.writeFileSync(path.join(dir, "base.json"), JSON.stringify({ [path.join(dir, "tests", "gone.test.ts")]: { sha: "x", asserts: 3, skips: 0 } }));
  }),
];

const failed = results.filter((r) => !r).length;
console.log(failed === 0 ? `\nall ${results.length} behaviours as expected` : `\n${failed} unexpected result(s)`);
process.exit(failed === 0 ? 0 : 1);
