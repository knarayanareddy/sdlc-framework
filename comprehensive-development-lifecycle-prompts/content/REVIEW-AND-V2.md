# Section 7 · Independent review and v2 amendments

> Paste-ready section for `pipeline/README.md`. It reviews `knarayanareddy/sdlc-framework` as of `main`.
> Every finding below has an ID (`R-nn`), the evidence behind it, and the concrete v2 change.
> Items marked **BUILT** exist as code in this folder and were run. Items marked **SPECIFIED** are written as prompts or
> contracts but have not been built or exercised.

---

## 7.0 What I did, and what I did not do

**Did**
- Read the README, `00` to `10` prompts, `SPEC.template.md` and `trace-check.mjs` in full.
- Read the README of `cloudflare/security-audit-skill` (6 phases, validators, sandbox requirement, "a single run finds roughly half of what repeated runs find").
- Checked that the Trail of Bits plugins named in `08` exist on `trailofbits/skills` `main`: `spec-to-code-compliance`, `sharp-edges`, `variant-analysis`, `differential-review`, `fp-check`, `insecure-defaults`, `supply-chain-risk-auditor`, `post-patch-validation`. All eight exist. Also present and unused by v1: `second-opinion`, `static-analysis`, `mutation-testing`, `property-based-testing`, `testing-handbook-skills`, `agentic-actions-auditor`, `audit-context-building`.
- Ran `trace-check.mjs` against three hand-built fixtures (results in R-01).
- Wrote `trace-check-v2.mjs` and a self-test, and ran it.

**Did not**
- Run the pipeline end to end on a real brief. Nothing here says how well v1 or v2 performs on a real product.
- Read the Cloudflare skill's `HUNTING.md`, `ATTACK-CLASSES.md` or validators, only its README.
- Read the Trail of Bits plugin sources, only their listed descriptions.
- Measure cost, wall-clock time or token use for either version.

Treat the findings as a code review of the prompts and the one tool, not as a benchmark.

---

## 7.1 Does the original red-team prompt work?

The prompt you used:

> Audit this build using the cloudflare/security-audit-skill 6-phase workflow (…) combined with Trail of Bits'
> spec-to-code-compliance, sharp-edges, and variant-analysis perspectives. Trace every untrusted datum end-to-end across
> trust boundaries, prove each finding with a deterministic reproduction test, and run post-patch-validation on your fixes.

**As a seed, yes. As the only mechanism, no.** The parts that work, and why:

| Part | Why it works |
|---|---|
| Names a real, published workflow and companion classes | Gives the agent a method. "Find vulnerabilities" gives it none. |
| "Trace every untrusted datum end-to-end across trust boundaries" | This is the invariant-first method both toolkits use. |
| "Prove each finding with a deterministic reproduction test" | The best single control against hallucinated findings. |
| Post-patch validation | Catches incomplete fixes and regressions. |

Where it falls short in a single context:
1. Hunter, verifier and patcher are one agent, so the disproof step is weak.
2. It never says what to do when the skill, a sandbox or sub-agents are missing.
3. "Fix it yourself" in the same run means the author grades their own patch.
4. Nothing tells the agent when to stop, and nothing measures whether it found enough.

v1 of the framework fixes 1 to 3 well. It leaves 4 partly open (R-03, R-10).

---

## 7.2 What v1 gets right (keep all of this)

- **Artifacts are the interface.** Phases communicate through files, not chat memory.
- **Builder is not the verifier.** Phases 07, 08 and 09 run in fresh contexts.
- **Threat model before code** (phase 04) and a **walking skeleton** (phase 05).
- **Information-flow tests with canaries.** Specific, testable, and the right unit for "does it all connect".
- **`NOT_VERIFIED` fail-closed status.** Honest by construction.
- **Bounded loops** (≤3) and a blockers log.
- **A banned-defaults list for design** that names concrete clichés.
- **"NEVER state no vulnerabilities."** The correct posture for a final report.
- **Spec requirement IDs, EARS statements and Given/When/Then.** Makes the traceability tool possible.

---

