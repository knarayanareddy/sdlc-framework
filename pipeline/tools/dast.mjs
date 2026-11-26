#!/usr/bin/env node
// The dynamic-analysis floor (v2-08 §8.1): external scanners where they exist, the built-in
// fuzzer always, and one normaliser so every result arrives as the same "lead" shape the
// hunters already consume.
//
//   node pipeline/tools/dast.mjs plan [--json]
//   node pipeline/tools/dast.mjs run --target http://127.0.0.1:3000 --out docs/08-redteam/run-1/floor [--contract api-contract.json]
//   node pipeline/tools/dast.mjs leads --from semgrep.json [--format auto|semgrep|zap|nuclei|sarif] --out scanner-leads.json
//
// A scanner that is not installed is NOT_VERIFIED with the exact command to install it. A
// scanner that runs but whose output cannot be parsed is NOT_VERIFIED for lead extraction.
// Neither is ever reported as "no issues found".
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ensureDir, fail, ok, paint, parseArgs, readJson, writeJson } from "./lib/common.mjs";
import { fromNuclei, fromSarif, fromSemgrep, fromZap, lead } from "./lib/leads.mjs";
import { fileURLToPath } from "node:url";

const { flags, positional } = parseArgs();
const [command = "plan"] = positional;
const here = path.dirname(fileURLToPath(import.meta.url));

const TOOLS = [
  {
    name: "zap-baseline",
    detect: "docker image inspect ghcr.io/zaproxy/zaproxy:stable || command -v zap-baseline.py || command -v zaproxy",
    install: "docker pull ghcr.io/zaproxy/zaproxy:stable",
    command: (target) =>
      `docker run --rm --network host -v "$PWD/.zap:/zap/wrk:rw" ghcr.io/zaproxy/zaproxy:stable zap-baseline.py -t ${target} -J report_json.json -I`,
    artifact: ".zap/report_json.json",
    format: "zap",
    why: "passive + baseline active scanning of a running build",
  },
  {
    name: "nuclei",
    detect: "command -v nuclei",
    install: "go install github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest && nuclei -update-templates",
    command: (target) => `nuclei -u ${target} -jsonl -severity low,medium,high,critical -o nuclei.jsonl`,
    artifact: "nuclei.jsonl",
    format: "nuclei",
    why: "template checks for known misconfigurations and exposures",
  },
  {
    name: "schemathesis",
    detect: "command -v schemathesis || command -v st",
    install: "pipx install schemathesis",
    command: (target, contract) =>
      `schemathesis run ${contract?.openapi ?? "<your openapi.json>"} --base-url ${target} --checks all --hypothesis-max-examples 25 --report junit --junit-xml schemathesis.xml`,
    artifact: "schemathesis.xml",
    format: "junit",
    why: "property-based fuzzing driven by the OpenAPI schema",
  },
  {
    name: "pipeline-fuzz",
    detect: "node -e 0",
    install: "(built in, no install)",
    command: (target, contract) => `node ${path.join(here, "fuzz-api.mjs")} --base ${target} --contract ${contract?.path ?? "api-contract.json"} --out fuzz.json`,
    artifact: "fuzz.json",
    format: "fuzz",
    why: "schema-driven adversarial requests, works with no extra tooling",
  },
];

function detect(spec) {
  const res = spawnSync(spec.detect, { shell: true, encoding: "utf8", timeout: 20_000 });
  return res.status === 0;
}

function cmdPlan() {
  const available = TOOLS.map((t) => ({ ...t, available: detect(t) }));
  if (flags.json) {
    console.log(
      JSON.stringify(
        available.map((t) => ({ name: t.name, available: t.available, install: t.install, why: t.why, artifact: t.artifact, example: t.command("<target>", { path: "api-contract.json" }) })),
        null,
        2,
      ),
    );
    return;
  }
  console.log(paint.bold("dynamic analysis floor"));
  for (const t of available) {
    const mark = t.available ? paint.green("ready") : paint.yellow("NOT_VERIFIED");
    console.log(`  ${mark.padEnd(22)} ${t.name.padEnd(14)} ${t.why}`);
    if (!t.available) console.log(`      install: ${t.install}`);
    console.log(`      run:     ${t.command("<target>", { path: "api-contract.json" })}`);
    console.log(`      output:  ${t.artifact} → ${t.format}`);
  }
  const missing = available.filter((t) => !t.available && t.name !== "pipeline-fuzz");
  if (missing.length) console.log(paint.yellow(`\n${missing.length} scanner(s) are not installed: the report must say the dynamic floor was partial.`));
  console.log(`\nrun with the built-in fuzzer regardless: node pipeline/tools/dast.mjs run --target <url> --contract api-contract.json`);
}

