// Single source of truth for every visual in the app.
// Content mirrors content/REVIEW-AND-V2.md. A unit test checks that the finding IDs agree.
// Everything labelled "assessment" is my reading of the prompts, not a measurement.

export type Mode = "v1" | "v2" | "diff";
export type Change = "same" | "changed" | "new";

export interface Station {
  id: string; // "01", "H1", ...
  label: string;
  x: number;
  y: number;
  minor?: boolean;
  labelPos: "above" | "below";
  change: Change; // relative to v1
  v1?: { does: string; outputs: string };
  v2: { does: string; adds: string[]; refs: string[] };
}

export interface GateNode {
  id: string; // "G5"
  x: number;
  y: number;
  inV1: boolean;
  v1Check?: string;
  v2Check: string;
  v2Change: Change;
}

export const STATIONS: Station[] = [
  {
    id: "00", label: "Guardrails", x: 70, y: 260, labelPos: "below", change: "new",
    v2: {
      does: "Secures the pipeline itself before any agent reads the web or runs code.",
      adds: [
        "Pipeline threat model: web text steering a tool-holding agent, install scripts, secret exposure, tampering with tests or gates",
        "Per-phase sandbox profile: network, env allowlist, writable paths, caps",
        "Protected paths + hash-chained gate ledger written only by the orchestrator",
        "Budgets and a kill switch",
      ],
      refs: ["R-02", "R-04"],
    },
  },
  {
    id: "01", label: "Research", x: 180, y: 260, labelPos: "below", change: "changed",
    v1: {
      does: "Intake, scours seven source classes, builds an evidence ledger, ranks ideas, writes the thesis and red-teams the idea.",
      outputs: "assumptions.md, evidence-ledger.md, landscape.md, jtbd.md, ideas-ranked.md, thesis.md",
    },
    v2: {
      does: "Same research scope, split so untrusted pages can't steer an agent and quotes are checked by script.",
      adds: [
        "Reader agent: web tools, no shell, no file write, JSON-only output",
        "Snapshots stored; quote-verify checks each quote is a substring of the page",
        "G1 counts only verified quotes; not-found rate reported",
      ],
      refs: ["R-04", "R-05"],
    },
  },
  {
    id: "02", label: "Spec", x: 290, y: 260, labelPos: "below", change: "changed",
    v1: {
      does: "SPEC.md with REQ/SEC/NFR IDs, EARS statements, Given/When/Then, information-flow table, authz matrix, slices.",
      outputs: "SPEC.md, slices.md",
    },
    v2: {
      does: "Same spec. The traceability tool is replaced and the freeze is enforced after design and architecture.",
      adds: ["trace-check-v2 replaces trace-check (tag line + real assertion + no skips)", "Weasel-word lint widened from 6 to 11 terms"],
      refs: ["R-01", "R-15"],
    },
  },
  {
    id: "H1", label: "Digest", x: 385, y: 260, minor: true, labelPos: "above", change: "new",
    v2: {
      does: "One-page Decision Digest: thesis, top 5 assumptions, scope in/out. Never blocks the run.",
      adds: ["Marked unreviewed unless a human answers", "Unreviewed decisions are listed in the final report"],
      refs: ["R-13"],
    },
  },
  {
    id: "03", label: "Design + UX", x: 520, y: 170, labelPos: "above", change: "changed",
    v1: {
      does: "Design brief, three divergent directions, signature element, tokens, copy voice, states, UX heuristics review. Banned-defaults list.",
      outputs: "design-brief.md, directions.md, tokens.json, ia-and-flows.md, states.md, ux-review.md",
    },
    v2: {
      does: "Same design work, plus a rendered prototype before the spec is frozen.",
      adds: [
        "Design spike: signature element + empty + error state rendered with real data, screenshot at 360 and 1280",
        "Token lint: no colour or spacing in code that isn't in tokens.json",
        "G3 reviewer from a different model family",
      ],
      refs: ["R-06", "R-12"],
    },
  },
  {
    id: "04", label: "Architecture + Threat model", x: 520, y: 350, labelPos: "below", change: "same",
    v1: {
      does: "Trust-boundary diagram, ADRs, STRIDE per entry point, authz matrix, numeric limits, dependency vetting, headers, logging.",
      outputs: "architecture.md, threat-model.md, authz-matrix.md, dependency-vetting.md",
    },
    v2: {
      does: "Unchanged, with one addition: the install allowlist feeds guardrails.",
      adds: ["Packages needing install scripts get an explicit allowlist entry"],
      refs: ["R-04"],
    },
  },
  {
    id: "FZ", label: "Freeze", x: 700, y: 260, minor: true, labelPos: "above", change: "new",
    v2: {
      does: "Hash the spec after G2, G3 and G4. Later edits need a CHANGES.md entry listing the tests they affect.",
      adds: ["Baseline hash makes silent spec drift visible"],
      refs: ["R-12"],
    },
  },
  {
    id: "05", label: "Test strategy", x: 765, y: 260, labelPos: "below", change: "changed",
    v1: {
      does: "Installs the test stack, writes failing tests from Given/When/Then, tags tests with requirement IDs, builds the walking skeleton.",
      outputs: "test-plan.md, red-baseline.log, flow-matrix.md, CI config",
    },
    v2: {
      does: "Same layers. The red baseline becomes a frozen, checkable baseline.",
      adds: ["trace-check-v2 --baseline snapshots assertions per test file", "Every later gate runs --check-baseline: deletions, lost assertions and new skips fail"],
      refs: ["R-01", "R-02"],
    },
  },
  {
    id: "06", label: "Build slices", x: 880, y: 260, labelPos: "below", change: "changed",
    v1: {
      does: "Red → green → refactor per vertical slice. Builder self-reviews the diff through a sharp-edges lens. Max 3 repair loops.",
      outputs: "code, slice-NN.md, blockers.md",
    },
    v2: {
      does: "Same loop plus a deterministic tripwire and, on boundary slices, a fresh reviewer.",
      adds: [
        "Tripwire: tsc, lint, build, SAST, gitleaks, osv, trace baseline, incremental mutation on changed files",
        "Fresh differential review when a slice touches auth, a data boundary, a route or a dependency",
      ],
      refs: ["R-11"],
    },
  },
  {
    id: "07", label: "QA sweep", x: 1000, y: 260, labelPos: "below", change: "changed",
    v1: {
      does: "Fresh agent: clean-room run, 3× flake check, spec-to-code compliance, canary matrix, exploratory charters, a11y, perf, mutation, static checks.",
      outputs: "qa-report.md, defects.md, compliance.md",
    },
    v2: {
      does: "Same sweep, with dynamic scanners made part of the floor and a cross-model reviewer.",
      adds: ["DAST baseline against the sandboxed production build", "Schema-driven API fuzzing", "Different model family where available"],
      refs: ["R-06", "R-07"],
    },
  },
  {
    id: "08", label: "Red team", x: 1120, y: 260, labelPos: "below", change: "changed",
    v1: {
      does: "Cloudflare 6 phases + Trail of Bits spec-to-code, sharp-edges, variant-analysis. Hunters, critics, verifiers, repro tests, validated findings.json.",
      outputs: "coverage-ledger.json, findings.json, REPORT.md, tests/security/*",
    },
    v2: {
      does: "Same method on top of a deterministic floor, with measured coverage and honest evidence labels.",
      adds: [
        "Floor: Semgrep/CodeQL, osv, gitleaks, ZAP/Nuclei, Schemathesis, entry-point enumerator",
        "Coverage gate by script: enumerated entry points ⊆ ledger",
        "Evidence tiers T1 executed · T2 bounded stress · T3 static proof",
        "Cross-model verifiers, capture–recapture estimate, FULL vs DIFF labelling",
      ],
      refs: ["R-03", "R-06", "R-07", "R-08", "R-09"],
    },
  },
  {
    id: "09", label: "Patch + validate", x: 1240, y: 260, labelPos: "below", change: "changed",
    v1: {
      does: "Fresh agent fixes root causes, runs variant analysis, post-patch validation in a fresh sub-agent, differential review. Loop ≤3.",
      outputs: "patches, patch-report-roundN.md, tests/security/*",
    },
    v2: {
      does: "Same, with rounds redefined so the stop rule can't be met by a diff-only pass.",
      adds: ["Round 2 is a FULL run on a different partition", "A fix must survive mutation of the fix itself"],
      refs: ["R-03"],
    },
  },
  {
    id: "10", label: "Release ready", x: 1360, y: 260, labelPos: "below", change: "same",
    v1: {
      does: "typegen, tsc, build, health check, clean-room install, 3 green runs, SBOM, secret scan, runbook, FINAL-REPORT with NOT_VERIFIED list.",
      outputs: "FINAL-REPORT.md, README.md, .env.example, RUNBOOK.md",
    },
    v2: { does: "Unchanged. It is already one of the strongest phases.", adds: [], refs: [] },
  },
  {
    id: "11", label: "Deploy + verify", x: 1470, y: 260, labelPos: "below", change: "new",
    v2: {
      does: "Prove the deployed artifact is the tested artifact, and that rollback and alerts actually work.",
      adds: [
        "Build id on the deployed host equals the tested commit",
        "Migrations against a copy of representative data",
        "Rollback drill, alert fired on purpose, headers checked on the real origin",
      ],
      refs: ["R-14"],
    },
  },
  {
    id: "12", label: "Pipeline eval", x: 1580, y: 260, labelPos: "below", change: "new",
    v2: {
      does: "Measure the pipeline. Plant known bugs on a throwaway branch and score the red team's recall.",
      adds: [
        "Raw metrics from the gate ledger: late catches, false-pass candidates, loops",
        "Planted-bug calibration once per pipeline version; recall < 0.7 means 'red team inconclusive'",
        "Prompt changes need linked evidence",
      ],
      refs: ["R-10", "R-14"],
    },
  },
];