## 7.3 Findings

Severity is about how likely the flaw is to let a bad product pass the pipeline, not about the product itself.

### R-01 · High · `trace-check` accepts coverage that isn't coverage — **BUILT**

`G2`, `G5` and `10` all lean on `trace-check.mjs`. It counts a requirement as covered when a test file contains the text `@req ID`, anywhere. I ran three fixtures against it:

| Fixture | v1 result |
|---|---|
| `// @req SEC-001` + `it.skip(...)`, no assertions (a P0 security requirement) | `RESULT: PASS`, exit 0 |
| `expect(1).toBe(1); /* @req SEC-001 */` | `RESULT: PASS`, exit 0 |
| Spec with zero requirement headings | exit 1, but the message "no requirement headings found" is never printed, because it is pushed to `problems` after the print loop |

**Why it matters:** the pipeline's own rule is "mechanical where possible", and this is the mechanism. A builder under pressure, or a confused one, passes G5 with comments.

**v2:** `tools/trace-check-v2.mjs`. Tags must be on their own comment line. A tagged file needs ≥1 real assertion. Tautologies are ignored. Skips, todos and xfails in a tagged file are errors. Zero requirements prints a reason. `tools/trace-check-v2.selftest.mjs` encodes all three fixtures above plus a genuine passing test and two baseline cases: 7 behaviours, all as expected.

**Limits of v2:** it is regex-based, not an AST. A determined agent can still write `expect(x).toBeDefined()` everywhere. That is why mutation testing moves earlier (R-11). The self-test asserts exit codes only, so a case could in principle fail for a different reason than intended.

### R-02 · High · Core rules are prose that the beneficiary enforces

"Never delete or weaken a failing test", "never mark a gate passed from memory", "fresh context" and "never edit `package.json`" are instructions to the same agent that gains from ignoring them. Nothing stops a builder editing `tests/`, `docs/progress.json` or the gate tool.

**v2 (SPECIFIED):**
- **Protected paths.** The build agent's sandbox is write-deny on `tests/` (except new files), `pipeline/tools/`, `docs/progress.json` and `docs/gate-ledger.jsonl`.
- **Test baseline.** After phase 05, `trace-check-v2 --baseline docs/05-test/baseline.json`. Every later gate runs `--check-baseline`: deleted files, lost assertions or new skips fail the gate. **BUILT.**
- **Gate ledger.** `docs/gate-ledger.jsonl` is append-only and hash-chained (`{phase, gate, status, command, exit, commit, prevHash, hash}`), written only by the orchestrator process after it re-runs the command itself.
- **Context manifest.** The orchestrator logs the exact file list given to each verifier, so "fresh" is auditable.

### R-03 · High · The red-team stop rule can be satisfied by a round that cannot see most of the code

`00` step 6: "After phase 09, re-run 08 on the diff. Repeat until a round yields zero confirmed findings." `08` §8.10: "Run 08 at least twice… once after patches (differential)… Stop when a **full** round yields 0 new confirmed findings."

These conflict. A diff-only round examines only patched files, so it yields zero confirmed findings almost by construction. The Cloudflare README says a single full run finds roughly half of what repeated runs find. Round 2 as written does not repeat the full run, so the "other half" is never sought.

**v2 (SPECIFIED):** rounds alternate and are labelled.
- Round 1: **full**.
- Patch.
- Round 2: **full again** on a different hunter partition and ledger order, seeded with round 1's ledger only to mark unexamined units, preferably a different model.
- Round 3 (if needed): differential on the patches.
- **Stop** only when a *full* round yields 0 new confirmed findings **and** the capture-recapture estimate (7.5) says ≤ 1 expected remaining. Otherwise stop at 3 full rounds and report the estimate.

### R-04 · High · The pipeline has no threat model for itself

Phase 01 tells an agent to read Reddit, Hacker News, competitor sites, GitHub issues and reviews. That agent also has shell and file-write access. Any of those pages can contain instructions. Phase 06 installs dependencies with install scripts, in an environment that may hold `DATABASE_URL` and other secrets. I searched `00`, `01` and `06` for *injection*, *untrusted*, *quarantine* and *sandbox*. The only hit is the orchestrator's `NOT_VERIFIED` line.