function detectFormat(file, text) {
  if (flags.format && flags.format !== "auto") return String(flags.format);
  if (/^\s*\{/.test(text)) {
    try {
      const j = JSON.parse(text);
      if (j.results && j.results.some((r) => "check_id" in r)) return "semgrep";
      if (j.runs) return "sarif";
      if (j.site) return "zap";
      if (j.violations) return "fuzz";
    } catch {
      /* fall through to line-based */
    }
  }
  if (text.split("\n").some((l) => l.includes('"template-id"'))) return "nuclei";
  return "unknown";
}

function leadsFrom(file, format) {
  const text = fs.readFileSync(file, "utf8");
  const fmt = detectFormat(file, text);
  switch (fmt) {
    case "semgrep":
      return { fmt, leads: fromSemgrep(JSON.parse(text)) };
    case "sarif":
      return { fmt, leads: fromSarif(JSON.parse(text)) };
    case "zap":
      return { fmt, leads: fromZap(JSON.parse(text)) };
    case "nuclei":
      return { fmt, leads: fromNuclei(text) };
    case "fuzz": {
      const j = JSON.parse(text);
      return {
        fmt,
        leads: (j.violations ?? []).map((v) => lead("pipeline-fuzz", v.rule, j.contract ?? file, 0, `${v.case}: ${v.detail}`, v.severity)),
      };
    }
    default:
      return { fmt, leads: [] };
  }
}

function appendLeads(outFile, leads) {
  const existing = fs.existsSync(outFile) ? readJson(outFile) : { leads: [] };
  const merged = Array.isArray(existing) ? existing : existing.leads ?? [];
  writeJson(outFile, { leads: [...merged, ...leads] });
  return merged.length + leads.length;
}

function cmdLeads() {
  const from = String(flags.from ?? "");
  if (!from || !fs.existsSync(from)) fail(`no scanner output at "${from}"`);
  const { fmt, leads } = leadsFrom(from, flags.format);
  if (fmt === "unknown") {
    console.log(paint.yellow(`NOT_VERIFIED: could not recognise the output format of ${from}`));
    console.log(`human command: node pipeline/tools/dast.mjs leads --from ${from} --format semgrep|zap|nuclei|sarif`);
    process.exit(3);
  }
  const out = String(flags.out ?? path.join(path.dirname(from), "scanner-leads.json"));
  const total = appendLeads(out, leads);
  console.log(`${fmt}: ${leads.length} lead(s) appended, ${total} total → ${out}`);
  console.log(paint.dim("leads are hypotheses for a hunter; a lead becomes a finding only after a confirmed trace"));
  process.exit(0);
}

function cmdRun() {
  const target = String(flags.target ?? process.env.PIPELINE_DAST_TARGET ?? "");
  const outDir = String(flags.out ?? "docs/08-redteam/run-1/floor");
  ensureDir(outDir);
  const contract = flags.contract
    ? { path: String(flags.contract), openapi: readJson(String(flags.contract)).openapiUrl ?? null }
    : null;

  if (!target) {
    console.log(paint.yellow("NOT_VERIFIED: no --target, so no dynamic analysis can run"));
    console.log(`human command: start the production build and re-run with --target http://127.0.0.1:3000`);
    process.exit(3);
  }

  const results = [];
  for (const tool of TOOLS) {
    if (tool.name === "pipeline-fuzz" && !contract) {
      results.push({ name: tool.name, ran: false, why: "no --contract, so the schema-driven fuzzer has nothing to drive" });
      continue;
    }
    const available = detect(tool);
    if (!available) {
      results.push({ name: tool.name, ran: false, why: `not installed — ${tool.install}` });
      continue;
    }
    const cmd = tool.command(target, contract);
    const res = spawnSync(cmd, { shell: true, encoding: "utf8", timeout: Number(flags.timeout ?? 900_000), cwd: process.cwd() });
    const log = path.join(outDir, `${tool.name}.log`);
    fs.writeFileSync(log, `${cmd}\n\n${res.stdout ?? ""}\n${res.stderr ?? ""}`);

    // Scanners use non-zero exit codes for "findings", which is not "failed to run".
    const found = [path.join(outDir, tool.artifact), tool.artifact, path.join(".zap", "report_json.json")].find((p) => fs.existsSync(p));
    if (!found) {
      results.push({ name: tool.name, ran: true, exitCode: res.status, why: `ran but produced no ${tool.artifact}; lead extraction NOT_VERIFIED`, log });
      continue;
    }
    const { fmt, leads } = leadsFrom(found, tool.format);
    if (!leads.length && fmt === "unknown") {
      results.push({ name: tool.name, ran: true, exitCode: res.status, why: "output format not recognised", log });
      continue;
    }
    const leadsFile = path.join(outDir, "scanner-leads.json");
    appendLeads(leadsFile, leads);
    results.push({ name: tool.name, ran: true, exitCode: res.status, leads: leads.length, artifact: found, log });
  }

  const ran = results.filter((r) => r.ran).length;
  const summary = {
    target,
    contract: contract?.path ?? null,
    tools: results,
    ran,
    notVerified: results.filter((r) => !r.ran),
    at: new Date().toISOString(),
    result: ran === 0 ? "NOT_VERIFIED" : "RAN",
  };
  writeJson(path.join(outDir, "dast.json"), summary);

  for (const r of results) {
    const mark = r.ran ? paint.green("ran ") : paint.yellow("skip");
    console.log(`  ${mark} ${r.name.padEnd(14)} ${r.ran ? `${r.leads ?? 0} lead(s)` : r.why}`);
  }
  console.log(`written: ${path.join(outDir, "dast.json")}`);

  if (ran === 0) {
    console.log(paint.yellow("RESULT: NOT_VERIFIED — no dynamic analysis was executed; the report must say so"));
    process.exit(3);
  }
  ok(`RESULT: RAN — ${ran} tool(s) produced output`);
  process.exit(0);
}

const commands = { plan: cmdPlan, run: cmdRun, leads: cmdLeads, help: cmdPlan };
if (!commands[command]) fail(`unknown command "${command}". Known: ${Object.keys(commands).join(", ")}`);
commands[command]();
