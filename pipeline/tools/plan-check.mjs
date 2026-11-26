#!/usr/bin/env node
// Plan substance check (REVIEW-OF-SECOND-OPINION.md §7 P4).
//
// A gate can be green while the plan does not hold together: the spec lists security
// requirements the threat model never mentions, routes the authorization matrix never covers,
// and requirements no slice ever delivers. None of that is traceability — trace-check asks
// "does a test exist", this asks "is the plan itself complete".
//
//   node plan-check.mjs [--spec docs/02-spec/SPEC.md] \
//        [--threat-model docs/04-architecture/threat-model.md] \
//        [--authz-matrix docs/04-architecture/authz-matrix.md] \
//        [--slices "docs/06-build/slice-*.md"] [--entrypoints docs/08-redteam/run-1/entrypoints.json] \
//        [--require threat,authz,slices] [--json]
//
// Checks
//   threat  every SEC-* in the spec appears in the threat model
//   authz   every route/action the app exposes appears in the authorization matrix
//   slices  every REQ-*/SEC-*/NFR-* in the spec appears in at least one slice log
//
// Exit: 0 all required checks hold · 1 a required check failed ·
//       3 NOT_VERIFIED (a required input is missing, so the check could not run).
// A check that was not required is reported, never silently dropped.
import fs from "node:fs";
import path from "node:path";
import { fail, ok, paint, parseArgs, readJson, sha256 } from "./lib/common.mjs";

const { flags } = parseArgs();
const specPath = String(flags.spec ?? "docs/02-spec/SPEC.md");
const threatPath = String(flags["threat-model"] ?? "docs/04-architecture/threat-model.md");
const authzPath = String(flags["authz-matrix"] ?? "docs/04-architecture/authz-matrix.md");
const slicesGlob = String(flags.slices ?? "docs/06-build/slice-*.md");
const entrypointsPath = flags.entrypoints !== undefined ? String(flags.entrypoints) : "docs/08-redteam/run-1/entrypoints.json";
// G4 (architecture) can judge the threat model and the matrix; slices do not exist until
// phase 06, so requiring them at G4 would make that gate permanently red.
const require = String(flags.require ?? "threat,authz")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const asJson = Boolean(flags.json);

const ID = /\b(REQ|SEC|NFR)-\d+\b/g;
const idsOf = (text, kinds = ["REQ", "SEC", "NFR"]) => new Set((String(text).match(ID) ?? []).filter((id) => kinds.includes(id.split("-")[0])));

function sliceFiles(pattern) {
  // One level of `*` is enough for `docs/06-build/slice-*.md`; anything fancier belongs in a
  // dedicated globber and this tool has no dependencies.
  const dir = path.dirname(pattern);
  const base = path.basename(pattern);
  if (!fs.existsSync(dir)) return [];
  const re = new RegExp(`^${base.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*")}$`);
  return fs
    .readdirSync(dir)
    .filter((f) => re.test(f))
    .sort()
    .map((f) => path.join(dir, f));
}

// Routes and actions the app exposes. The enumerator's output is the ground truth once the
// code exists; before that (G4), the spec's API contract table is what the architect has.
function exposedFromEntrypoints(file) {
  if (!fs.existsSync(file)) return null;
  const doc = readJson(file);
  const list = Array.isArray(doc) ? doc : doc.entrypoints ?? [];
  return list
    .filter((e) => e.kind === "route" || e.kind === "action")
    .map((e) => ({ id: e.id, label: String(e.id).replace(/^(route|action):/, "").trim(), source: e.file ?? null }));
}