export const GATES: GateNode[] = [
  { id: "G0", x: 125, y: 260, inV1: false, v2Change: "new", v2Check: "Threat model complete; research agents have no shell; tamper test on the ledger fails as it should." },
  { id: "G1", x: 235, y: 260, inV1: true, v2Change: "changed", v1Check: "≥5 competitors, ≥10 quotes with links, thesis claims cite evidence, ≥3 rejected ideas.", v2Check: "Same counts, but only quote-verified rows count; not-found rate reported." },
  { id: "G2", x: 337, y: 260, inV1: true, v2Change: "changed", v1Check: "trace-check structure passes; a fresh reviewer can't find an untestable requirement.", v2Check: "trace-check-v2 structure passes (richer weasel lint); reviewer test-writing pass; Digest emitted." },
  { id: "G3", x: 590, y: 170, inV1: true, v2Change: "changed", v1Check: "Fresh reviewer finds 0 unjustified banned defaults; contrast table passes; every flow has all states.", v2Check: "Same, plus a rendered spike and a reviewer from another model family." },
  { id: "G4", x: 590, y: 350, inV1: true, v2Change: "same", v1Check: "Every entry point has an abuse case; every threat maps to a SEC id; no blank authz cells; numeric limits.", v2Check: "Unchanged." },
  { id: "G5", x: 822, y: 260, inV1: true, v2Change: "changed", v1Check: "trace-check lists 0 requirements without a planned test; red baseline recorded; walking skeleton green.", v2Check: "trace-check-v2: every requirement has a tagged test with a real assertion; baseline frozen." },
  { id: "G7", x: 1060, y: 260, inV1: true, v2Change: "changed", v1Check: "Clean-room run, 0 flaky, 0 unexplained divergences, flow matrix green, a11y and perf budgets, mutation threshold.", v2Check: "Same, plus DAST and fuzz results and a baseline check." },
  { id: "G9", x: 1300, y: 260, inV1: true, v2Change: "changed", v1Check: "0 confirmed findings after the latest round; each fix has a fail-before / pass-after test.", v2Check: "Same, but 'latest round' must be FULL, expected remaining ≤ 1, fixes survive mutation." },
  { id: "G10", x: 1415, y: 260, inV1: true, v2Change: "same", v1Check: "Typecheck, build, health, clean-room install, 3 green runs, SBOM, secret scan, FINAL-REPORT.", v2Check: "Unchanged." },
  { id: "G11", x: 1525, y: 260, inV1: false, v2Change: "new", v2Check: "Deployed build id = tested commit; rollback drilled; an alert fired in the test." },
  { id: "G12", x: 1635, y: 260, inV1: false, v2Change: "new", v2Check: "Metrics are raw counts; calibration run or labelled 'not calibrated'." },
];

