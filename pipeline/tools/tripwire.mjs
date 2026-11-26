#!/usr/bin/env node
// Per-slice tripwire (v2-05 part 2). Deterministic, target <= 10 minutes.
// Fail closed: a check whose tool is not installed is NOT_VERIFIED, never a pass,
// and --strict turns that into a failure for release gates.
//
//   node pipeline/tools/tripwire.mjs [--config pipeline.config.json] [--only tsc,lint]
//        [--log docs/06-build/slice-01-tripwire.log] [--strict]
import fs from "node:fs";
import path from "node:path";
import { parseArgs, readJson, run, ensureDir, paint, warn } from "./lib/common.mjs";

const { flags } = parseArgs();
const configPath = flags.config ?? "pipeline.config.json";
const config = fs.existsSync(configPath) ? readJson(configPath) : {};
const strict = Boolean(flags.strict);
const only = flags.only ? String(flags.only).split(",").map((s) => s.trim()) : null;

// Default set: the always-available checks plus the scanners from v2-05.
const DEFAULT_CHECKS = [
  { name: "types", cmd: "npx tsc --noEmit" },
  { name: "lint", cmd: "npx eslint ." },
  { name: "build", cmd: "npm run build" },
  { name: "trace", cmd: "node pipeline/tools/trace-check-v2.mjs docs/02-spec/SPEC.md tests --allow-uncovered" },
  { name: "sast", cmd: "semgrep --config p/owasp-top-ten --config p/typescript --error", optional: true },
  { name: "secrets", cmd: "gitleaks detect --no-banner", optional: true },
  { name: "deps", cmd: "osv-scanner --lockfile package-lock.json", optional: true },
  { name: "mutation", cmd: "npx stryker run", optional: true },
  { name: "skeleton", cmd: "npx playwright test tests/e2e/skeleton.spec.ts", optional: true },
];

const checks = (config.tripwire ?? DEFAULT_CHECKS).filter((c) => !only || only.includes(c.name));
const MISSING_TOOL = /not found|No such file or directory|command not found|ENOENT/i;

const results = [];
for (const check of checks) {
  process.stdout.write(`${check.name.padEnd(10)} `);
  const res = run(check.cmd, { timeout: 600_000 });
  const combined = `${res.stderr}\n${res.stdout}`;
  const toolMissing = res.code === 127 || (res.code !== 0 && MISSING_TOOL.test(res.stderr.split("\n")[0] ?? "") && combined.length < 2000);
  const status = res.code === 0 ? "pass" : toolMissing ? "NOT_VERIFIED" : "fail";
  results.push({ name: check.name, cmd: check.cmd, status, exitCode: res.code, ms: res.durationMs, tail: combined.trim().split("\n").slice(-6).join("\n") });
  const label = status === "pass" ? paint.green("pass") : status === "fail" ? paint.red("FAIL") : paint.yellow("NOT_VERIFIED");
  console.log(`${label} ${(res.durationMs / 1000).toFixed(1)}s`);
  if (status === "fail") console.log(indent(results.at(-1).tail));
  if (status === "NOT_VERIFIED") console.log(paint.dim(`  → tool unavailable. A human must run: ${check.cmd}`));
}

function indent(text) {
  return text
    .split("\n")
    .map((l) => `  │ ${l}`)
    .join("\n");
}

const failed = results.filter((r) => r.status === "fail");
const notVerified = results.filter((r) => r.status === "NOT_VERIFIED");
const summary = `checks: ${results.length}  pass: ${results.length - failed.length - notVerified.length}  fail: ${failed.length}  NOT_VERIFIED: ${notVerified.length}`;

console.log(`\n${summary}`);
if (notVerified.length) {
  warn(`${notVerified.length} check(s) could not be evaluated. They are NOT_VERIFIED, not green.`);
  console.log("A human must run:");
  for (const r of notVerified) console.log(`  ${r.cmd}`);
}

const logPath = flags.log ?? null;
if (logPath) {
  ensureDir(path.dirname(logPath));
  const body = [
    `# Tripwire ${new Date().toISOString()}`,
    "",
    summary,
    "",
    ...results.map((r) => `- ${r.status.toUpperCase().padEnd(12)} ${r.name.padEnd(10)} ${r.cmd}${r.status === "pass" ? "" : `\n${indent(r.tail)}`}`),
    "",
  ].join("\n");
  fs.writeFileSync(logPath, body);
  console.log(`log: ${logPath}`);
}

const bad = failed.length > 0 || (strict && notVerified.length > 0);
console.log(bad ? "RESULT: FAIL" : notVerified.length ? "RESULT: PASS (with NOT_VERIFIED checks)" : "RESULT: PASS");
process.exit(bad ? 1 : 0);