const API_ROW = /^\|\s*(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*\|\s*([^|]+?)\s*\|/gm;
function exposedFromSpec(spec) {
  const rows = [...String(spec).matchAll(API_ROW)].map((m) => ({ id: `route:${m[1]} ${m[2].trim()}`, label: `${m[1]} ${m[2].trim()}`, source: "spec §API contract" }));
  return rows.length ? rows : null;
}

const checks = [];
const problems = [];
const notVerified = [];

if (!fs.existsSync(specPath)) {
  console.log(paint.yellow(`NOT_VERIFIED: no spec at ${specPath}`));
  console.log(`human command: node pipeline/tools/plan-check.mjs --spec docs/02-spec/SPEC.md   # after phase 02`);
  process.exit(3);
}
const spec = fs.readFileSync(specPath, "utf8");

// ---- threat: every SEC id is in the threat model ---------------------------------------
if (require.includes("threat")) {
  const secIds = [...idsOf(spec, ["SEC"])];
  if (!secIds.length) {
    checks.push({ check: "threat", state: "SKIPPED", detail: "the spec has no SEC-* requirement to threat-model" });
  } else if (!fs.existsSync(threatPath)) {
    notVerified.push({ check: "threat", detail: `no threat model at ${threatPath}`, human: `write ${threatPath} with a row per SEC id (${secIds.join(", ")})` });
    checks.push({ check: "threat", state: "NOT_VERIFIED", detail: `no threat model at ${threatPath}` });
  } else {
    const threat = fs.readFileSync(threatPath, "utf8");
    const referenced = idsOf(threat, ["SEC"]);
    const missing = secIds.filter((id) => !referenced.has(id));
    checks.push({ check: "threat", state: missing.length ? "FAIL" : "PASS", detail: missing.length ? `not in ${threatPath}: ${missing.join(", ")}` : `${secIds.length}/${secIds.length} SEC ids modelled` });
    for (const id of missing) problems.push(`threat: ${id} is in the spec but not in ${threatPath}`);
  }
} else {
  checks.push({ check: "threat", state: "NOT_REQUIRED" });
}

// ---- authz: every exposed route/action is in the matrix --------------------------------
if (require.includes("authz")) {
  const fromEntries = exposedFromEntrypoints(entrypointsPath);
  const exposed = fromEntries ?? exposedFromSpec(spec);
  if (!exposed) {
    notVerified.push({ check: "authz", detail: "no entrypoints.json and no API contract table to take routes from", human: `node pipeline/tools/plan-check.mjs --entrypoints <entrypoints.json>, or add the §API contract table to ${specPath}` });
    checks.push({ check: "authz", state: "NOT_VERIFIED", detail: "no source of routes/actions" });
  } else if (!fs.existsSync(authzPath)) {
    notVerified.push({ check: "authz", detail: `no authorization matrix at ${authzPath}`, human: `write ${authzPath} with a row per route (${exposed.map((e) => e.label).join(", ")})` });
    checks.push({ check: "authz", state: "NOT_VERIFIED", detail: `no authorization matrix at ${authzPath}` });
  } else {
    const matrix = fs.readFileSync(authzPath, "utf8");
    const unknown = exposed.filter((e) => !matrix.includes(e.label));
    checks.push({ check: "authz", state: unknown.length ? "FAIL" : "PASS", detail: unknown.length ? `not in ${authzPath}: ${unknown.map((e) => e.label).join(", ")}` : `${exposed.length}/${exposed.length} routes covered` });
    for (const e of unknown) problems.push(`authz: ${e.id} (${e.source ?? "spec"}) is exposed but absent from ${authzPath}`);
  }
} else {
  checks.push({ check: "authz", state: "NOT_REQUIRED" });
}

// ---- slices: every requirement is delivered by some slice ------------------------------
if (require.includes("slices")) {
  const files = sliceFiles(slicesGlob);
  const allIds = [...idsOf(spec)];
  if (!files.length) {
    notVerified.push({ check: "slices", detail: `no slice logs matching ${slicesGlob}`, human: `write a slice log per delivery slice (${slicesGlob}) before phase 06 is done` });
    checks.push({ check: "slices", state: "NOT_VERIFIED", detail: `no slice logs matching ${slicesGlob}` });
  } else {
    const covered = new Set();
    for (const f of files) for (const id of idsOf(fs.readFileSync(f, "utf8"))) covered.add(id);
    const missing = allIds.filter((id) => !covered.has(id));
    checks.push({ check: "slices", state: missing.length ? "FAIL" : "PASS", detail: missing.length ? `no slice delivers: ${missing.join(", ")}` : `${allIds.length}/${allIds.length} ids delivered across ${files.length} slice(s)` });
    for (const id of missing) problems.push(`slices: ${id} is in the spec but no slice log delivers it`);
    // A slice that delivers nothing traceable is a log entry pretending to be work.
    for (const f of files) {
      const ids = [...idsOf(fs.readFileSync(f, "utf8"))];
      if (!ids.length) problems.push(`slices: ${f} references no REQ/SEC/NFR id, so it does not say what it delivered`);
    }
  }
} else {
  checks.push({ check: "slices", state: "NOT_REQUIRED" });
}

const result = {
  spec: specPath,
  specSha256: sha256(spec),
  threatModel: fs.existsSync(threatPath) ? threatPath : null,
  authzMatrix: fs.existsSync(authzPath) ? authzPath : null,
  require,
  checks,
  problems,
  notVerified: notVerified.map((n) => n.check),
  result: problems.length ? "FAIL" : notVerified.length ? "NOT_VERIFIED" : "PASS",
};

if (asJson) console.log(JSON.stringify(result, null, 2));
else {
  for (const c of checks) {
    const mark = c.state === "PASS" ? paint.green("ok  ") : c.state === "FAIL" ? paint.red("FAIL") : c.state === "NOT_VERIFIED" ? paint.yellow("??  ") : paint.dim("--  ");
    console.log(`  ${mark} ${c.check.padEnd(7)} ${c.detail ?? c.state}`);
  }
  for (const p of problems) console.log(`PROBLEM ${p}`);
}

if (problems.length) {
  console.log("RESULT: FAIL");
  process.exit(1);
}
if (notVerified.length) {
  const labels = notVerified.map((n) => n.check);
  for (const n of notVerified) console.log(`human command: ${n.human}`);
  const missingInputs = notVerified.every((n) => /no slice logs/.test(n.detail));
  console.log(
    paint.yellow(
      `RESULT: NOT_VERIFIED — ${labels.join(", ")} could not be checked${missingInputs ? " (slice logs arrive in phase 06)" : ""}; the report must say so`,
    ),
  );
  process.exit(3);
}
ok("RESULT: PASS — threat model, authorization matrix and slices agree with the spec");