// ---------- Defect tracer ----------
export type CatchKind = "mechanical" | "judgement" | "prevent" | "late";
export interface Catch {
  at: string; // station id or gate id position
  how: string;
  kind: CatchKind;
}
export interface Defect {
  id: string;
  title: string;
  origin: string; // station id where it enters
  story: string;
  v1: Catch[];
  v2: Catch[];
  ref: string;
}

export const DEFECTS: Defect[] = [
  {
    id: "d1", title: "A P0 security test is skipped but tagged", origin: "06", ref: "R-01",
    story: "Under time pressure the builder leaves it.skip(...) under // @req SEC-001. Reproduced against v1's trace-check: it prints PASS.",
    v1: [{ at: "07", how: "Mutation testing might expose it, but only if that module is in scope and a human reads the survivors.", kind: "judgement" }],
    v2: [
      { at: "06", how: "Slice tripwire runs trace-check-v2: skipped and assertion-free tagged files are errors.", kind: "mechanical" },
      { at: "07", how: "Every later gate re-runs the baseline check, so a skip added after the red baseline fails at the latest here.", kind: "mechanical" },
    ],
  },
  {
    id: "d2", title: "A competitor quote in the research is invented", origin: "01", ref: "R-05",
    story: "The ledger has a plausible URL and a fluent 'verbatim' pain quote the page never contained.",
    v1: [{ at: "01", how: "G1 reviewer in a fresh context may spot-check some URLs. Nothing forces every quote to be checked.", kind: "judgement" }],
    v2: [{ at: "01", how: "quote-verify requires each quote to be a substring of the stored snapshot. Not-found claims are dropped and counted.", kind: "mechanical" }],
  },
  {
    id: "d3", title: "A forum post tells the research agent to ignore its rules", origin: "01", ref: "R-04",
    story: "A fetched thread contains instructions. The agent that read it also has shell and file-write.",
    v1: [],
    v2: [{ at: "00", how: "Reader agent has no shell and no file write and returns JSON only. Raw pages never reach the synthesiser.", kind: "prevent" }],
  },
  {
    id: "d4", title: "IDOR on /api/items/:id", origin: "06", ref: "R-11",
    story: "A route reads an item by id without scoping the query to the session user.",
    v1: [
      { at: "06", how: "Authz-matrix tests written in 05 fail during the slice, if the matrix lists this route, until it is scoped.", kind: "mechanical" },
      { at: "08", how: "Hunters check every :id route and write a failing repro test.", kind: "mechanical" },
    ],
    v2: [
      { at: "06", how: "Same authz-matrix tests, run in the slice.", kind: "mechanical" },
      { at: "06", how: "Boundary slice also gets a Semgrep pass and a fresh differential review before commit.", kind: "judgement" },
    ],
  },
  {
    id: "d5", title: "Double-spend race on a unique or quota row", origin: "06", ref: "R-09",
    story: "Two parallel requests both pass an app-level check. No single deterministic assertion shows it.",
    v1: [
      { at: "06", how: "A concurrency test (Promise.all ×50) written in 05 catches it during the slice, if the spec names that invariant.", kind: "mechanical" },
      { at: "08", how: "Without a deterministic repro it is downgraded to needs_validation, not confirmed.", kind: "late" },
    ],
    v2: [
      { at: "06", how: "Same concurrency test, run in the slice.", kind: "mechanical" },
      { at: "08", how: "Confirmed as Tier T2: ≥20 seeded runs, failure rate recorded.", kind: "mechanical" },
    ],
  },
  {
    id: "d6", title: "Unbounded list or ReDoS endpoint", origin: "06", ref: "R-09",
    story: "A search endpoint accepts a 5 MB query and a catastrophic regex.",
    v1: [
      { at: "06", how: "Perf-budget tests written in 05 catch it during the slice, if a numeric limit exists in the spec.", kind: "mechanical" },
      { at: "08", how: "RESOURCE-EXHAUSTION hunt finds it; proof is hard to make deterministic, so it risks needs_validation.", kind: "late" },
    ],
    v2: [
      { at: "07", how: "API fuzzing against the contract and DAST baseline flag the oversize input and slow response.", kind: "mechanical" },
      { at: "08", how: "Confirmed as T2 with measured cost against the spec budget.", kind: "mechanical" },
    ],
  },
  {
    id: "d7", title: "The UI ships looking like every other generated app", origin: "06", ref: "R-12",
    story: "Centered hero, three cards, default radii. The design docs said otherwise; the build drifted.",
    v1: [
      { at: "07", how: "UX review with swap-the-logo and squint tests, by an agent of the same model family.", kind: "judgement" },
    ],
    v2: [
      { at: "03", how: "A rendered spike makes the intended look concrete before code exists, so drift is visible (judgement, upstream).", kind: "prevent" },
      { at: "06", how: "Token lint fails any colour or spacing not in tokens.json.", kind: "mechanical" },
      { at: "07", how: "Cross-model reviewer runs swap-the-logo against the screenshots.", kind: "judgement" },
    ],
  },
  {
    id: "d8", title: "A dependency ships a malicious postinstall script", origin: "05", ref: "R-04",
    story: "The test stack install pulls a package whose install script reads the environment.",
    v1: [{ at: "08", how: "supply-chain-risk-auditor flags install scripts, after the script already ran on the build machine.", kind: "late" }],
    v2: [{ at: "00", how: "Installs run with --ignore-scripts and a secret-free env. Packages needing scripts need an allowlist entry first.", kind: "prevent" }],
  },
  {
    id: "d9", title: "The thesis is wrong but internally consistent", origin: "02", ref: "R-13",
    story: "Every requirement is testable and traced. The product solves a problem nobody has.",
    v1: [],
    v2: [{ at: "H1", how: "Decision Digest gives a human a one-page chance to overrule. It only helps if a human reads it.", kind: "judgement" }],
  },
  {
    id: "d10", title: "The red team misses a bug and the stop rule is still met", origin: "08", ref: "R-03",
    story: "Round 2 is diff-only, so it looks only at patched files and finds nothing. The rule says stop.",
    v1: [],
    v2: [
      { at: "09", how: "Round 2 is FULL on a different partition. The stop rule needs a FULL round with 0 new findings and an estimate of ≤1 remaining.", kind: "mechanical" },
      { at: "12", how: "Planted-bug calibration measures recall. Below 0.7 the report says 'inconclusive'.", kind: "mechanical" },
    ],
  },
  {
    id: "d11", title: "The builder edits the gate ledger or progress.json", origin: "06", ref: "R-02",
    story: "A gate is hard to pass, so the state file is edited to say it did.",
    v1: [],
    v2: [{ at: "00", how: "Protected paths plus a hash-chained ledger; tampering breaks the chain. If paths can't be enforced, that is logged as NOT_VERIFIED.", kind: "prevent" }],
  },
  {
    id: "d12", title: "The deployed build isn't the tested build, or rollback is broken", origin: "10", ref: "R-14",
    story: "Staging works. Production has a different lockfile resolution and the rollback never got tried.",
    v1: [],
    v2: [{ at: "11", how: "Build id comparison, rollback drill and an alert fired on purpose.", kind: "mechanical" }],
  },
];

