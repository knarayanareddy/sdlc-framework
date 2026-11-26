#!/usr/bin/env node
// findings.json validator + evidence-tier enforcement (v2-08 §8.4′).
// The skill's schema is unchanged; this adds the tiers as a sidecar check.
//
//   node pipeline/tools/validate-findings.mjs docs/08-redteam/run-1/findings.json [--json]
//
// Rules:
//   confirmed + T1 → a test file must exist, contain `@finding <id>`, and contain a real
//                    assertion AFTER the tag (comments are stripped first, so a comment that
//                    mentions expect(...) is not an assertion)
//   confirmed + T2 → iterations >= 20 and 0 < failureRate <= 1 (0 means the attack never worked,
//                    which is not a confirmed finding)
//   confirmed + T3 → >= 3 controls checked AND >= 2 verifiers from DISTINCT, KNOWN families
//                    AND severity <= medium
//   rejected       → a written disproof (so future runs can skip it)
//   needs_validation → exactly one named missing fact
import fs from "node:fs";
import path from "node:path";
import { parseArgs, readJson, fail } from "./lib/common.mjs";
import { familyOf } from "./lib/families.mjs";

const { flags, positional } = parseArgs();
const file = positional[0] ?? "docs/08-redteam/run-1/findings.json";
const asJson = Boolean(flags.json);

if (!fs.existsSync(file)) fail(`no findings file at ${file}`);
let doc;
try {
  doc = readJson(file);
} catch (err) {
  fail(err.message);
}

const SEVERITIES = ["critical", "high", "medium", "low", "info"];
const TIERS = ["T1", "T2", "T3"];
const STATUSES = ["confirmed", "needs_validation", "rejected"];
const SEV_RANK = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

const problems = [];