**v2 (SPECIFIED, prompt `v2-00`):**
- **Phase 00 Guardrails** before anything runs: egress allowlist, secret-free env for research and build, resource and cost caps, kill switch, protected paths.
- **Research is a two-stage pipeline.** A *reader* agent has web tools and **no shell and no file write**. It returns only a typed JSON extract (claim, quote, URL). A *synthesiser* agent sees the JSON and snapshots, never raw pages. Fetched text is data, never instruction.
- Dependencies install with `--ignore-scripts` by default. Anything needing scripts goes on a reviewed allowlist in `dependency-vetting.md`.
- Repos cloned "to learn from" are read-only and never built or executed.

### R-05 · Medium · The evidence ledger can't prove a quote exists

G1 requires URLs, dates and "≥10 verbatim quotes". A model can produce a plausible URL and a plausible quote. A fresh reviewer reading the ledger cannot tell.

**v2 (SPECIFIED, prompt `v2-01`):** `quote-verify` fetches each URL, stores a snapshot with a hash, and checks the quote is a substring of the snapshot after whitespace normalisation. G1 counts only **verified** quotes. Unreachable sources stay listed as unverified.

### R-06 · Medium · "Fresh context" is not independent review

Fresh contexts remove shared chat history. They keep shared model weights, and so shared blind spots. Every reviewer, verifier and post-patch validator is the same model family as the author.

**v2 (SPECIFIED):** verifiers that decide a gate use a **different model family** from the author where one is available: the `03` no-AI-tells review, the `08` candidate verifiers and the `09` post-patch validator. Trail of Bits `second-opinion` already wraps Codex and Antigravity reviews. When no second model is available, record `NOT_VERIFIED: single-model-family` on the gate, don't skip it silently.

### R-07 · Medium · Deterministic scanners are optional, so LLM reading is the only floor

`07` says "Semgrep (if available)". Scanners are cheap, repeatable and biased in different ways from an LLM.

**v2 (SPECIFIED, prompt `v2-08`):** a required **deterministic floor** before hunting: Semgrep or CodeQL (TOB `static-analysis`), `osv-scanner` or `npm audit`, `gitleaks`, ESLint security rules, a DAST baseline (OWASP ZAP baseline or Nuclei) against the sandboxed production build, and schema-driven API fuzzing (Schemathesis or equivalent) when an OpenAPI spec exists. Scanner output becomes **leads** for hunters. It is never a finding on its own.

### R-08 · Medium · "Examined" in the coverage ledger is self-attested

The ledger records which units were examined. Gaps are found by LLM "coverage critics", which can share the hunters' blind spots.

**v2 (SPECIFIED):** a deterministic **entry-point enumerator** (a script: every `route.ts`, `"use server"` function, `middleware`, `page` with params, form action, `process.env.*` read, and raw SQL call) produces `entrypoints.json`. Gate: every enumerated entry point appears in the ledger. Critics remain, but only on top of this floor.

### R-09 · Medium · "Deterministic repro test or `needs_validation`" under-reports whole classes

Your original prompt names RESOURCE-EXHAUSTION. Races, unbounded work, timing channels and header or config flaws are hard to prove with one deterministic assertion. Under v1 they all slide to `needs_validation`, and that bucket is where real findings go to die.

**v2 (SPECIFIED):** a sidecar `evidence_tier` per confirmed finding. The skill's schema is unchanged.

| Tier | Evidence | Typical classes | Severity ceiling |
|---|---|---|---|
| **T1 Executed** | Deterministic test fails on the current commit with the vulnerable assertion | IDOR, injection, XSS, open redirect, mass assignment | none |
| **T2 Bounded stress** | Repeated run (≥20 seeds or iterations) shows invariant violation or resource threshold crossing, in a sandbox, with the failure rate recorded | races, double-spend, unbounded work, amplification | none, rate stated |
| **T3 Static proof** | Full source trace **and** a written list of the controls checked and found absent (middleware, schema, DB constraint, CSP, framework default), confirmed by two independent verifiers | config, headers, dead-code paths, anything needing infrastructure you lack | Medium unless reproduced |