// ---------- Enforcement ladder ----------
export const RUNGS = ["Prose", "Judgement", "Mechanical (gameable)", "Mechanical (hardened)"] as const;
export interface Rule {
  id: string;
  rule: string;
  v1: 0 | 1 | 2 | 3;
  v2: 0 | 1 | 2 | 3;
  built: "built" | "partial" | "specified";
  note: string;
}
export const RULES: Rule[] = [
  { id: "r1", rule: "Every requirement has a test", v1: 2, v2: 3, built: "built", note: "trace-check-v2: tag line + real assertion + no skips. Self-tested." },
  { id: "r2", rule: "Never weaken a test", v1: 0, v2: 3, built: "partial", note: "Baseline check is built. Write-deny on tests/ is specified." },
  { id: "r3", rule: "Gates aren't passed from memory", v1: 0, v2: 3, built: "specified", note: "Hash-chained ledger written by the orchestrator after it re-runs the command." },
  { id: "r4", rule: "Every claim has a real source", v1: 1, v2: 3, built: "specified", note: "Snapshot + substring check, not a URL string." },
  { id: "r5", rule: "Coverage ledger is complete", v1: 1, v2: 3, built: "specified", note: "Script-enumerated entry points must all appear in the ledger." },
  { id: "r6", rule: "Verifier is independent", v1: 0, v2: 2, built: "specified", note: "Fresh context + different model family + logged file manifest. Still same-family when no second model exists." },
  { id: "r7", rule: "Red team found enough", v1: 2, v2: 3, built: "specified", note: "FULL rounds + capture–recapture + planted-bug recall." },
  { id: "r8", rule: "Research text can't steer the agent", v1: 0, v2: 3, built: "specified", note: "Structural: reader has no shell; JSON-only handoff." },
  { id: "r9", rule: "Security is checked while building", v1: 1, v2: 3, built: "specified", note: "Tripwire + incremental mutation + fresh diff review on boundary slices." },
];

