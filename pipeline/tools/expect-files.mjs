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
// B-33: "exists and is ≥ 64 bytes" was the whole check for design docs and slice logs. A file
// that is 64 bytes of "a" is not evidence, so --substance asks for a heading, an id and no
// placeholder instead.
const substance = Boolean(flags.substance);
const requireId = Boolean(flags["require-id"]);

// Per file type, because a design brief and a token file cannot be judged the same way.
// A markdown doc needs a heading and something to read (a placeholder is not a doc); a JSON
// artefact has to parse; anything else keeps the byte floor. `--require-id` additionally asks
// the file to name a requirement, which is what a slice log has to do.
function substanceOf(file) {
  const bytes = fs.statSync(file).size;
  if (bytes < minBytes) return false;
  const ext = path.extname(file).toLowerCase();
  if (ext === ".md" || ext === ".markdown" || ext === ".txt") {
    let body;
    try {
      body = fs.readFileSync(file, "utf8");
    } catch {
      return false;
    }
    const heading = /^#{1,3}\s+\S/m.test(body);
    const words = body.split(/\s+/).filter(Boolean).length;
    const placeholder = /\b(TODO|TBD|lorem ipsum|FIXME|placeholder text)\b/i.test(body);
    const id = /\b(?:REQ|SEC|NFR)-\d+\b/.test(body);
    return heading && words >= 60 && !placeholder && (!requireId || id);
  }
  if (ext === ".json") {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      if (Array.isArray(parsed)) return parsed.length > 0;
      return parsed !== null && typeof parsed === "object" && Object.keys(parsed).length >= 3;
    } catch {
      return false;
    }
  }
  return bytes >= minBytes;
}

let problems = [];
for (const file of positional) {
  if (!fs.existsSync(file)) problems.push(`missing: ${file}`);
  else if (fs.statSync(file).size < minBytes) problems.push(`too small to be evidence (${fs.statSync(file).size} < ${minBytes} bytes): ${file}`);
  else if (substance && !substanceOf(file)) problems.push(`substance: ${file} is ${fs.statSync(file).size} bytes but says nothing a reviewer can check (needs a heading and readable text, not a placeholder)`);
  else console.log(`ok   ${file}`);
}

for (const glob of globs) {
  const dir = path.dirname(glob);
  const prefix = path.basename(glob).split("*")[0];
  const suffix = path.basename(glob).split("*")[1] ?? "";
  const hits = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith(suffix)) : [];
  if (hits.length === 0) problems.push(`no files match ${glob}`);
  else
    for (const hit of hits.sort()) {
      const file = path.join(dir, hit);
      if (substance && !substanceOf(file)) problems.push(`substance: ${file} is a file with a name but no account of the slice (needs a heading and readable text, not a placeholder)`);
      else console.log(`ok   ${file}`);
    }
}

for (const p of problems) console.log(`PROBLEM ${p}`);
if (problems.length) {
  console.log("RESULT: FAIL");
  process.exit(1);
}
if (positional.length + globs.length === 0) fail("nothing to check; pass file paths or --glob");
console.log("RESULT: PASS");
