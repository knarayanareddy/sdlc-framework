#!/usr/bin/env node
// Gate ledger CLI: verify | show | append | demo
//   node pipeline/tools/gate-ledger.mjs verify --path docs/gate-ledger.jsonl [--progress docs/progress.json] [--require-hmac]
//   node pipeline/tools/gate-ledger.mjs demo        # tamper test, exit 0 when tampering is caught
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendLedger, readLedger, readLedgerSafe, verifyLedger } from "./lib/ledger.mjs";
import { STATUSES } from "./lib/gates.mjs";
import { fail, ok, paint, parseArgs, readJson } from "./lib/common.mjs";

const { flags, positional } = parseArgs();
const command = positional[0] ?? "verify";

function tamperDemo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ledger-demo-"));
  const file = path.join(dir, "gate-ledger.jsonl");
  appendLedger(file, { phase: "00", gate: "G0", status: "passed", command: "true", exitCode: 0, commit: "abc1234" });
  appendLedger(file, { phase: "01", gate: "G1", status: "passed", command: "true", exitCode: 0, commit: "abc1234" });

  const clean = verifyLedger(file);
  const lines = fs.readFileSync(file, "utf8").trim().split("\n");
  lines[0] = lines[0].replace('"passed"', '"failed"');
  fs.writeFileSync(file, `${lines.join("\n")}\n`);
  const tampered = verifyLedger(file);

  console.log(`clean chain:    ${clean.ok ? "ok" : `broken (${clean.error})`}`);
  console.log(`after tamper:   ${tampered.ok ? "ok (BAD: the edit was not detected)" : `broken as expected (${tampered.error})`}`);
  if (!clean.ok || tampered.ok) {
    console.error(paint.red("RESULT: FAIL - the ledger does not detect edits"));
    process.exit(1);
  }
  ok("RESULT: PASS - a single edited line breaks the chain");
}

switch (command) {
  case "verify": {
    const file = flags.path ?? "docs/gate-ledger.jsonl";
    if (!fs.existsSync(file)) fail(`no ledger at ${file}`);

    // Cross-checking against progress.json is what catches a truncated tail: the remaining
    // chain is still valid, so the chain alone can never notice deleted entries.
    let progressPath = flags.progress ?? null;
    if (!progressPath) {
      const sibling = path.join(path.dirname(file), "progress.json");
      if (path.basename(file) === "gate-ledger.jsonl" && fs.existsSync(sibling)) progressPath = sibling;
    }
    let progress = null;
    if (progressPath) {
      if (!fs.existsSync(progressPath)) fail(`--progress ${progressPath} does not exist`);
      progress = readJson(progressPath);
    }

    const { entries, error } = readLedgerSafe(file);
    if (error) {
      console.log(`entries: ${entries.length}  chain: BROKEN`);
      console.log(paint.red(`PROBLEM ${error}`));
      console.log("RESULT: FAIL");
      process.exit(1);
    }
    const result = verifyLedger(file, { progress, requireHmac: Boolean(flags["require-hmac"]) });
    const withoutManifest = entries.filter((e) => !e.filesGivenToVerifier).length;
    const withoutModel = entries.filter((e) => !e.modelFamily).length;
    const sealedEntries = entries.filter((e) => e.hmac).length;
    console.log(`entries: ${result.count}  chain: ${result.ok ? "intact" : "BROKEN"}`);
    if (progress) console.log(`cross-checked against ${progressPath}: ${Object.keys(progress.gates ?? {}).length} gate(s), ${Object.values(progress.phases ?? {}).filter((p) => p?.status === "done").length} phase(s)`);
    else console.log(paint.yellow("warn: no progress.json to cross-check against, so a truncated tail cannot be detected"));
    if (result.ok && sealedEntries) console.log(`sealed: ${sealedEntries}/${result.count} entries carry an HMAC`);
    if (result.ok && !sealedEntries) console.log(paint.yellow("unsealed: no PIPELINE_LEDGER_KEY, so a recomputed chain is not detectable (accidental-edit checksum only)"));
    if (!result.ok) console.log(paint.red(`PROBLEM ${result.error}`));
    if (withoutManifest) console.log(paint.yellow(`warn: ${withoutManifest}/${result.count} entries record no filesGivenToVerifier (context manifest missing)`));
    if (withoutModel) console.log(paint.yellow(`warn: ${withoutModel}/${result.count} entries record no modelFamily (NOT_VERIFIED: single-model-family)`));
    console.log(result.ok ? "RESULT: PASS" : "RESULT: FAIL");
    process.exit(result.ok ? 0 : 1);
    break;
  }
  case "show": {
    const file = flags.path ?? "docs/gate-ledger.jsonl";
    const { entries, error } = readLedgerSafe(file);
    if (error) fail(error);
    if (flags.json) {
      console.log(JSON.stringify(entries, null, 2));
    } else {
      for (const e of entries) {
        console.log(`${String(e.seq).padStart(2, "0")} ${e.at} ${String(e.gate ?? "-").padEnd(4)} ${String(e.status).padEnd(13)} exit=${e.exitCode} ${e.command ?? ""}`);
      }
    }
    break;
  }
  case "append": {
    const file = flags.path ?? "docs/gate-ledger.jsonl";
    const status = flags.status;
    if (!STATUSES.includes(status)) fail(`--status must be one of ${STATUSES.join(", ")}`);
    const entry = appendLedger(file, {
      phase: flags.phase ?? null,
      gate: flags.gate ?? null,
      status,
      command: flags.command ?? null,
      exitCode: flags.exit === undefined ? null : Number(flags.exit),
      commit: flags.commit ?? null,
      evidence: flags.evidence ? String(flags.evidence).split(",").map((s) => s.trim()) : null,
      filesGivenToVerifier: flags.files ? String(flags.files).split(",").map((s) => s.trim()) : null,
      modelFamily: flags.model ?? null,
    });
    ok(`appended seq=${entry.seq} hash=${entry.hash.slice(0, 12)}…`);
    break;
  }
  case "demo":
    tamperDemo();
    break;
  case "export": {
    const file = flags.path ?? "docs/gate-ledger.jsonl";
    const { entries, error } = readLedgerSafe(file);
    if (error) fail(error);
    console.log(JSON.stringify({ exportedAt: new Date().toISOString(), entries }, null, 2));
    break;
  }
  default:
    fail(`unknown command "${command}". Use: verify | show | append | demo | export`);
}