// ---------- Review findings ----------
export type Severity = "High" | "Medium" | "Low–Medium" | "Low";
export interface Finding {
  id: string;
  sev: Severity;
  title: string;
  evidence: string;
  fix: string;
  status: "built" | "specified";
  stations: string[];
}
export const FINDINGS: Finding[] = [
  { id: "R-01", sev: "High", title: "trace-check accepts coverage that isn't coverage", status: "built", stations: ["02", "05"],
    evidence: "Reproduced: a skipped, assertion-free test tagged to a P0 requirement passes (exit 0). So does expect(1).toBe(1); /* @req SEC-001 */. A zero-requirement spec exits 1 but never prints why.",
    fix: "trace-check-v2 + 7-case self-test. Tags need their own comment line, ≥1 real assertion, no skips. Limit: regex, not an AST." },
  { id: "R-02", sev: "High", title: "Core rules are prose enforced by the agent that benefits", status: "specified", stations: ["00", "05", "06"],
    evidence: "'Never weaken a test' and 'never mark a gate passed from memory' have no mechanism. Nothing stops edits to tests/, progress.json or the gate tool.",
    fix: "Protected paths, frozen test baseline (built), hash-chained gate ledger, logged verifier context manifest." },
  { id: "R-03", sev: "High", title: "Stop rule can be met by a round that can't see most code", status: "specified", stations: ["08", "09"],
    evidence: "Orchestrator: 're-run 08 on the diff… until a round yields zero confirmed findings'. A diff-only round almost always does. The Cloudflare README says one run finds roughly half of what repeated runs find.",
    fix: "FULL / FULL / FULL-or-DIFF rounds; stop needs a FULL round with 0 new and Chapman estimate ≤ 1 remaining." },
  { id: "R-04", sev: "High", title: "The pipeline has no threat model for itself", status: "specified", stations: ["00", "01", "04"],
    evidence: "Phase 01 reads Reddit, HN and issue trackers with an agent that has shell + file write. Searching 00, 01 and 06 for injection / untrusted / quarantine / sandbox found only the NOT_VERIFIED line.",
    fix: "Phase 00 guardrails, reader agent without shell and JSON-only handoff, --ignore-scripts installs, repos read but never run." },
  { id: "R-05", sev: "Medium", title: "The evidence ledger can't prove a quote exists", status: "specified", stations: ["01"],
    evidence: "G1 asks for URLs, dates and ≥10 verbatim quotes. A fluent invented quote with a plausible URL looks identical to a real one.",
    fix: "Stored snapshots + substring verification; G1 counts verified quotes only." },
  { id: "R-06", sev: "Medium", title: "Fresh context isn't independent review", status: "specified", stations: ["03", "07", "08", "09"],
    evidence: "Every reviewer, verifier and post-patch validator is the same model family as the author. They share blind spots. Trail of Bits' second-opinion plugin exists for this.",
    fix: "Different model family for gate-deciding verifiers; if unavailable, record NOT_VERIFIED: single-model-family." },
  { id: "R-07", sev: "Medium", title: "Scanners are optional, so LLM reading is the only floor", status: "specified", stations: ["07", "08"],
    evidence: "07 says 'Semgrep (if available)'. No DAST, no API fuzzing, no required secrets scan on git history.",
    fix: "Required deterministic floor feeding hunters leads. Leads are never findings on their own." },
  { id: "R-08", sev: "Medium", title: "'Examined' in the ledger is self-attested", status: "specified", stations: ["08"],
    evidence: "Gaps are found by another LLM critic that may share the hunters' blind spots.",
    fix: "Script-enumerated entrypoints.json must be a subset of ledger units." },
  { id: "R-09", sev: "Medium", title: "'Deterministic test or needs_validation' under-reports whole classes", status: "specified", stations: ["08"],
    evidence: "Races, resource exhaustion, timing and config flaws are hard to assert once. Your original prompt names RESOURCE-EXHAUSTION; under v1 these land in needs_validation.",
    fix: "Evidence tiers: T1 executed, T2 bounded stress (≥20 seeds, rate recorded), T3 static proof (Medium ceiling)." },
  { id: "R-10", sev: "Medium", title: "Nothing measures whether the red team works", status: "specified", stations: ["12"],
    evidence: "'0 confirmed findings' is uninterpretable without recall data. The README's '6/10 → 9/10' ratings have no measurement behind them, against its own rule 4.",
    fix: "Planted-bug calibration on a throwaway branch; recall < 0.7 → 'red team inconclusive'." },
  { id: "R-11", sev: "Medium", title: "Security and mutation checks arrive late", status: "specified", stations: ["05", "06"],
    evidence: "Mutation testing is set up in 05 and run in 07. During 06 the builder reviews their own diff. Late defects cost a loop back to 06.",
    fix: "Per-slice tripwire, incremental mutation on changed files, fresh differential review on boundary slices." },
  { id: "R-12", sev: "Low–Medium", title: "Design is paper-only until the end; the spec has no freeze", status: "specified", stations: ["03", "FZ"],
    evidence: "Nobody sees a rendered screen until slice 1. Spec change notes exist but there's no baseline to diff against.",
    fix: "Design spike before G3; spec hash after G2/G3/G4." },
  { id: "R-13", sev: "Low–Medium", title: "No human checkpoint at the highest-leverage decision", status: "specified", stations: ["H1"],
    evidence: "Rule 5 ('decide, don't ask') is right for speed but leaves no cheap intervention point before nine phases build on the thesis.",
    fix: "Non-blocking Decision Digest after G2, marked unreviewed unless a human answers." },
  { id: "R-14", sev: "Low", title: "No deploy verification and no pipeline retrospective", status: "specified", stations: ["11", "12"],
    evidence: "Phase 10 ends at 'ready'. Nothing deploys to staging, drills rollback, or records how the pipeline performed.",
    fix: "Phase 11 deploy + verify; Phase 12 evaluation and calibration." },
  { id: "R-15", sev: "Low", title: "Smaller gaps", status: "specified", stations: ["02"],
    evidence: "Six-term weasel list; no schema for progress.json; no per-slice budget besides repair count.",
    fix: "The eleven-term lint is in trace-check-v2 (built). The progress schema and budgets are specified in v2-00." },
];

export const KEEP = [
  "Artifacts are the interface; no phase relies on chat memory",
  "Builder is not the verifier (07, 08, 09 in fresh contexts)",
  "Threat model before code, and a walking skeleton before slices",
  "Canary-based information-flow tests",
  "NOT_VERIFIED as a fail-closed status",
  "Bounded loops and a blockers log",
  "A concrete banned-defaults design list",
  "'Never state no vulnerabilities'",
];

export const PROMPT_ORDER = ["v2-00", "v2-01", "v2-05", "v2-08", "v2-11", "v2-12"] as const;