// A test "has an assertion" only if a call appears outside comments. `// expect(x).toBe(y)` and
// a commented-out assertion used to satisfy the T1 gate.
function stripComments(text) {
  return String(text)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:\\])\/\/[^\n]*/g, "$1");
}
const ASSERTION = /\b(expect\s*\(|assert(?:\.\w+)?\s*\()/;
const list = Array.isArray(doc) ? doc : doc.findings;
if (!Array.isArray(list)) fail("findings file must be an array or an object with a findings array");
if (!doc.mode || !["FULL", "DIFF"].includes(doc.mode)) problems.push(`mode must be FULL or DIFF (found ${JSON.stringify(doc.mode)})`);
// A DIFF run is legitimate as supplementary evidence. What it may not do is claim the
// codebase is clean, which is what this now checks, instead of failing every DIFF run.
const claimsClean = doc.result === "clean" || doc.claimsClean === true || doc.clean === true;
if (doc.mode === "DIFF" && claimsClean) {
  problems.push("a DIFF run cannot claim the codebase is clean: mark it supplementary (it covers changed code only)");
}

const seen = new Set();
for (const f of list) {
  const id = f.id ?? "(no id)";
  if (!f.id) problems.push("a finding has no id");
  else if (seen.has(f.id)) problems.push(`${id}: duplicate id`);
  seen.add(f.id);

  if (!f.title || String(f.title).trim().length < 8) problems.push(`${id}: title missing or too short`);
  if (!SEVERITIES.includes(String(f.severity).toLowerCase())) problems.push(`${id}: severity must be one of ${SEVERITIES.join(", ")}`);
  if (!STATUSES.includes(f.status)) problems.push(`${id}: status must be one of ${STATUSES.join(", ")}`);
  if (!f.location || !String(f.location).includes(":")) problems.push(`${id}: location must cite file:line`);

  if (f.status === "confirmed") {
    if (!TIERS.includes(f.evidenceTier)) {
      problems.push(`${id}: confirmed without an evidenceTier (${TIERS.join("/")})`);
      continue;
    }
    if (f.evidenceTier === "T1") {
      if (!f.test) problems.push(`${id}: T1 requires a reproduction test path`);
      else if (!fs.existsSync(f.test)) problems.push(`${id}: T1 test file does not exist: ${f.test}`);
      else {
        // The tag lives in a comment, so find it in the raw text and only strip comments from
        // what follows it. Stripping first deleted the tag along with its comment line.
        const raw = fs.readFileSync(f.test, "utf8");
        const tag = `@finding ${f.id}`;
        const at = raw.indexOf(tag);
        if (at < 0) problems.push(`${id}: T1 test is not tagged with "${tag}"`);
        else {
          const lineEnd = raw.indexOf("\n", at);
          const afterTag = stripComments(raw.slice(lineEnd < 0 ? raw.length : lineEnd + 1));
          if (!ASSERTION.test(afterTag)) problems.push(`${id}: T1 test has no assertion after the ${tag} tag`);
        }
      }
    }
    if (f.evidenceTier === "T2") {
      if (!(Number(f.iterations) >= 20)) problems.push(`${id}: T2 requires iterations >= 20 (found ${f.iterations})`);
      const rate = Number(f.failureRate);
      if (f.failureRate === undefined) problems.push(`${id}: T2 requires a recorded failureRate`);
      else if (!Number.isFinite(rate) || !(rate > 0) || !(rate <= 1))
        problems.push(`${id}: T2 failureRate must be a number in (0, 1] (found ${JSON.stringify(f.failureRate)}); 0 means the attack never worked`);
    }
    if (f.evidenceTier === "T3") {
      if (!Array.isArray(f.controlsChecked) || f.controlsChecked.length < 3)
        problems.push(`${id}: T3 requires >= 3 controls checked and found absent`);
      if (!Array.isArray(f.verifiers) || f.verifiers.length < 2) problems.push(`${id}: T3 requires >= 2 independent verifiers`);
      else {
        // Counted before: two spellings of the same model were "two verifiers".
        const families = f.verifiers.map((v) => familyOf(v));
        const unknown = f.verifiers.filter((v, i) => families[i] === "unknown");
        if (unknown.length) problems.push(`${id}: T3 verifier(s) with no known family: ${unknown.join(", ")}; independence cannot be shown`);
        const known = [...new Set(families.filter((x) => x !== "unknown"))];
        if (known.length < 2) problems.push(`${id}: T3 requires verifiers from >= 2 distinct families (found ${known.join(", ") || "none"})`);
      }
      if (SEV_RANK[String(f.severity).toLowerCase()] > 2) problems.push(`${id}: T3 caps severity at medium unless reproduced`);
    }
  }

  if (f.status === "rejected" && (!f.disproof || String(f.disproof).trim().length < 10))
    problems.push(`${id}: rejected without a written disproof (future runs will re-report it)`);
  if (f.status === "needs_validation") {
    const missing = f.missing ?? f.missingFact;
    if (!missing || String(missing).trim().length < 8) problems.push(`${id}: needs_validation must name the single missing fact`);
    if (!f.humanCommand) problems.push(`${id}: needs_validation must give the humanCommand that would settle it`);
  }
}

const summary = {
  ok: problems.length === 0,
  total: list.length,
  confirmed: list.filter((f) => f.status === "confirmed").length,
  needsValidation: list.filter((f) => f.status === "needs_validation").length,
  rejected: list.filter((f) => f.status === "rejected").length,
  byTier: TIERS.reduce((acc, t) => ({ ...acc, [t]: list.filter((f) => f.evidenceTier === t).length }), {}),
  mode: doc.mode ?? null,
  supplementary: doc.mode === "DIFF",
  problems,
};

if (asJson) console.log(JSON.stringify(summary, null, 2));
else {
  console.log(
    `findings: ${summary.total}  confirmed: ${summary.confirmed}  needs_validation: ${summary.needsValidation}  rejected: ${summary.rejected}  tiers: T1=${summary.byTier.T1} T2=${summary.byTier.T2} T3=${summary.byTier.T3}`,
  );
  for (const p of problems) console.log(`PROBLEM ${p}`);
  console.log(problems.length ? "RESULT: FAIL" : "RESULT: PASS");
}
process.exit(problems.length ? 1 : 0);
void path;
