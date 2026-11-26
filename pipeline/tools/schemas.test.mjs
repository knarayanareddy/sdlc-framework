import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validate, loadSchema as load, SUPPORTED } from "./lib/jsonschema.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMAS = path.resolve(HERE, "..", "schemas");
const PIPELINE = path.resolve(HERE, "..");
const CLI = path.join(PIPELINE, "bin", "pipeline.mjs");

// ---------------------------------------------------------------------------------------
test("every schema is self-consistent and uses only keywords the checker implements", () => {
  for (const name of ["progress.schema.json", "findings.schema.json", "coverage-ledger.schema.json", "verdicts.schema.json"]) {
    const schema = load(name);
    assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema", `${name}: missing $schema`);
    assert.ok(schema.$id && schema.title, `${name}: needs $id and title`);
    for (const key of Object.keys(schema)) assert.ok(SUPPORTED.has(key), `${name}: unsupported top-level keyword ${key}`);
    // A required name that is not in properties can never be documented or validated.
    const missing = (schema.required ?? []).filter((k) => !(k in (schema.properties ?? {})));
    assert.deepEqual(missing, [], `${name}: required but undocumented: ${missing.join(", ")}`);
  }
});

test("metrics.schema.json speaks the same phase/status vocabulary as progress.schema.json", () => {
  const progress = load("progress.schema.json");
  const metrics = load("metrics.schema.json");
  const phaseStatuses = progress.properties.phases.additionalProperties.properties.status.enum;
  const metricsStatuses = metrics.properties.phases.additionalProperties.enum;
  for (const s of phaseStatuses) assert.ok(metricsStatuses.includes(s), `metrics.schema.json is missing phase status "${s}"`);
  const gateStatuses = progress.properties.gates.additionalProperties.properties.status.enum;
  for (const s of gateStatuses) assert.ok(s in metrics.properties.gates.properties, `metrics.schema.json has no counter for gate status "${s}"`);
});

// ---------------------------------------------------------------------------------------
function gitInit(dir) {
  const git = (...args) => spawnSync("git", ["-c", "user.email=t@e.com", "-c", "user.name=t", ...args], { cwd: dir, encoding: "utf8" });
  git("init", "-q");
  fs.writeFileSync(path.join(dir, "README.md"), "# x\n");
  git("add", "-A");
  git("commit", "-qm", "base");
}

const runValidator = (tool, args, cwd) => spawnSync("node", [path.join(HERE, tool), ...args], { encoding: "utf8", cwd });

/** progress: the tool's own output, and three mutations that must be rejected by both. */
test("progress.schema.json and validate-progress agree on what is valid", () => {
  const schema = load("progress.schema.json");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "schema-"));
  gitInit(dir);
  assert.equal(spawnSync("node", [CLI, "init", "--cwd", dir], { encoding: "utf8" }).status, 0);
  const progressFile = path.join(dir, "docs", "progress.json");
  const golden = JSON.parse(fs.readFileSync(progressFile, "utf8"));

  const agree = (doc, label) => {
    const schemaErrors = validate(doc, schema);
    fs.writeFileSync(progressFile, JSON.stringify(doc, null, 2));
    const tool = runValidator("validate-progress.mjs", [progressFile, "--json"], dir);
    const toolOk = tool.status === 0;
    assert.equal(schemaErrors.length === 0, toolOk, `${label}: schema says ${schemaErrors.length === 0 ? "valid" : schemaErrors[0]} but the validator says ${toolOk ? "valid" : "invalid"}`);
    return toolOk;
  };

  assert.equal(agree(golden, "the file `pipeline init` writes"), true, "init must produce a file both accept");

  const badVersion = { ...golden, schemaVersion: 1 };
  assert.equal(agree(badVersion, "schemaVersion 1"), false);

  const badStatus = structuredClone(golden);
  badStatus.gates.G0 = { status: "maybe", command: "x", exitCode: 0, at: new Date().toISOString() };
  assert.equal(agree(badStatus, 'gate status "maybe"'), false);

  // Known gap, stated rather than smoothed over: JSON Schema cannot count, so "rounds agrees
  // with roundLog" is a code-only rule. The validator must reject it; the schema cannot.
  const badRounds = { ...golden, rounds: { full: 2, diff: 0 }, roundLog: [{ phase: "08", mode: "FULL", at: new Date().toISOString() }] };
  assert.deepEqual(validate(badRounds, schema), [], "if the schema ever gains a way to count, delete this exception and re-align");
  const roundsRun = runValidator("validate-progress.mjs", [progressFile, "--json"], dir);
  fs.writeFileSync(progressFile, JSON.stringify(badRounds, null, 2));
  const rejected = runValidator("validate-progress.mjs", [progressFile, "--json"], dir);
  assert.notEqual(rejected.status, 0, "validate-progress must reject rounds that disagree with roundLog");
  assert.match(rejected.stdout, /disagrees with roundLog/);
});

