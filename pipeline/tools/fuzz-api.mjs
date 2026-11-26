#!/usr/bin/env node
// Schema-driven API fuzzing that needs no external tool (v2-08 §8.1 Floor).
//
// Fires adversarial requests at a running API and judges the response against the contract:
// no 5xx, reject unknown fields, reject oversized bodies, reject wrong types, do not reflect
// payloads as executable markup, do not serve files, do not 500 on a method you do not support.
//
//   node pipeline/tools/fuzz-api.mjs --contract api-contract.json --out docs/08-redteam/run-1/floor/fuzz.json
//   node pipeline/tools/fuzz-api.mjs --contract api-contract.json --leads docs/08-redteam/run-1/floor/scanner-leads.json
//
// Exit: 0 clean · 1 violations (leads for the hunters, never findings) · 3 could not run.
import fs from "node:fs";
import { fail, ok, paint, parseArgs, readJson, warn, writeJson } from "./lib/common.mjs";

const { flags } = parseArgs();
const contractPath = String(flags.contract ?? "api-contract.json");
const requestTimeout = Number(flags.timeout ?? 5000);

if (!fs.existsSync(contractPath)) {
  console.log(paint.yellow(`NOT_VERIFIED: no contract at ${contractPath}`));
  console.log("the contract is the spec's API section in machine form; see pipeline/templates/api-contract.example.json");
  console.log(`human command: cp pipeline/templates/api-contract.example.json ${contractPath} && node pipeline/tools/fuzz-api.mjs --contract ${contractPath} --base http://127.0.0.1:3000`);
  process.exit(3);
}

const contract = readJson(contractPath);
if (!Array.isArray(contract.endpoints) || !contract.endpoints.length) fail(`${contractPath} has no endpoints[]`);

const base = String(flags.base ?? contract.baseUrl ?? "").replace(/\/+$/, "");
if (!base) fail(`${contractPath} needs baseUrl, or pass --base`);
if (!/^https?:\/\//.test(base)) fail(`baseUrl must start with http:// or https:// (got "${base}")`);

const PAYLOADS = {
  sql: "'; DROP TABLE items;--",
  xss: "<script>alert(1)</script>",
  template: "{{7*7}}${7*7}",
  traversal: "../../../../etc/passwd",
  unicode: "‮‭\u0000\u202e",
  huge: "A".repeat(2 * 1024 * 1024),
};

const sampleValue = (spec) => {
  switch (spec?.type) {
    case "integer":
    case "number":
      return spec.min ?? 1;
    case "boolean":
      return true;
    case "array":
      return [];
    case "object":
      return {};
    default:
      return "probe";
  }
};

function sampleBody(endpoint) {
  if (endpoint.sample) return { ...endpoint.sample };
  const fields = endpoint.body?.fields ?? {};
  return Object.fromEntries(Object.entries(fields).map(([k, spec]) => [k, sampleValue(spec)]));
}

function classify(status, endpoint) {
  const r = endpoint.responses ?? {};
  const okCodes = r.ok ?? [200, 201, 204];
  const client = r.clientError ?? [400, 401, 403, 404, 405, 409, 413, 415, 422, 429];
  if (okCodes.includes(status)) return "ok";
  if (client.includes(status)) return "client";
  if (status >= 300 && status < 400) return "redirect";
  if (status >= 500) return "server";
  return "other";
}

async function send(endpoint, c) {
  const url = new URL(base + (c.path ?? endpoint.path));
  const headers = { accept: "application/json", ...(endpoint.headers ?? {}), ...(c.headers ?? {}) };
  if (c.body !== undefined) headers["content-type"] = c.headers?.["content-type"] ?? "application/json";
  if (endpoint.auth?.env) {
    const token = process.env[endpoint.auth.env];
    if (!token) return { skipped: true, why: `${endpoint.auth.env} is not set` };
    headers[endpoint.auth.header ?? "authorization"] = endpoint.auth.scheme ? `${endpoint.auth.scheme} ${token}` : token;
  }

  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: c.method ?? endpoint.method,
      headers,
      body: c.body === undefined ? undefined : typeof c.body === "string" ? c.body : JSON.stringify(c.body),
      signal: AbortSignal.timeout(requestTimeout),
      redirect: "manual",
    });
    const text = await res.text();
    return {
      status: res.status,
      contentType: res.headers.get("content-type") ?? "",
      text,
      ms: Date.now() - started,
    };
  } catch (err) {
    return { error: err.name === "TimeoutError" ? "timeout" : String(err.message ?? err), ms: Date.now() - started };
  }
}

