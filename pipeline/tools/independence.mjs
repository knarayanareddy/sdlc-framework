#!/usr/bin/env node
// Independence gate (R-09/R-16): a second opinion from the same model family is not a
// second opinion. This reads what the ledger actually recorded and refuses to call a run
// independent unless every gate that needs a verifier has one from another family.
//
//   node pipeline/tools/independence.mjs --ledger docs/gate-ledger.jsonl [--json]
//   node pipeline/tools/independence.mjs --ledger … --builder-family anthropic --require G7,G9
//
// Exit: 0 independent · 1 a same-family verifier was used (a real failure) ·
//       3 NOT_VERIFIED (no verifier recorded, or the family is unknown).
import fs from "node:fs";
import { fail, paint, parseArgs, readJson, writeJson } from "./lib/common.mjs";
import { familyOf, mergeFamilies } from "./lib/families.mjs";

const { flags } = parseArgs();
const ledgerPath = String(flags.ledger ?? "docs/gate-ledger.jsonl");
const configPath = String(flags.config ?? "pipeline.config.json");

if (!fs.existsSync(ledgerPath)) {
  console.log(paint.yellow(`NOT_VERIFIED: no ledger at ${ledgerPath}`));
  console.log(`human command: node pipeline/bin/pipeline.mjs init && node pipeline/bin/pipeline.mjs gate G0 --builtin ledger`);
  process.exit(3);
}

const userConfig = fs.existsSync(configPath) ? readJson(configPath) : {};
const indepCfg = userConfig.independence ?? {};
const table = mergeFamilies(flags.families ?? indepCfg.families, (f) => readJson(f));
const builderFamily = String(flags["builder-family"] ?? indepCfg.builderFamily ?? process.env.PIPELINE_BUILDER_FAMILY ?? "unknown");
const requireFor = String(flags.require ?? (indepCfg.requireFor ?? ["G3", "G4", "G7", "G9", "G10", "G11", "G12"]).join(","))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Last entry per gate wins: the ledger is chronological and verify appends.
const entries = fs
  .readFileSync(ledgerPath, "utf8")
  .split("\n")
  .filter((l) => l.trim())
  .map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  })
  .filter(Boolean);

const lastByGate = new Map();
for (const e of entries) lastByGate.set(e.gate, e);

// `modelFamily` holds whatever `gate --model` was given: a model id or a family name.
function resolveFamily(value) {
  const v = String(value ?? "").trim();
  if (!v) return { family: "unknown", why: "no verifier model was recorded" };
  if (Object.prototype.hasOwnProperty.call(table, v.toLowerCase())) return { family: v.toLowerCase(), why: "declared family" };
  const f = familyOf(v, table);
  if (f === "unknown") return { family: "unknown", why: `"${v}" matches no known family` };
  return { family: f, why: `model id → ${f}` };
}

const rows = [];
let sameFamily = 0;
let unverified = 0;
let independent = 0;

for (const gate of requireFor) {
  const entry = lastByGate.get(gate);
  if (!entry) {
    rows.push({ gate, state: "NOT_VERIFIED", detail: "no ledger entry for this gate" });
    unverified++;
    continue;
  }
  if (entry.status === "NOT_VERIFIED") {
    // Nothing ran, so there is nothing an independent verifier could have checked. The gate is
    // already in the report's NOT_VERIFIED list; demanding independence for it would be noise.
    rows.push({ gate, state: "NOT_APPLICABLE", detail: "the gate itself is NOT_VERIFIED, so independence does not apply" });
    continue;
  }
  const { family, why } = resolveFamily(entry.modelFamily);
  if (family === "unknown") {
    rows.push({ gate, state: "NOT_VERIFIED", detail: why, recorded: entry.modelFamily ?? null });
    unverified++;
  } else if (builderFamily !== "unknown" && family === builderFamily) {
    rows.push({ gate, state: "SAME_FAMILY", detail: `verifier is "${family}", the same family as the builder`, recorded: entry.modelFamily });
    sameFamily++;
  } else {
    rows.push({ gate, state: "INDEPENDENT", detail: `${family} verified a ${builderFamily} build`, recorded: entry.modelFamily });
    independent++;
  }
}

// Gates outside the required list, reported but not judged.
const others = [...lastByGate.keys()].filter((g) => !requireFor.includes(g));

const result = {
  builderFamily,
  requireFor,
  independent,
  sameFamily,
  notVerified: unverified,
  rows,
  otherGates: others,
  verdict: sameFamily > 0 ? "FAIL" : unverified > 0 ? "NOT_VERIFIED" : "PASS",
  at: new Date().toISOString(),
};

if (flags.out) {
  writeJson(String(flags.out), result);
  console.log(`written: ${flags.out}`);
}

if (flags.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`builder family: ${builderFamily === "unknown" ? paint.yellow("unknown (set independence.builderFamily)") : builderFamily}`);
  for (const r of rows) {
    const mark = r.state === "INDEPENDENT" ? paint.green("ok  ") : r.state === "SAME_FAMILY" ? paint.red("FAIL") : paint.yellow("??  ");
    console.log(`  ${mark} ${r.gate.padEnd(4)} ${r.state.padEnd(12)} ${r.detail}`);
  }
  console.log(`independent: ${independent}  same family: ${sameFamily}  not verified: ${unverified}`);
  if (sameFamily) console.log(paint.red("RESULT: FAIL — at least one gate was verified by the builder's own model family"));
  else if (unverified) console.log(paint.yellow(`NOT_VERIFIED: ${unverified} required gate(s) have no independent verifier on record`));
  else if (unverified) console.log(paint.yellow("RESULT: NOT_VERIFIED — the report must say the verification was not independent"));
  else console.log(paint.green("RESULT: PASS"));
}

if (sameFamily > 0) process.exit(1);
if (unverified > 0) {
  console.log("human command: re-record each gate that lacks a verifier with --model <model id from another family>");
  console.log("               node pipeline/tools/verifier-route.mjs status   # shows what is routable");
  if (flags.strict) fail("independence is required here and it was not established", 3);
  process.exit(3);
}
process.exit(0);