/** findings: schema rules and the tier validator are the same rules. */
test("findings.schema.json and validate-findings agree on what is valid", () => {
  const schema = load("findings.schema.json");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "schema-"));
  const testFile = path.join(dir, "repro.test.mjs");
  fs.writeFileSync(testFile, '// @finding F-01\nimport { test } from "node:test";\nimport assert from "node:assert/strict";\ntest("x", () => { assert.equal(1, 2); });\n');
  const file = path.join(dir, "findings.json");

  const golden = {
    run: "RUN-1",
    mode: "FULL",
    findings: [
      { id: "F-01", title: "IDOR on /api/items/:id", severity: "high", status: "confirmed", evidenceTier: "T1", location: "src/app/api/items/[id]/route.ts:12", test: testFile },
      { id: "F-02", title: "mass assignment on POST", severity: "medium", status: "needs_validation", location: "src/app/api/items/route.ts:10", missing: "whether the ORM whitelists fields", humanCommand: "read the ORM config" },
    ],
  };

  const agree = (doc, label) => {
    const schemaErrors = validate(doc, schema);
    fs.writeFileSync(file, JSON.stringify(doc, null, 2));
    const tool = runValidator("validate-findings.mjs", [file, "--json"], dir);
    assert.equal(schemaErrors.length === 0, tool.status === 0, `${label}: schema says ${schemaErrors.length === 0 ? "valid" : schemaErrors[0]} but the validator says ${tool.status === 0 ? "valid" : "invalid"}`);
    return tool.status === 0;
  };

  assert.equal(agree(golden, "a valid findings file"), true);

  assert.equal(agree({ ...golden, mode: "PARTIAL" }, 'mode "PARTIAL"'), false);

  const badSeverity = structuredClone(golden);
  badSeverity.findings[0].severity = "catastrophic";
  assert.equal(agree(badSeverity, 'severity "catastrophic"'), false);

  const noColon = structuredClone(golden);
  noColon.findings[0].location = "src/app/api/items/route.ts";
  assert.equal(agree(noColon, "a location without a line"), false);

  const t2NoRate = structuredClone(golden);
  t2NoRate.findings[0] = { ...t2NoRate.findings[0], evidenceTier: "T2", iterations: 30 };
  assert.equal(agree(t2NoRate, "T2 without a failureRate"), false);
});

/** coverage-ledger: the schema's shape rules are enforced by coverage-gate. */
test("coverage-ledger.schema.json and coverage-gate agree on what is valid", () => {
  const schema = load("coverage-ledger.schema.json");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "schema-"));
  const entrypoints = path.join(dir, "entrypoints.json");
  const ledgerFile = path.join(dir, "coverage-ledger.json");
  fs.writeFileSync(entrypoints, JSON.stringify({ entrypoints: [{ id: "route:GET /api/items", kind: "route", file: "app/api/items/route.ts", line: 1 }] }));

  const golden = { run: "RUN-1", mode: "FULL", units: [{ id: "route:GET /api/items", status: "examined", hunter: "H1" }] };

  const agree = (doc, label) => {
    const schemaErrors = validate(doc, schema);
    fs.writeFileSync(ledgerFile, JSON.stringify(doc, null, 2));
    const tool = runValidator("coverage-gate.mjs", ["--entrypoints", entrypoints, "--ledger", ledgerFile], dir);
    assert.equal(schemaErrors.length === 0, tool.status === 0, `${label}: schema says ${schemaErrors.length === 0 ? "valid" : schemaErrors[0]} but coverage-gate says ${tool.status === 0 ? "valid" : "invalid"}`);
    return tool.status === 0;
  };

  assert.equal(agree(golden, "a valid ledger"), true);
  assert.equal(agree({ ...golden, mode: undefined }, "no mode"), false);
  assert.equal(agree({ ...golden, units: [{ id: "route:GET /api/items", status: "skimmed" }] }, 'status "skimmed"'), false);
  assert.equal(agree({ units: [] }, "no run, no mode"), false);
});

// ---------------------------------------------------------------------------------------
// The artifacts shipped in the worked example are documentation people copy. If they stop
// matching the schemas, the copy starts life invalid.
test("the worked example's artifacts satisfy the schemas they claim", () => {
  const example = path.resolve(HERE, "..", "examples", "mini-app");
  const cases = [
    ["docs/08-redteam/run-1/findings.json", "findings.schema.json"],
    ["docs/08-redteam/run-1/coverage-ledger.json", "coverage-ledger.schema.json"],
    ["docs/12-eval/metrics.json", "metrics.schema.json"],
  ];
  for (const [rel, schemaName] of cases) {
    const file = path.join(example, rel);
    if (!fs.existsSync(file)) continue;
    const errors = validate(JSON.parse(fs.readFileSync(file, "utf8")), load(schemaName));
    assert.deepEqual(errors, [], `${rel} does not match ${schemaName}`);
  }
  // And the tool agrees with the schema on the real artifact, not just on fixtures.
  const findings = path.join(example, "docs/08-redteam/run-1/findings.json");
  const res = runValidator("validate-findings.mjs", [findings, "--json"], example);
  assert.equal(res.status, 0, `example findings rejected by validate-findings: ${res.stdout}`);
});
