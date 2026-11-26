# Autonomous Build Pipeline: Brief → Researched Spec → Built → Tested → Red-Teamed → Patched → Shipped

This folder is the operating manual **and** the executable pipeline. `prompts/` holds one
copy-paste prompt per phase (`00`–`10` for v1, `v2-*` for the amended set). `templates/`
holds the spec skeleton. `tools/` holds the gate checkers. `bin/pipeline.mjs` is the
orchestrator that runs them.

---

## 0. v2 is executable — start here

v1 was prose plus one regex tool. **v2 ships the missing mechanisms as programs**, each with
its own test. Nothing below needs a model until a prompt tells you to dispatch one.

```bash
node pipeline/tools/run-selftests.mjs      # 17 test files + 1 selftest script: no tool is trusted before its own test
node pipeline/tools/gate-ledger.mjs demo   # the G0 tamper test
node pipeline/tools/demo.mjs               # walk phases 00 → 12 on a worked example

cd /path/to/product
node <repo>/pipeline/bin/pipeline.mjs init
node pipeline/bin/pipeline.mjs gate G5 --builtin trace:freeze,trace:check,unit
node pipeline/bin/pipeline.mjs verify      # re-run every recorded gate; names any DRIFT
node pipeline/bin/pipeline.mjs report
```

| Tool | Closes | What it does |
|---|---|---|
| `bin/pipeline.mjs` | the missing state machine | runs gates itself, records exit codes, appends a hash-chained ledger, refuses phase transitions without prerequisites |
| `tools/trace-check-v2.mjs` | R-01 | tags must sit on their own line, need a real assertion, no skips; `--baseline` freezes assertions **and test cases** |
| `tools/gate-ledger.mjs` | R-02 | append-only hash chain; `demo` proves one edited line breaks it |
| `tools/protected-paths.mjs` | R-02 | tests are append-only; the agent cannot edit the tool that gates it |
| `tools/quote-verify.mjs` | R-05 | snapshots every source and requires the quote to be a substring; a page flagged `injectionSuspected` is quarantined (no ledger rows at all), every verified row records the snapshot's sha256 and how it was obtained, and `file:` sources are limited to `docs/01-research/` and the temp dir so a builder cannot write the page it quotes |
| `tools/entrypoints.mjs` | R-08 | enumerates every route, action, env read, raw SQL and outbound fetch; **zero entry points is `NOT_VERIFIED`, exit 3** — even with `--out` |
| `tools/coverage-gate.mjs` | R-08 | enumerated entry points must appear in the coverage ledger, examined or excluded with a reason; an empty entry-point list is `NOT_VERIFIED`, and units the enumerator did not list are held to the same bar |
| `tools/validate-findings.mjs` | R-09 | evidence tiers T1/T2/T3, a real tagged repro test, T3 capped at Medium, a DIFF run cannot claim clean |
| `tools/estimate.mjs` | R-03, R-10 | Chapman capture–recapture; refuses to guess from zero overlap |
| `tools/tripwire.mjs` | R-11 | per-slice deterministic checks; a missing tool is `NOT_VERIFIED` (exit 3), never green, and only a check marked `"optional": true` may be downgraded — a mandatory check that says "not found" fails |
| `tools/validate-progress.mjs` | R-15 | schema + invariants: `passed` needs exit 0, `NOT_VERIFIED` needs a reason and a human command |
| `tools/verifier-route.mjs` | R-09, R-16 | routes a verification to a model from **another family**, seals the envelope with a hash, and puts the **excerpts themselves** (line-numbered, hash-bound) in the prompt it writes and dispatches. Every `path:line` in a verdict is resolved against those excerpts, so a citation to a file that was not provided is rejected as "from memory"; a verdict must name a model or a family; a `refuted`/`insufficient` claim fails the gate unless `--allow-refuted` |
| `tools/independence.mjs` | R-16 | reads what the ledger recorded: PASS, FAIL (same family), or NOT_VERIFIED (no model recorded). The builder's family comes from `--builder-family`, `independence.builderFamily` or `PIPELINE_BUILDER_MODEL`; if none of them names a known family the answer is NOT_VERIFIED/exit 3 — "openai verified a unknown build" is never a PASS |
| `tools/sandbox.mjs` | R-14 | `run` executes untrusted code with a scrubbed env, its own workdir, timeout and output cap; the memory rlimit and the timeout compose correctly (`timeout … sh -c 'ulimit -v …; cmd'`); `--require-all` refuses **before** executing when a control cannot be enforced; `profile`/`verify` ship and check a hardened compose file |
| `tools/fuzz-api.mjs` | R-08 | schema-driven adversarial requests against a running build; violations are leads, not findings; a run in which every case was skipped (missing credentials) is `NOT_VERIFIED`, not `CLEAN` |
| `tools/dast.mjs` | R-08 | runs ZAP/nuclei/schemathesis where installed, and normalises semgrep, SARIF, ZAP, nuclei, junit and fuzz output into one lead shape; a scan counts as `ran` only when it produced a parseable artifact — otherwise the run is `NOT_VERIFIED`, exit 3 |
| `tools/calibrate.mjs` | R-10 | planted-bug calibration: deterministic plan, blind answer, recall per class, calibrated/inconclusive verdict that `report` has to print |
| `tools/expect-files.mjs` | — | artifact gates where no command can judge the work |