`needs_validation` stays for a single named unknown fact.

### R-10 · Medium · Nothing measures whether the red team works

"0 confirmed findings" means nothing unless the same process finds known bugs. v1's README also rates the original prompt "6/10 → 9/10", and the framework's own rule 4 is "No claim without evidence". Those numbers have none behind them.

**v2 (SPECIFIED, prompt `v2-12`):** **planted-bug calibration.** On a throwaway branch (never merged), inject 8 to 12 known vulnerabilities across classes the app actually has. Run the red team blind. Report recall per class. If overall recall is < 0.7, or any applicable class scores 0, the final report says "red team inconclusive" instead of "0 findings". Planted bugs are usually easier than natural ones, so recall is an optimistic upper bound.

### R-11 · Medium · Security and mutation checks arrive late

Mutation testing is configured in `05` and run in `07`. Security review during `06` is the builder reviewing their own diff through a sharp-edges lens. Defects found in `07` to `09` cost a loop back to `06`.

**v2 (SPECIFIED, prompt `v2-05`):**
- **Per-slice tripwire** (deterministic, minutes): Semgrep, gitleaks, osv, `trace-check-v2 --check-baseline`, and **incremental mutation testing** on files changed in the slice.
- **Fresh differential review** (TOB `differential-review`) for slices that touch auth, a data boundary or a new dependency. Other slices skip it.

### R-12 · Low–Medium · Design is paper-only until the end, and the spec has no freeze

`03` runs after the spec is written, and nobody sees a rendered screen until slice 1. The signature element is specified in a document, then built. The spec has change notes but no baseline to diff against.

**v2 (SPECIFIED):** a **design spike** in `03`: render the signature element and two states (empty, error) as a static prototype with real sample data, then screenshot at 360 and 1280 px before G3. After G2 and G3, **freeze the spec** with a content hash. Later edits require an entry in `CHANGES.md` that lists affected tests.

### R-13 · Low–Medium · No human checkpoint at the highest-leverage decision

A wrong thesis or a wrong scope assumption flows through nine phases. Rule 5 ("decide, don't ask") is right for velocity but gives a human no cheap point to intervene.

**v2 (SPECIFIED):** a **non-blocking Decision Digest** after G2: one page with the thesis, the top 5 assumptions and the scope in/out. The pipeline continues, and the digest is marked `unreviewed` unless a human answers. The final report lists `unreviewed` decisions. This keeps the "don't ask" contract while giving you a place to overrule.

### R-14 · Low · No deploy verification and no pipeline retrospective

Phase 10 ends at "ready". Nothing deploys to a staging target and verifies after deploy. Nothing records how the pipeline itself performed.

**v2 (SPECIFIED):** **Phase 11** deploy and post-deploy verification (smoke on staging, rollback drill, alert test, canary where available). **Phase 12** pipeline evaluation (escaped defects, gate false-pass rate, planted-bug recall, cost, time, loop counts), written to `docs/12-eval/` and used to change the prompts under version control.

### R-15 · Low · Smaller gaps

- Weasel-word list in `trace-check` has six terms. v2 uses eleven and only checks the Statement.
- No requirement-ID format check beyond `REQ|SEC|NFR`.
- `docs/progress.json` has no schema.
- Phase 06 has no budget cap per slice (time or tokens), only a repair count.

---

## 7.4 The v2 pipeline

