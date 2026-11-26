#!/usr/bin/env node
// End-to-end demo: copy examples/mini-app to a temp directory and walk phases 00 → 12,
// running every gate through the real orchestrator. Nothing is faked about the gates:
// each one is a command whose exit code is recorded in a hash-chained ledger.
//
//   node pipeline/tools/demo.mjs [--keep]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { paint } from "./lib/common.mjs";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const PIPELINE = path.resolve(HERE, "..");
const EXAMPLE = path.join(PIPELINE, "examples", "mini-app");
const CLI = path.join(PIPELINE, "bin", "pipeline.mjs");
const keep = process.argv.includes("--keep");

if (!fs.existsSync(EXAMPLE)) {
  console.error(`no example at ${EXAMPLE}`);
  process.exit(1);
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-demo-"));
fs.cpSync(EXAMPLE, work, { recursive: true });

const git = (...args) => spawnSync("git", ["-c", "user.email=demo@example.com", "-c", "user.name=demo", ...args], { cwd: work, encoding: "utf8" });
git("init", "-q");
git("add", "-A");
git("commit", "-q", "-m", "example baseline");

let failures = 0;
function step(label, args, expected = 0) {
  const res = spawnSync("node", [CLI, ...args, "--cwd", work], { encoding: "utf8" });
  const okExit = res.status === expected;
  if (!okExit) failures++;
  console.log(`\n${paint.bold(`$ pipeline ${args.join(" ")}`)}  ${okExit ? paint.green(`exit ${res.status}`) : paint.red(`exit ${res.status}, wanted ${expected}`)}`);
  const out = `${res.stdout}${res.stderr}`.trim();
  for (const line of out.split("\n").slice(0, expected === 0 ? 12 : 24)) console.log(`  ${line}`);
  if (!okExit) {
    console.log(paint.red(out));
    finish();
  }
  return res;
}

function finish() {
  if (keep) console.log(`\nkept: ${work}`);
  else fs.rmSync(work, { recursive: true, force: true });
  console.log(failures ? `\n${paint.red(`RESULT: FAIL — ${failures} step(s) did not do what the framework says`)}` : `\n${paint.green("RESULT: PASS — phases 00 → 12 completed, every gate recorded")}`);
  process.exit(failures ? 1 : 0);
}

console.log(paint.bold(`worked example → ${work}`));

step("phase 00", ["init"]);
step("", ["phase", "start", "00"]);
step("", ["gate", "G0", "--builtin", "ledger,selftests"]);
step("", ["phase", "done", "00"]);

step("phase 01", ["phase", "start", "01"]);
step("", ["gate", "G1", "--builtin", "quotes"]);
step("", ["phase", "done", "01"]);

step("phase 02", ["phase", "start", "02"]);
step("", ["gate", "G2", "--builtin", "trace:structure"]);
step("", ["phase", "done", "02"]);

step("phase H1 (digest)", ["phase", "start", "H1"]);
step("", ["phase", "done", "H1"]);

step("phase 03", ["phase", "start", "03"]);
step("", ["gate", "G3", "--evidence", "docs/03-design/design-brief.md,docs/03-design/tokens.json"]);
step("", ["phase", "done", "03"]);

step("phase 04", ["phase", "start", "04"]);
step("", ["gate", "G4", "--evidence", "docs/04-architecture/threat-model.md,docs/04-architecture/authz-matrix.md"]);
step("", ["phase", "done", "04"]);

step("phase FZ (freeze)", ["phase", "start", "FZ"]);
step("", ["phase", "done", "FZ"]);

step("phase 05", ["phase", "start", "05"]);
step("", ["gate", "G5", "--builtin", "trace:freeze,trace:check,unit"]);
step("", ["phase", "done", "05"]);

step("phase 06", ["phase", "start", "06"]);
step("", ["phase", "done", "06"]);

step("phase 07", ["phase", "start", "07"]);
step("", ["gate", "G7", "--builtin", "unit", "--model", "gpt-5"]);
step("", ["phase", "done", "07"]);

step("phase 08", ["phase", "start", "08"]);
step("", ["phase", "done", "08"]);

step("phase 09", ["phase", "start", "09"]);
step("", ["gate", "G9", "--builtin", "findings,coverage", "--model", "gemini-2.5-pro"]);
step("", ["phase", "done", "09"]);

step("phase 10", ["phase", "start", "10"]);
step("", ["report"]);
step("", ["gate", "G10", "--builtin", "ledger,progress"]);
step("", ["phase", "done", "10"]);

step("phase 11", ["phase", "start", "11"]);
step("", ["gate", "G11", "--not-verified", "--reason", "no staging target is available in this sandbox", "--human-command", "curl -sI https://staging.example/.well-known/build-id"]);
step("", ["phase", "done", "11"]);

step("phase 12", ["phase", "start", "12"]);
step("", ["gate", "G12", "--builtin", "metrics"]);
step("", ["phase", "done", "12"]);

step("final state", ["status"]);
step("re-run every gate (never trust the record)", ["verify"]);

// The final report is generated from the ledger, so it is the last place a false claim could
// appear. Check that it still says the uncomfortable things.
const reportPath = path.join(work, "docs", "FINAL-REPORT.md");
const report = fs.existsSync(reportPath) ? fs.readFileSync(reportPath, "utf8") : "";
const required = [
  ["## Not verified", "the NOT_VERIFIED section"],
  ["calibration:", "the calibration status"],
  ["verifier independence:", "the independence status"],
  ["What this report must not say", "the honesty footer"],
];
const missing = required.filter(([needle]) => !report.includes(needle));
if (missing.length) {
  failures++;
  console.log(`\n${paint.red(`FINAL-REPORT.md is missing: ${missing.map(([, label]) => label).join(", ")}`)}`);
}
const section = report.split("## Red team")[1]?.split("##")[0] ?? "";
if (section) {
  for (const line of section.trim().split("\n").filter((l) => l.startsWith("- "))) console.log(`  ${paint.dim(line)}`);
}

console.log(paint.dim(`\nfinal report: ${path.join(work, "docs", "FINAL-REPORT.md")}`));
finish();
