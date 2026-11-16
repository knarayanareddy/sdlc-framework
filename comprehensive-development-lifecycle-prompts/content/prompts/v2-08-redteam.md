# v2-08 · Red Team v2 (amends `08`)

Input: repo at HEAD, `docs/04-architecture/*` (claims to test, not truth), previous run ledgers, scanner output
Output: `docs/08-redteam/run-N/{architecture.md, entrypoints.json, scanner-leads.json, coverage-ledger.json, findings.json, evidence-tiers.json, REPORT.md, FINDINGS-DETAIL.md, NEEDS-VALIDATION.md}` and `tests/security/*`
Status: the Cloudflare and Trail of Bits workflows are existing skills. The additions here are **SPECIFIED**.

Everything in `08` still applies. This file lists what changes. Keep running every sub-phase in a fresh agent.

---

## 8.0′ Orchestrator preamble (replace 8.0)

Audit this repository in **full audit mode** with `security-audit-skill`, standard profile (`deep` if it handles money, PII or multiple tenants). Round label: `RUN-N-FULL` or `RUN-N-DIFF`. A DIFF round never counts toward the stop rule. Do not modify product code, only add reproduction tests under `tests/security/`. Execute the app only inside the sandbox from `docs/00-control/guardrails.md`. If no sandbox exists, dynamic confirmation is `needs_validation`.

## 8.1′ Deterministic floor (new, before hunting, scripts not models)

Run and store raw output under `run-N/floor/`:
1. **SAST:** Semgrep and/or CodeQL (Trail of Bits `static-analysis`).
2. **Dependencies:** `osv-scanner` or `npm audit`; Trail of Bits `supply-chain-risk-auditor` for install scripts and abandoned upstreams.
3. **Secrets:** `gitleaks` on the tree and on git history.
4. **DAST baseline:** OWASP ZAP baseline or Nuclei against the sandboxed **production build**, no external network.
5. **API fuzzing:** Schemathesis (or equivalent) against the OpenAPI/contract from `SPEC.md` §7. Property: no 5xx, responses match schema, unknown fields rejected.
6. **Entry-point enumerator** → `entrypoints.json`: every `route.ts` (method × path), every `"use server"` function, `middleware`, every `page` with params, every form `action`, every `process.env.*` read, every `sql.raw` or string-built query, every outbound `fetch`.

Convert scanner results to `scanner-leads.json` (`{tool, rule, file, line, text}`). **Leads are not findings.** A hunter must confirm, refute or mark each lead.

## 8.2′ Coverage rule (replaces the critic-only gap check)

Gate: every item in `entrypoints.json` appears in `coverage-ledger.json` as a unit, status `examined` with a hunter id, or `excluded` with a reason. Run the check by script (`jq` or Node), not by asking a model. Coverage critics still run afterward for gaps the enumerator cannot see (business logic, multi-step flows).

## 8.3′ Verifier independence

Candidate verifiers (V) must be a **different model family** from the hunters where one is available (Trail of Bits `second-opinion` can route a review to Codex or Antigravity). Log the family in `evidence-tiers.json`. If only one family exists, write `NOT_VERIFIED: single-model-family` on the run and note that stop-rule estimates are optimistic.

## 8.4′ Evidence tiers (replace "no test → needs_validation" for classes that are hard to assert once)

| Tier | Required evidence | Ceiling |
|---|---|---|
| **T1 Executed** | deterministic test in `tests/security/` fails on current commit with the vulnerable assertion | none |
| **T2 Bounded stress** | repeated runs (≥20 seeds) in sandbox, invariant violated or resource limit crossed in ≥k runs, rate recorded | none, rate stated |
| **T3 Static proof** | full source trace + explicit list of controls checked and found absent, confirmed by two independent verifiers | Medium unless later reproduced |

`needs_validation` remains for one named missing fact. Write the tier next to each `confirmed` finding in `evidence-tiers.json`. Do not change the skill's `findings.json` schema.

Resource-exhaustion findings are T2 by default: state the input size, the measured cost (ms, MB, queries) and the budget from `SPEC.md` it exceeds.

## 8.10′ Rounds and stop rule (replace 8.10)

1. **Round 1: FULL.**
2. Patch (`09`).
3. **Round 2: FULL**, different hunter partition and ledger order, different model if available. Prior ledger marks unexamined units only; stale `examined` units whose files changed are reopened.
4. If Round 2 found new confirmed findings: patch, then **Round 3: FULL**. If it found none: **Round 3: DIFF** on patched files and their callers.
5. Compute the Chapman estimate from the two FULL rounds that were independent: `N̂ = ((nA+1)(nB+1))/(m+1) − 1`. Report it. If `m = 0`, report "no estimate".
6. **Stop** when a FULL round yields 0 new confirmed findings **and** expected remaining ≤ 1, or after 3 FULL rounds. Anything left goes to `NEEDS-VALIDATION.md` with the estimate printed in `REPORT.md`.

State in the report: the estimate assumes independent hunts and equally findable bugs, so it is an optimistic bound.

## Done when (additions)
- [ ] `entrypoints.json` ⊆ ledger units (script output attached)
- [ ] Every scanner lead is confirmed, refuted or carried to `needs_validation`
- [ ] Every confirmed finding has a tier and, for T1, a failing test committed
- [ ] The report names which rounds were FULL and which were DIFF
- [ ] Verifier model family recorded, or `NOT_VERIFIED` stated

NEVER: report a DIFF round as proof the codebase is clean. Never turn a scanner lead into a finding without a trace.
