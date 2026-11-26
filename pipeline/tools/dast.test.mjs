// The normaliser is testable without the scanners: fixtures in the shapes semgrep, ZAP,
// nuclei and SARIF actually emit. The scanners themselves are NOT_VERIFIED here, and the
// test asserts that they are reported as such rather than as "clean".
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fromNuclei, fromSarif, fromSemgrep, fromZap, lead } from "./lib/leads.mjs";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dast = path.join(here, "dast.mjs");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "dast-"));
const cli = (args, cwd) => spawnSync("node", [dast, ...args], { encoding: "utf8", cwd: cwd ?? here, timeout: 120_000 });

const FIXTURES = {
  semgrep: {
    results: [
      { check_id: "javascript.express.security.audit.xss", path: "src/app/api/items/route.ts", start: { line: 42 }, extra: { severity: "ERROR", message: "Unescaped output" } },
      { check_id: "generic.secrets.security.detected-private-key", path: "src/lib/key.ts", start: { line: 7 }, extra: { severity: "WARNING", message: "Private key" } },
    ],
  },
  sarif: {
    version: "2.1.0",
    runs: [
      {
        tool: { driver: { name: "CodeQL", rules: [{ id: "js/sql-injection", shortDescription: { text: "Database query built from user-controlled sources" } }] } },
        results: [
          {
            ruleId: "js/sql-injection",
            level: "error",
            message: { text: "This query depends on user input" },
            locations: [{ physicalLocation: { artifactLocation: { uri: "src/lib/db.ts" }, region: { startLine: 31 } } }],
          },
        ],
      },
    ],
  },
  zap: {
    site: [
      {
        "@name": "http://127.0.0.1:3000",
        alerts: [
          { pluginid: "10020", alert: "Missing Anti-clickjacking Header", riskdesc: "Medium (Medium)", desc: "The response does not include X-Frame-Options.", instances: [{ uri: "http://127.0.0.1:3000/api/items" }] },
          { pluginid: "10038", alert: "Content Security Policy Header Not Set", riskdesc: "Low (High)", desc: "CSP is not set.", instances: [{ uri: "http://127.0.0.1:3000/" }] },
        ],
      },
    ],
  },
  nuclei: [
    { "template-id": "exposed-panel", "matched-at": "http://127.0.0.1:3000/debug", info: { name: "Debug panel exposed", severity: "high" } },
    { "template-id": "missing-hsts", "matched-at": "http://127.0.0.1:3000/", info: { name: "HSTS missing", severity: "low" } },
  ],
};

test("every parser produces the same lead shape", () => {
  const all = [
    ...fromSemgrep(FIXTURES.semgrep),
    ...fromSarif(FIXTURES.sarif),
    ...fromZap(FIXTURES.zap),
    ...fromNuclei(FIXTURES.nuclei.map((n) => JSON.stringify(n)).join("\n")),
  ];
  assert.equal(all.length, 7);
  for (const l of all) {
    assert.deepEqual(Object.keys(l).sort(), ["file", "line", "rule", "severity", "text", "tool"]);
    assert.ok(l.tool && l.rule && l.file);
    assert.equal(typeof l.line, "number");
    assert.ok(l.text.length > 0);
  }
  assert.equal(all[0].file, "src/app/api/items/route.ts");
  assert.equal(all[0].line, 42);
  assert.equal(all[2].tool, "CodeQL");
  assert.equal(all[3].tool, "zap");
  assert.match(all[3].rule, /Anti-clickjacking/);
  assert.equal(all[5].tool, "nuclei");
  assert.equal(all[5].severity, "high");
});

test("lead() truncates runaway text instead of writing a novel into the ledger", () => {
  const l = lead("x", "r", "f", 1, "y".repeat(5000), "low");
  assert.equal(l.text.length, 400);
  assert.equal(lead("x", "r", "f", undefined, "t", "low").line, 0);
});

test("CLI normalises a semgrep report and appends rather than overwrites", () => {
  const d = tmp();
  const from = path.join(d, "semgrep.json");
  const out = path.join(d, "scanner-leads.json");
  fs.writeFileSync(from, JSON.stringify(FIXTURES.semgrep));
  const first = cli(["leads", "--from", from, "--out", out]);
  assert.equal(first.status, 0, first.stderr);
  const second = cli(["leads", "--from", from, "--out", out]);
  assert.equal(second.status, 0, second.stderr);
  const merged = JSON.parse(fs.readFileSync(out, "utf8"));
  assert.equal(merged.leads.length, 4);
  assert.match(second.stdout, /2 lead\(s\) appended, 4 total/);
});

