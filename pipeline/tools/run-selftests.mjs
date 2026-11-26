#!/usr/bin/env node
// Run every pipeline tool test. This is the G0 requirement that a tool is not
// trusted until its own test passes (v2-05 part 1, step 1).
//
//   node pipeline/tools/run-selftests.mjs
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { paint } from "./lib/common.mjs";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const entries = fs.readdirSync(dir).filter((f) => /\.(test|selftest)\.mjs$/.test(f)).sort();

const nodeTests = entries.filter((f) => f.endsWith(".test.mjs"));
const scripts = entries.filter((f) => f.endsWith(".selftest.mjs"));

const results = [];

if (nodeTests.length) {
  process.stdout.write(`${paint.bold("node --test")} ${nodeTests.length} file(s) … `);
  const res = spawnSync("node", ["--test", ...nodeTests.map((f) => path.join(dir, f))], { encoding: "utf8" });
  const pass = res.status === 0;
  results.push({ name: "node --test", ok: pass, status: res.status });
  console.log(pass ? paint.green("pass") : paint.red("FAIL"));
  if (!pass) console.log(res.stdout + res.stderr);
}

for (const file of scripts) {
  process.stdout.write(`${file.padEnd(34)} `);
  const res = spawnSync("node", [path.join(dir, file)], { encoding: "utf8" });
  const pass = res.status === 0;
  results.push({ name: file, ok: pass, status: res.status });
  console.log(pass ? paint.green("pass") : paint.red("FAIL"));
  if (!pass) console.log(res.stdout + res.stderr);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} test groups pass`);
if (failed.length) {
  console.log("RESULT: FAIL");
  process.exit(1);
}
console.log("RESULT: PASS");
