#!/usr/bin/env node
// Derive docs/12-eval/metrics.json from evidence, not from prose (REVIEW-OF-SECOND-OPINION.md
// §7 P5). The example metrics file used to say "a real run fills this from the gate ledger, not
// by hand" — and nothing did. A hand-written metrics file is indistinguishable from a computed
// one unless the computed one says where every number came from, so it does:
// `derivedFrom` names each source and its sha256, and `computed: true` is set by this tool only.
//
//   node metrics-compute.mjs [--progress docs/progress.json] [--ledger docs/gate-ledger.jsonl] \
//        [--findings docs/08-redteam/run-1/findings.json] [--calibration calibration/calibration.json] \
//        [--spec docs/02-spec/SPEC.md] [--out docs/12-eval/metrics.json] [--json]
//
// Exit: 0 written · 3 NOT_VERIFIED (a required source is missing, so no metrics are claimed).
import fs from "node:fs";
import { fail, ok, paint, parseArgs, readJson, sha256, writeJson } from "./lib/common.mjs";

const { flags } = parseArgs();
const progressPath = String(flags.progress ?? "docs/progress.json");
const ledgerPath = String(flags.ledger ?? "docs/gate-ledger.jsonl");
const findingsPath = String(flags.findings ?? "docs/08-redteam/run-1/findings.json");
const calibrationPath = String(flags.calibration ?? "calibration/calibration.json");
const specPath = String(flags.spec ?? "docs/02-spec/Spec.md");
const specCandidate = fs.existsSync(specPath) ? specPath : String(flags.spec ?? "docs/02-spec/SPEC.md");
const out = String(flags.out ?? "docs/12-eval/metrics.json");
const asJson = Boolean(flags.json);

function notVerified(reason, human) {
  console.log(paint.yellow(`NOT_VERIFIED: ${reason}`));
  console.log(`human command: ${human}`);
  process.exit(3);
}

// Metrics without a ledger are a story. This is the one source that cannot be faked by writing
// a file, because `gate-ledger verify` already checks its chain.
if (!fs.existsSync(ledgerPath)) notVerified(`no gate ledger at ${ledgerPath}`, `node pipeline/bin/pipeline.mjs init && node pipeline/bin/pipeline.mjs gate G0 --builtin ledger`);
if (!fs.existsSync(progressPath)) notVerified(`no progress file at ${progressPath}`, `node pipeline/bin/pipeline.mjs init`);

const ledgerText = fs.readFileSync(ledgerPath, "utf8");
const entries = ledgerText
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
const progress = readJson(progressPath);
const derivedFrom = {
  ledger: { path: ledgerPath, sha256: sha256(ledgerText), entries: entries.length },
  progress: { path: progressPath, sha256: sha256(fs.readFileSync(progressPath, "utf8")) },
};

// Gates: the last entry per gate wins, the same rule `independence.mjs` uses.
const lastByGate = new Map();
for (const e of entries) if (e.gate) lastByGate.set(e.gate, e);
const gateRows = [...lastByGate.values()];
const byStatus = { passed: 0, failed: 0, NOT_VERIFIED: 0 };
for (const g of gateRows) byStatus[g.status] = (byStatus[g.status] ?? 0) + 1;

// Requirements: counted from the spec, not from memory.
let requirements = null;
if (fs.existsSync(specCandidate)) {
  const spec = fs.readFileSync(specCandidate, "utf8");
  requirements = (spec.match(/^###\s+(?:REQ|SEC|NFR)-\d+\b/gm) ?? []).length;
  derivedFrom.spec = { path: specCandidate, sha256: sha256(spec) };
}

// Red team: the findings file is the artifact; rounds come from progress (written by
// `phase done 08/09`), so the round count and the artifact cannot drift apart silently.
let redTeam = null;
if (fs.existsSync(findingsPath)) {
  const doc = readJson(findingsPath);
  const findings = Array.isArray(doc) ? doc : doc.findings ?? [];
  const byTier = { T1: 0, T2: 0, T3: 0 };
  for (const f of findings) if (f.evidenceTier && byTier[f.evidenceTier] !== undefined) byTier[f.evidenceTier]++;
  redTeam = {
    artefact: findingsPath,
    mode: doc.mode ?? null,
    fullRounds: progress.rounds?.full ?? 0,
    diffRounds: progress.rounds?.diff ?? 0,
    confirmed: findings.filter((f) => f.status === "confirmed").length,
    needsValidation: findings.filter((f) => f.status === "needs_validation").length,
    rejected: findings.filter((f) => f.status === "rejected").length,
    byTier,
  };
  derivedFrom.findings = { path: findingsPath, sha256: sha256(fs.readFileSync(findingsPath, "utf8")) };
}

// Calibration: a number from another pipeline version is not a number for this one.
let calibration;
if (fs.existsSync(calibrationPath)) {
  const c = readJson(calibrationPath);
  const stale = c.pipelineVersion !== progress.pipelineVersion;
  calibration = {
    run: true,
    calibrated: Boolean(c.calibrated),
    recall: c.recall ?? null,
    planted: c.planted ?? null,
    requiredHits: c.requiredHits ?? null,
    pipelineVersion: c.pipelineVersion ?? null,
    stale,
    ...(stale ? { reason: `measured on ${c.pipelineVersion}; this run is ${progress.pipelineVersion}` } : {}),
  };
  derivedFrom.calibration = { path: calibrationPath, sha256: sha256(fs.readFileSync(calibrationPath, "utf8")) };
} else {
  calibration = { run: false, reason: `no calibration at ${calibrationPath}` };
}

const phases = Object.fromEntries(Object.entries(progress.phases ?? {}).map(([id, v]) => [id, v.status ?? "unknown"]));
const metrics = {
  computed: true,
  pipelineVersion: progress.pipelineVersion ?? null,
  at: new Date().toISOString(),
  phases,
  phase: progress.phase ?? null,
  gates: { total: gateRows.length, ...byStatus, notVerifiedList: gateRows.filter((g) => g.status === "NOT_VERIFIED").map((g) => g.gate) },
  counts: {
    requirements,
    gates: Object.keys(progress.gates ?? {}).length,
    notVerified: Object.values(progress.gates ?? {}).filter((g) => g.status === "NOT_VERIFIED").length,
    blockers: (progress.blockers ?? []).length,
    ledgerEntries: entries.length,
  },
  redTeam,
  calibration,
  derivedFrom,
};

if (asJson) {
  console.log(JSON.stringify(metrics, null, 2));
} else {
  writeJson(out, metrics);
  console.log(`metrics: ${out}`);
  console.log(`  gates: ${byStatus.passed} passed, ${byStatus.failed} failed, ${byStatus.NOT_VERIFIED} NOT_VERIFIED (of ${gateRows.length} recorded)`);
  console.log(`  red team: ${redTeam ? `${redTeam.confirmed} confirmed, ${redTeam.fullRounds} FULL / ${redTeam.diffRounds} DIFF round(s)` : "no findings file"}`);
  console.log(`  calibration: ${calibration.run ? (calibration.calibrated ? `calibrated on ${calibration.pipelineVersion}` : `inconclusive on ${calibration.pipelineVersion}`) : calibration.reason}`);
  console.log(`  derived from: ${Object.keys(derivedFrom).join(", ")}`);
  ok("RESULT: PASS — every number above was computed from a named file");
}
