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


// The builder's family, from whatever the operator supplied: a family name, a model id, or
// the model id the runner already knows (PIPELINE_BUILDER_MODEL). "unknown" is not a value
// to compare against — see the row loop.
function normaliseFamily(value) {
  const v = String(value ?? "").trim();
  if (!v || v === "unknown") return { family: "unknown", source: null };
  if (Object.prototype.hasOwnProperty.call(table, v.toLowerCase())) return { family: v.toLowerCase(), source: "declared family" };
  const f = familyOf(v, table);
  return f === "unknown" ? { family: "unknown", source: null } : { family: f, source: `model id "${v}"` };
}

const declared = normaliseFamily(flags["builder-family"] ?? indepCfg.builderFamily ?? process.env.PIPELINE_BUILDER_FAMILY);
const fromModel = normaliseFamily(flags["builder-model"] ?? indepCfg.builderModel ?? process.env.PIPELINE_BUILDER_MODEL ?? process.env.PIPELINE_BUILDER_MODEL);
const declaredBuilder = declared.family !== "unknown" ? declared : fromModel;

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

// The builder's family is what every "independent of what?" question is measured against, and
// `pipeline.config.json` is a file the builder can edit. It is pinned in the ledger genesis at
// init (B-31); a declaration that disagrees with the pin is the tamper case, and a pin that was
// never written is a claim with nothing behind it.
// The pin is the last ledger entry that names a builder family: the genesis written by
// `pipeline init`, or a later `pipeline attest --builder-family …` by a human. Both are in the
// hash chain, so changing either breaks the record.
const pinEntry = [...entries].reverse().find((e) => e.builderFamily) ?? null;
const pinned = normaliseFamily(pinEntry?.builderFamily);
const pinnedAttestedBy = pinEntry?.builderFamilyAttestedBy ?? null;
const pinnedWhere = pinEntry?.gate === "GENESIS" ? "the ledger genesis" : pinEntry ? `ledger entry ${pinEntry.seq} (${pinEntry.gate})` : "the ledger";
// A flag typed on this command line is someone running the tool by hand, and the output says so.
// A config field or an environment variable is editable by the builder, so it needs a pin.
const declaredOnCommandLine = flags["builder-family"] !== undefined || flags["builder-model"] !== undefined;

if (pinned.family !== "unknown" && declaredBuilder.family !== "unknown" && pinned.family !== declaredBuilder.family) {
  console.log(paint.red(`builder family: the ledger pins "${pinned.family}" at init, the declaration says "${declaredBuilder.family}"`));
  console.log("RESULT: FAIL — the record and the declaration disagree, so neither can be used to judge independence");
  console.log(`human command: node pipeline/tools/independence.mjs --ledger ${ledgerPath}   # after restoring pipeline.config.json from the base commit`);
  process.exit(1);
}

let builderFamily;
let builderFamilySource;
if (pinned.family !== "unknown") {
  builderFamily = pinned.family;
  builderFamilySource = `pinned in ${pinnedWhere}${pinnedAttestedBy ? `, attested by ${pinnedAttestedBy}` : " (no human attested it)"}`;
} else if (declaredBuilder.family !== "unknown" && declaredOnCommandLine) {
  builderFamily = declaredBuilder.family;
  builderFamilySource = "declared on the command line (not pinned in the ledger)";
} else if (declaredBuilder.family !== "unknown") {
  // A config field or an environment variable can be set by the builder at any time, so it is
  // not a fact about who built the software. It has to be pinned, and a human can pin it without
  // re-initialising: `pipeline attest` appends the claim to the hash chain (B-31).
  console.log(paint.yellow(`NOT_VERIFIED: the builder family ("${declaredBuilder.family}") is declared in configuration or the environment, not pinned in the ledger`));
  console.log(`human command: PIPELINE_HUMAN=1 node pipeline/bin/pipeline.mjs attest --builder-family ${declaredBuilder.family} --attested-by "<your name>"`);
  console.log("  the pin is a hash-chained ledger entry, so a family cannot be changed afterwards without breaking the record");
  process.exit(3);
} else {
  builderFamily = "unknown";
  builderFamilySource = null;
}

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
  if (builderFamily === "unknown") {
    // This is the fail-open (F-02): with the builder's family unknown, every recorded verifier
    // family counted as INDEPENDENT — "openai verified a unknown build", printed green. A
    // comparison against nothing is not independence.
    rows.push({
      gate,
      state: "NOT_VERIFIED",
      detail: "the builder's own family is unknown, so nothing can be shown to be independent of it",
      recorded: entry.modelFamily ?? null,
    });
    unverified++;
    continue;
  }
  const { family, why } = resolveFamily(entry.modelFamily);
  if (family === "unknown") {
    rows.push({ gate, state: "NOT_VERIFIED", detail: why, recorded: entry.modelFamily ?? null });
    unverified++;
  } else if (family === builderFamily) {
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
  builderFamilySource,
  builderFamilyAttestedBy: pinnedAttestedBy,
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
  console.log(`builder family: ${builderFamily === "unknown" ? paint.yellow("unknown — independence cannot be established") : `${builderFamily}${builderFamilySource ? ` (${builderFamilySource})` : ""}`}`);
  for (const r of rows) {
    const mark = r.state === "INDEPENDENT" ? paint.green("ok  ") : r.state === "SAME_FAMILY" ? paint.red("FAIL") : paint.yellow("??  ");
    console.log(`  ${mark} ${r.gate.padEnd(4)} ${r.state.padEnd(12)} ${r.detail}`);
  }
  console.log(`independent: ${independent}  same family: ${sameFamily}  not verified: ${unverified}`);
  if (sameFamily) console.log(paint.red("RESULT: FAIL — at least one gate was verified by the builder's own model family"));
  else if (unverified) console.log(paint.yellow(`RESULT: NOT_VERIFIED — ${unverified} required gate(s) have no independent verifier on record`));
  else console.log(paint.green("RESULT: PASS"));
}

if (sameFamily > 0) process.exit(1);
if (unverified > 0) {
  if (builderFamily === "unknown") {
    // One line, and self-contained: `pipeline gate` records the human command verbatim, so a
    // command split over three lines is recorded as a sentence that cannot be run.
    console.log(`human command: PIPELINE_HUMAN=1 node pipeline/bin/pipeline.mjs attest --builder-family <anthropic|openai|google|…> --attested-by "<your name>"   # pins it in the ledger`);
    if (flags.strict) fail("independence is required here and it was not established", 3);
    process.exit(3);
  }
  console.log("human command: re-record each gate that lacks a verifier with --model <model id from another family>");
  console.log("               node pipeline/tools/verifier-route.mjs status   # shows what is routable");
  if (flags.strict) fail("independence is required here and it was not established", 3);
  process.exit(3);
}
process.exit(0);
