#!/usr/bin/env node
// Mechanical artifact check: the files a phase claims to have produced must exist and
// not be empty stubs. Used by gate builtins where no single command can judge the work.
//
//   node pipeline/tools/expect-files.mjs docs/FINAL-REPORT.md README.md .env.example
//   node pipeline/tools/expect-files.mjs --glob "docs/06-build/slice-*.md"
import fs from "node:fs";
import path from "node:path";
import { parseArgs, fail } from "./lib/common.mjs";

const { flags, positional } = parseArgs();
const minBytes = Number(flags.min ?? 64);
const globs = flags.glob ? [].concat(flags.glob) : [];

let problems = [];
for (const file of positional) {
  if (!fs.existsSync(file)) problems.push(`missing: ${file}`);
  else if (fs.statSync(file).size < minBytes) problems.push(`too small to be evidence (${fs.statSync(file).size} < ${minBytes} bytes): ${file}`);
  else console.log(`ok   ${file}`);
}

for (const glob of globs) {
  const dir = path.dirname(glob);
  const prefix = path.basename(glob).split("*")[0];
  const suffix = path.basename(glob).split("*")[1] ?? "";
  const hits = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith(suffix)) : [];
  if (hits.length === 0) problems.push(`no files match ${glob}`);
  else for (const hit of hits.sort()) console.log(`ok   ${path.join(dir, hit)}`);
}

for (const p of problems) console.log(`PROBLEM ${p}`);
if (problems.length) {
  console.log("RESULT: FAIL");
  process.exit(1);
}
if (positional.length + globs.length === 0) fail("nothing to check; pass file paths or --glob");
console.log("RESULT: PASS");