Four layers used to be "specified, not built". They are built and tested now; what remains is
the part that needs a credential, a container runtime or a scanner binary, and
**[`INTEGRATIONS.md`](./INTEGRATIONS.md)** lists exactly what to do for each — with the command
that proves it worked. Anything still unenforceable on your host is reported as `NOT_VERIFIED`
with the command a human must run, never silently skipped.

Full operating instructions: **[`RUNBOOK.md`](./RUNBOOK.md)**.

---

## 1. Does your red-team prompt work?

**Partly.** It is a good seed. Verified against the real repos (`cloudflare/security-audit-skill`,
`trailofbits/skills`):

| What your prompt does well | Why it works |
|---|---|
| Names real skills and real attack-class companion files | Gives the agent a concrete method instead of "find vulns" |
| "Trace every untrusted datum end-to-end across trust boundaries" | This is the invariant-first method both toolkits use |
| "Prove each finding with a deterministic reproduction test" | Kills hallucinated findings, which is the biggest failure mode of LLM audits |
| Adds Trail of Bits post-patch-validation | Catches incomplete fixes and regressions |

| Gap | Consequence | Fix in `prompts/08` and `prompts/09` |
|---|---|---|
| Lists only 3 of the skill's 6 phases (omits structured output, independent record verification, reporting) | No schema-validated `findings.json`; claims never re-checked against source | All 6 phases made explicit |
| The skill's core idea is **the agent that finds a bug never confirms it**. One chat prompt usually runs as one agent | Hunter and verifier share context and bias, so the disproof step is theatre | Each phase runs in a **fresh session or sub-agent** that reads only artifacts on disk |
| The skill needs parallel sub-agents and an OS sandbox to run target code | In a plain chat, ledger units get serialized or skipped; the agent may refuse to execute the app | Prompt has a degraded-mode protocol and a "needs_validation" rule |
| The skill *finds*. It does not fix | "Fixes it itself" in the same prompt means the author grades their own homework | Fix is a separate phase with a separate agent (`09`) |
| No spec existed for spec-to-code-compliance to compare against | That skill has nothing to check | Spec (`02`) and threat model (`04`) are now inputs |
| AI/LLM class is only relevant if the app calls an LLM | Wasted budget, or false coverage claims | Recon selects companion files by what the app actually does |
| No stop condition | Either runs forever or stops after one pass | Rounds are bounded. Pass 2 reads pass 1's ledger. The authors report one run finds roughly half of what repeated runs find |
| Missing general classes (injection, access control, business logic, supply chain, config) | Only the named companions get hunted | Ledger must cover all of them |

**Verdict: about 6/10 as written. About 9/10 once split across fresh contexts and fed a spec and threat model.**

---

## 2. Pipeline shape

```
 BRIEF
   │
   ▼
[01 Intake + Research] ──► evidence ledger, ranked ideas, differentiation thesis
   │  GATE G1: every claim has a verified quote; ≥5 competitors; ≥10 quotes; ≥3 rejected ideas
   ▼
[02 Spec] ──► SPEC.md (REQ/SEC/NFR IDs, Given/When/Then, data-flow table, budgets, slices)
   │  GATE G2: trace-check passes structure; reviewer agent can't find an untestable requirement
   ▼
[03 Design + UX]    [04 Architecture + Threat model]   (parallel, both read SPEC)
   │  G3: no-AI-tells review     │  G4: every entry point has abuse cases + controls
   └───────────────┬─────────────┘
                   ▼
[05 Test strategy + scaffolding] ──► failing tests derived from acceptance criteria + walking skeleton
   │  GATE G5: every REQ has ≥1 tagged test (red). Clean-DB journey harness runs.
   ▼
[06 Build in vertical slices]  ◄──────────────┐
   │  per slice: red → green → refactor →      │ max 3 repair loops, then log in blockers.md
   │  full gate run → commit                   │
   ▼                                           │
[07 QA / Verification sweep] (fresh agent) ────┘ defects go back to 06
   │  GATE G7: all flows pass on clean DB; flow-of-information matrix green;
   │           a11y/perf budgets met; mutation score ≥ threshold
   ▼
[08 Red team] Cloudflare 6 phases + ToB spec-compliance / sharp-edges / variant-analysis
   │  (recon → hunt waves → coverage critics → disprove → findings.json → record-verify → report)
   ▼
[09 Patch + post-patch validation] (fresh agent) → re-run 08 on the diff → loop ≤3 rounds
   │  GATE G9: 0 confirmed findings; every fix has a fail-before/pass-after test in tests/security
   ▼
[10 Release readiness + handoff] → final compliance, build, health check, honest limitations report
```