```
 BRIEF
   │
 [00 Guardrails + control plane]  ← NEW: sandbox, egress allowlist, budgets, protected paths, gate ledger
   │
 [01 Research]  reader(no shell) → JSON extract → synthesiser      ← CHANGED: quarantine + quote-verify
   │  G1: ≥N VERIFIED quotes, not just listed ones
 [02 Spec]                                                          ← CHANGED: richer weasel lint
   │  G2 ──► Decision Digest (non-blocking, human may overrule)     ← NEW
 [03 Design + UX + SPIKE] ║ [04 Architecture + Threat model]        ← 03 CHANGED: rendered spike; cross-model review
   │  G3 / G4  → SPEC FREEZE (hash)                                 ← NEW
 [05 Test strategy + scaffold]                                      ← CHANGED: trace-check-v2 + test baseline
   │  G5
 [06 Build slices]  per slice: TRIPWIRE + incremental mutation      ← CHANGED
   │               + fresh diff review on boundary slices
 [07 QA sweep]  (fresh, cross-model where possible)                 ← CHANGED: DAST baseline, fuzz, soak
   │  G7
 [08 Red team v2]  floor → enumerator → hunt → verify(cross-model) → tiers → report   ← CHANGED (big)
   │
 [09 Patch + post-patch validation]  fix must kill its own mutants   ← CHANGED (small)
   │  full / full / diff rounds, capture–recapture stop
 [10 Release readiness]                                             ← unchanged
   │
 [11 Deploy + post-deploy verification]                             ← NEW
   │
 [12 Pipeline evaluation + calibration]                             ← NEW
```

---

## 7.5 Stop rule (capture–recapture)

Run two independent **full** hunts A and B (different hunter partition and order, ideally different models). Let `nA` and `nB` be distinct confirmed findings, `m` the overlap.

Chapman estimate of the total: `N̂ = ((nA + 1)(nB + 1)) / (m + 1) − 1`. Expected remaining ≈ `N̂ − |A ∪ B|`.

- `m = 0` → no estimate, run another round.
- Stop when a full round after patching yields 0 new confirmed findings and expected remaining ≤ 1. Otherwise stop at 3 full rounds and print the estimate.

**Assumption you must state:** the estimator assumes the two hunts are independent and every bug is about equally easy to find. Hunters from the same model are correlated, and some bugs are much harder than others, so the estimate is **optimistic**. Cross-model rounds reduce that bias; they do not remove it.

---

## 7.6 Rule enforcement: prose → mechanical

| Rule (v1) | v1 enforcement | v2 enforcement | Status |
|---|---|---|---|
| Every requirement has a test | regex on `@req` text | `trace-check-v2`: tag line + real assertion + no skips | **BUILT** |
| Never weaken a test | prose | baseline check + write-deny on `tests/` | check **BUILT**, deny SPECIFIED |
| Gates are not passed from memory | prose | hash-chained gate ledger written by the orchestrator | SPECIFIED |
| Every claim has a source | URL string present | snapshot + substring quote verification | SPECIFIED |
| Coverage ledger is complete | LLM critic | entry-point enumerator ⊆ ledger | SPECIFIED |
| Verifier is independent | fresh context | fresh context + different model family + context manifest | SPECIFIED |
| Red team found enough | "round yields 0" | full rounds + capture–recapture + planted-bug recall | SPECIFIED |
| Research content can't steer the agent | nothing | reader without shell, JSON-only handoff | SPECIFIED |
| Security checked while building | builder self-review | tripwire + incremental mutation + fresh diff review | SPECIFIED |

---

## 7.7 What I would do first

1. Swap in `trace-check-v2` and run the self-test. Cheapest change, closes the most reachable hole.
2. Add the test baseline to G5 and every gate after it.
3. Fix the stop rule wording (R-03). It is a text edit.
4. Add `v2-00` guardrails before the next autonomous run that reads the open web.
5. Add the deterministic floor and the entry-point enumerator to `08`.
6. Run planted-bug calibration once per pipeline version, not per product.

## 7.8 Residual risks v2 does not remove

- Same-model correlation remains when only one model is available.
- A real usability study, real assistive-technology testing and a human penetration test are outside this pipeline. `NOT_VERIFIED` is the correct label.
- Most v2 controls are specified, not built. Until each has a self-test like `trace-check-v2`, treat it as a prompt, not a gate.
- v2 adds three phases and several scripts. If the added cost isn't worth it for a small project, the minimum viable set is items 1 to 3 above.