function casesFor(endpoint) {
  const method = String(endpoint.method).toUpperCase();
  const mutating = ["POST", "PUT", "PATCH"].includes(method);
  const cases = [{ id: "baseline", kind: "baseline" }];

  if (mutating) {
    const body = sampleBody(endpoint);
    cases.push({ id: "unknown-fields", kind: "unknown-field", body: { ...body, __probe: 1, isAdmin: true, role: "admin" } });
    const fields = endpoint.body?.fields ?? {};
    // .find() fuzzed only the first numeric field per endpoint, so every other number
    // in the body went untested.
    const typedFields = Object.entries(fields).filter(([, s]) => s?.type === "integer" || s?.type === "number");
    for (const [name] of typedFields) {
      cases.push({ id: `wrong-type:${name}`, kind: "wrong-type", field: name, body: { ...body, [name]: "not-a-number" } });
    }
    cases.push({ id: "oversized", kind: "oversized", body: { ...body, blob: PAYLOADS.huge } });
    const strField = Object.entries(fields).find(([, s]) => !s?.type || s.type === "string")?.[0];
    if (strField) {
      cases.push({ id: "payload:sql", kind: "injection", field: strField, body: { ...body, [strField]: PAYLOADS.sql } });
      cases.push({ id: "payload:xss", kind: "injection", field: strField, body: { ...body, [strField]: PAYLOADS.xss } });
      cases.push({ id: "payload:template", kind: "injection", field: strField, body: { ...body, [strField]: PAYLOADS.template } });
      cases.push({ id: "payload:unicode", kind: "injection", field: strField, body: { ...body, [strField]: PAYLOADS.unicode } });
      cases.push({ id: "array-bomb", kind: "oversized-shape", body: { ...body, [strField]: Array.from({ length: 5000 }, () => PAYLOADS.xss) } });
    }
    cases.push({ id: "malformed-json", kind: "malformed", body: "{\"unclosed\": ", headers: { "content-type": "application/json" } });
    cases.push({ id: "wrong-content-type", kind: "content-type", body: "a=1", headers: { "content-type": "application/x-www-form-urlencoded" } });
  }

  cases.push({ id: "traversal-path", kind: "traversal", path: endpoint.path.includes(":id") ? endpoint.path.replace(":id", "..%2f..%2fetc%2fpasswd") : `${endpoint.path}/..%2f..%2fetc%2fpasswd` });
  cases.push({ id: "method:OPTIONS", kind: "method", method: "OPTIONS" });
  if (method !== "DELETE") cases.push({ id: "method:DELETE", kind: "method", method: "DELETE" });
  return cases;
}

const violations = [];
const observations = [];
const skipped = [];
const add = (v) => violations.push(v);

function judge(endpoint, c, res) {
  const where = `${String(endpoint.method).toUpperCase()} ${endpoint.path}#${c.id}`;
  if (res.skipped) {
    skipped.push({ case: where, why: res.why });
    observations.push({ case: where, note: `skipped: ${res.why}` });
    return;
  }
  if (res.error) {
    observations.push({ case: where, note: `transport: ${res.error}` });
    if (c.kind === "baseline") add({ rule: "endpoint-unreachable", severity: "high", case: where, detail: `baseline request failed: ${res.error}` });
    return;
  }

  const klass = classify(res.status, endpoint);
  if (klass === "server") {
    add({ rule: "server-error", severity: "high", case: where, detail: `${res.status} on ${c.kind} input — malformed input must be rejected, not crash`, status: res.status, snippet: res.text.slice(0, 200) });
  }

  const rejectUnknown = endpoint.body?.unknownFields === "reject";
  if (c.kind === "unknown-field" && rejectUnknown && klass === "ok") {
    add({ rule: "mass-assignment", severity: "high", case: where, detail: `unknown fields (__probe, isAdmin, role) were accepted with ${res.status}`, status: res.status });
  }
  if (c.kind === "oversized" && klass === "ok") {
    add({ rule: "missing-body-limit", severity: "high", case: where, detail: `a 2 MB body was accepted with ${res.status}`, status: res.status });
  }
  if (c.kind === "wrong-type" && klass === "ok") {
    add({ rule: "unvalidated-type", severity: "medium", case: where, detail: `"${c.field}" accepted a string where the contract says number`, status: res.status });
  }
  if (c.kind === "injection" && c.id === "payload:xss" && /text\/html/i.test(res.contentType) && res.text.includes(PAYLOADS.xss)) {
    add({ rule: "reflected-xss", severity: "medium", case: where, detail: "the payload came back verbatim in a text/html response", snippet: res.text.slice(0, 200) });
  }
  if (c.kind === "traversal" && res.text.includes("root:x:0:0")) {
    add({ rule: "path-traversal", severity: "critical", case: where, detail: "/etc/passwd was served", snippet: res.text.slice(0, 120) });
  }
  if (c.kind === "method" && (res.status === 501 || res.status >= 500)) {
    add({ rule: "unhandled-method", severity: "low", case: where, detail: `${String(endpoint.method).toUpperCase()} path answers ${c.method} with ${res.status}; 405 is the correct answer`, status: res.status });
  }
  if (klass === "ok" && /text\/html/i.test(res.contentType) && !endpoint.html) {
    observations.push({ case: where, note: `API returned text/html with ${res.status}; error pages can leak internals` });
  }
  observations.push({ case: where, status: res.status, class: klass, ms: res.ms });
}