---

## 3. Operating rules (these make the pipeline work)

1. **Artifacts are the interface.** Each phase reads files from `docs/` and writes files to `docs/`. No phase relies on chat memory.
2. **Builder ≠ verifier.** Phases 07, 08, 09 and every disproof step must run in a fresh context. The spec reviewer must not be the spec author.
3. **Every gate is mechanical where possible.** Use `tools/trace-check.mjs`, `tsc`, `npm run build`, test runners, and the skill validators. Do not accept "looks good".
4. **No claim without evidence.** Research needs URLs and dates. Findings need a failing test. UX claims need screenshots.
5. **Decide, don't ask.** Ambiguity is resolved with a recommendation, logged in `docs/00-intake/assumptions.md` with the alternative rejected and why. A human can overrule later.
6. **Bounded loops.** Repair ≤3 per defect. Red-team rounds ≤3. Then escalate to `docs/blockers.md`.
7. **State machine.** `docs/progress.json` records phase, gate status, commit SHA and open blockers. The orchestrator resumes from it.
8. **Fail closed.** If a gate cannot be evaluated (no sandbox, no browser), mark it `NOT_VERIFIED`, never `passed`.

---

## 4. Steps you were missing (now included)

| Missing step | Where |
|---|---|
| Assumptions / ADR log (so "don't ask" stays auditable) | 01, 04 |
| Threat model **before** code (shift-left), which also makes red-team recon cheaper | 04 |
| Requirement ↔ test traceability matrix, mechanically checked | 02, 05, `tools/` |
| Test-first scaffolding and a **walking skeleton** (end-to-end thin slice first to expose blockers early) | 05, 06 |
| Information-flow tests using canary values | 05, 07 |
| Mutation testing, so coverage % can't be gamed | 05, 07 |
| Property-based and concurrency/race tests | 05 |
| Resilience tests (DB down, timeouts, retries, idempotency) | 05, 07 |
| Accessibility (WCAG 2.2 AA), performance budgets, visual regression | 03, 05, 07 |
| Migration up/down and seed tests | 05, 10 |
| Dependency/supply-chain vetting, SBOM, secret scan | 04, 08, 10 |
| Observability (structured logs without PII, health checks, error taxonomy) | 02, 10 |
| Differential re-audit of patches (so fixes don't introduce new bugs) | 09 |
| Honest "known limitations" report | 10 |
| Post-release feedback loop (real users, real telemetry) | 10 |

---

## 5. What an autonomous run can and cannot do

- **It can:** research competitors and public discussions, write a rigorous spec, build, test, audit, and patch.
- **It cannot:** replace real user research or usability testing. "Well researched UX" means public evidence, established heuristics and walkthroughs. `prompts/03` includes a 5-user test script for when you can run one.
- **It cannot** reliably audit its own work in one context. Use fresh sessions.
- **Practical limit:** a single chat turn has a tool-call budget (about 75 steps here). Run **one phase per session** and let `docs/progress.json` carry state.

---

## 6. How to run

**v2 (recommended, executable):**

1. `node pipeline/bin/pipeline.mjs init` in the target repo, then edit `pipeline.config.json`.
2. Drive one phase per fresh agent session with `phase start` → prompt → `gate` → `phase done`. `pipeline next` prints what to do.
3. Read [`RUNBOOK.md`](./RUNBOOK.md) for every command, and `prompts/v2-99-orchestrator.md` for the loop a driving model should follow.

**v1 (prose only, kept for reference):**

1. Create `docs/00-intake/brief.md` with your brief.
2. Run `prompts/00-orchestrator.md` for end-to-end runs in agents with sub-agent support. Otherwise paste prompts `01` to `10` in order, one per fresh session.
3. Install the skills the prompts name, following each repo's README: `cloudflare/security-audit-skill` and `trailofbits/skills`. If a skill is missing, each prompt has a fallback checklist.
4. Check status with: `node pipeline/tools/trace-check-v2.mjs docs/02-spec/SPEC.md tests --allow-uncovered`

Default stack assumed by the prompts: Next.js App Router, Drizzle + Postgres, Vitest, fast-check, Playwright, axe-core, Stryker. Swap if your repo differs.