test("every fixture format is recognised without being told", () => {
  const d = tmp();
  const cases = [
    ["semgrep.json", JSON.stringify(FIXTURES.semgrep), 2],
    ["sarif.json", JSON.stringify(FIXTURES.sarif), 1],
    ["zap.json", JSON.stringify(FIXTURES.zap), 2],
    ["nuclei.jsonl", FIXTURES.nuclei.map((n) => JSON.stringify(n)).join("\n"), 2],
  ];
  for (const [name, body, expected] of cases) {
    const from = path.join(d, name);
    fs.writeFileSync(from, body);
    const out = path.join(d, `${name}.leads.json`);
    const r = cli(["leads", "--from", from, "--out", out]);
    assert.equal(r.status, 0, `${name}: ${r.stdout}${r.stderr}`);
    assert.equal(JSON.parse(fs.readFileSync(out, "utf8")).leads.length, expected, name);
  }
});

test("unrecognised scanner output is NOT_VERIFIED, never 'clean'", () => {
  const d = tmp();
  const from = path.join(d, "weird.txt");
  fs.writeFileSync(from, "some scanner printed this and we do not know the format\n");
  const r = cli(["leads", "--from", from]);
  assert.equal(r.status, 3);
  assert.match(r.stdout, /NOT_VERIFIED/);
  assert.match(r.stdout, /--format/);
});

test("plan names every tool, how to install it, and what it produces", () => {
  const r = cli(["plan", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const plan = JSON.parse(r.stdout);
  const names = plan.map((p) => p.name);
  for (const n of ["zap-baseline", "nuclei", "schemathesis", "pipeline-fuzz"]) assert.ok(names.includes(n), n);
  for (const p of plan) {
    assert.equal(typeof p.available, "boolean");
    assert.ok(p.install && p.example && p.artifact);
  }
  assert.equal(plan.find((p) => p.name === "pipeline-fuzz").available, true);
});

test("run without a target is NOT_VERIFIED with the command a human needs", () => {
  const r = cli(["run"]);
  assert.equal(r.status, 3);
  assert.match(r.stdout, /no --target/);
  assert.match(r.stdout, /human command/);
});

test("run against a dead target records what did not happen", () => {
  const d = tmp();
  const r = cli(["run", "--target", "http://127.0.0.1:9", "--out", path.join(d, "floor")]);
  const summary = JSON.parse(fs.readFileSync(path.join(d, "floor", "dast.json"), "utf8"));
  assert.equal(summary.result, "NOT_VERIFIED");
  assert.equal(summary.ran, 0);
  assert.ok(summary.notVerified.length >= 1);
  assert.match(r.stdout, /RESULT: NOT_VERIFIED/);
  assert.equal(r.status, 3);
});

// ---- P1 · a scan that produced nothing readable is not a scan that ran -------------------
test("schemathesis junit output is parsed, not silently dropped", () => {
  // The tool declared `format: "junit"` and had no parser, so its leads vanished while the
  // run was still reported as `ran` (B-02). A passing testcase must not become a lead.
  const d = tmp();
  const junit = path.join(d, "schemathesis.xml");
  fs.writeFileSync(
    junit,
    `<?xml version="1.0"?><testsuite name="schemathesis">
<testcase name="test_items_500" classname="items"><failure message="Server error: 500">trace</failure></testcase>
<testcase name="test_create_item" classname="items"><error message="Undocumented status 418">trace</error></testcase>
<testcase name="test_ok" classname="items"/>
</testsuite>`,
  );
  const out = path.join(d, "leads.json");
  const r = cli(["leads", "--from", junit, "--out", out]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /junit: 2 lead\(s\)/);
  const { leads } = JSON.parse(fs.readFileSync(out, "utf8"));
  assert.equal(leads.length, 2);
  assert.deepEqual(leads.map((l) => l.severity).sort(), ["high", "medium"]);
  assert.match(leads.map((l) => l.text).join("\n"), /Server error: 500/);
});

test("a forced --format that does not match the file is NOT_VERIFIED, not a crash", () => {
  const d = tmp();
  const junit = path.join(d, "report.xml");
  fs.writeFileSync(junit, `<?xml version="1.0"?><testsuite><testcase name="a"/></testsuite>`);
  const r = cli(["leads", "--from", junit, "--format", "zap", "--out", path.join(d, "leads.json")]);
  assert.equal(r.status, 3);
  assert.match(r.stdout, /could not recognise the output format/);
  assert.match(r.stdout, /human command/);
});

test("no scanner produced a parseable artifact, so nothing counts as `ran`", () => {
  // B-01: "ran but produced no artifact" was recorded as ran: true, so a dead target with
  // no scanners installed still produced RESULT: RAN.
  const d = tmp();
  const r = cli(["run", "--target", "http://127.0.0.1:9", "--out", path.join(d, "floor")]);
  assert.equal(r.status, 3);
  const summary = JSON.parse(fs.readFileSync(path.join(d, "floor", "dast.json"), "utf8"));
  assert.equal(summary.ran, 0, JSON.stringify(summary.results, null, 2));
  assert.equal(summary.tools.length, 4);
  for (const res of summary.tools) assert.equal(res.ran, false, `${res.name} claimed to have run`);
  assert.match(r.stdout, /human command/);
});