async function checkReachability() {
  try {
    const res = await fetch(base, { signal: AbortSignal.timeout(requestTimeout), redirect: "manual" });
    return { reachable: true, status: res.status };
  } catch (err) {
    return { reachable: false, why: String(err.message ?? err) };
  }
}

const reach = await checkReachability();
if (!reach.reachable) {
  console.log(paint.yellow(`NOT_VERIFIED: ${base} is not reachable (${reach.why})`));
  console.log(`human command: start the production build, then: node pipeline/tools/fuzz-api.mjs --contract ${contractPath} --base ${base}`);
  process.exit(3);
}

for (const endpoint of contract.endpoints) {
  for (const c of casesFor(endpoint)) {
    const res = await send(endpoint, c);
    judge(endpoint, c, res);
  }
}

const byRule = {};
for (const v of violations) byRule[v.rule] = (byRule[v.rule] ?? 0) + 1;

const report = {
  tool: "pipeline-fuzz",
  contract: contractPath,
  baseUrl: base,
  endpoints: contract.endpoints.length,
  cases: contract.endpoints.reduce((n, e) => n + casesFor(e).length, 0),
  violations,
  byRule,
  observations,
  skipped,
  result: violations.length ? "VIOLATIONS" : skipped.length ? "NOT_VERIFIED" : "CLEAN",
  at: new Date().toISOString(),
};

const out = String(flags.out ?? "docs/08-redteam/run-1/floor/fuzz.json");
writeJson(out, report);

if (flags.leads) {
  const leads = violations.map((v) => ({
    tool: "pipeline-fuzz",
    rule: v.rule,
    file: contractPath,
    line: 0,
    text: `${v.case}: ${v.detail}`,
    severity: v.severity,
  }));
  const existing = fs.existsSync(String(flags.leads)) ? readJson(String(flags.leads)) : { leads: [] };
  const merged = Array.isArray(existing) ? existing : existing.leads ?? [];
  writeJson(String(flags.leads), { leads: [...merged, ...leads] });
  console.log(`leads: ${leads.length} appended to ${flags.leads}`);
}

console.log(`${report.cases} cases across ${report.endpoints} endpoint(s) against ${base}`);
for (const [rule, n] of Object.entries(byRule)) console.log(`  ${paint.yellow(rule)} × ${n}`);
for (const v of violations.slice(0, 10)) console.log(`  - [${v.severity}] ${v.case}: ${v.detail}`);
if (violations.length > 10) console.log(`  … ${violations.length - 10} more in ${out}`);
if (violations.length) {
  warn(`${violations.length} violation(s). These are LEADS for a hunter, not findings: confirm before recording.`);
  if (skipped.length) console.log(paint.yellow(`note: ${skipped.length} case(s) were skipped, so coverage is partial`));
  console.log("RESULT: VIOLATIONS");
  process.exit(1);
}

// Every endpoint that needs a credential we do not have was skipped, and a run that
// skipped everything used to print RESULT: CLEAN — the worst possible false green.
if (skipped.length) {
  const envs = [...new Set(skipped.map((x) => (x.why.match(/^([A-Z0-9_]+) is not set/) ?? [])[1]).filter(Boolean))];
  console.log(paint.yellow(`RESULT: NOT_VERIFIED — ${skipped.length} of ${report.cases} case(s) were skipped, so "no violations" is not a finding`));
  for (const env of envs) console.log(`  unset: ${env}`);
  for (const x of skipped.slice(0, 5)) console.log(`  skipped: ${x.case} (${x.why})`);
  const exports = envs.length ? envs.map((e) => `${e}=<token>`).join(" ") : "<see the skipped cases above>";
  console.log(`human command: ${exports} node pipeline/tools/fuzz-api.mjs --contract ${contractPath} --base ${base}`);
  process.exit(3);
}

ok(`RESULT: CLEAN — every case in the contract was executed and none violated the rejection rules`);
