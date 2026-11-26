# v2-08 · Red team v2 (Cloudflare 6 phases + Trail of Bits lenses, on a deterministic floor)

Input: repo at HEAD, `docs/04-architecture/*` (claims to test, not truth), `scanner-leads.json`, previous run ledgers
Output: `docs/08-redteam/run-N/{architecture.md, entrypoints.json, scanner-leads.json, coverage-ledger.json, findings.json, evidence-tiers.json, REPORT.md, FINDINGS-DETAIL.md, NEEDS-VALIDATION.md}` and `tests/security/*`
Gate: feeds **G9**. Phase 08 completes when its three artifacts validate.

```bash
node pipeline/bin/pipeline.mjs phase start 08
node pipeline/tools/entrypoints.mjs --root . --out docs/08-redteam/run-1/entrypoints.json
#   … hunt, verify, write the ledger and findings …
node pipeline/bin/pipeline.mjs phase done 08      # runs entrypoints + coverage + findings validators
```

Install the skills first: `cloudflare/security-audit-skill`, `trailofbits/skills` (spec-to-code-compliance, sharp-edges, variant-analysis, differential-review, fp-check, insecure-defaults, supply-chain-risk-auditor, post-patch-validation, second-opinion).
**Run every sub-phase in a fresh session or sub-agent.** If sub-agents are unavailable, run the phases sequentially and pass only the files named.

## 8.0 Orchestrator preamble

Audit this repository in **full audit mode**, standard profile (`deep` if it handles money, PII or multi-tenancy). Label the round `RUN-N-FULL` or `RUN-N-DIFF`. **A DIFF round never counts toward the stop rule.** Do not modify product code; you may only add reproduction tests under `tests/security/`. Execute the app only inside the sandbox from `docs/00-control/guardrails.md`. If no sandbox exists, dynamic confirmation is `needs_validation`.

## 8.1 Deterministic floor (scripts, not models)

Run and store raw output under `run-N/floor/`: SAST (Semgrep/CodeQL), dependencies (osv-scanner, `supply-chain-risk-auditor`), secrets (gitleaks on the tree **and** history), DAST baseline against the sandboxed production build, API fuzzing against the spec contract, and the entry-point enumerator.

```bash
node pipeline/tools/entrypoints.mjs --root . --out docs/08-redteam/run-N/entrypoints.json
```

Scanner results become `scanner-leads.json` (`{tool, rule, file, line, text}`). **Leads are not findings.** A hunter must confirm, refute or defer each lead.

## 8.2 Coverage-led hunting

One isolated hunter per group of ledger units. Each hunter prompt contains: role, `architecture.md` verbatim, assigned unit ids, the **verbatim text** of the relevant attack-class blocks, exclusions, and the results contract.

Work from a concrete invariant:
1. Name the lower-trust principal and its starting capability.
2. Name the accepted value, action, state transition or resource selector.
3. Locate the control that should reject, bind, isolate, limit or revoke it.
4. Trace the exact path after that decision, end to end across trust boundaries.
5. Stop at the smallest observable effect.
6. State the source-level fix and the regression test.

Apply sharp-edges, variant-analysis and insecure-defaults to every candidate. Then run **coverage critics** (fresh) for gaps the enumerator cannot see (business logic, multi-step flows).

Coverage is checked by script, not by asking a model:

```bash
node pipeline/tools/coverage-gate.mjs --entrypoints docs/08-redteam/run-N/entrypoints.json --ledger docs/08-redteam/run-N/coverage-ledger.json
```

Every enumerated entry point must be a unit with status `examined` and a hunter id, or `excluded` with a written reason.

## 8.3 Candidate validation (fresh verifiers who did not hunt)

"You did not write this. **Try to refute it.**" Re-read every cited location, re-run any decisive check, and look for a control the hunter missed (framework default, middleware, DB constraint, schema validation, CSP). Use `fp-check`. Verdicts: `confirmed` (complete source trace **and** an observed result), `needs_validation` (name the single missing fact), `rejected` (write why, so future runs skip it). Use verifiers from a **different model family** where available and record the family; if only one family exists, write `NOT_VERIFIED: single-model-family`.

## 8.4 Evidence tiers (not "no test → needs_validation" for hard-to-assert classes)

| Tier | Required evidence | Ceiling |
|---|---|---|
| **T1 Executed** | deterministic test in `tests/security/` fails on the current commit with the vulnerable assertion | none |
| **T2 Bounded stress** | ≥20 seeded runs or iterations in the sandbox; invariant violated or limit crossed; failure rate recorded | none, rate stated |
| **T3 Static proof** | full source trace + explicit list of controls checked and found absent, confirmed by two independent verifiers | Medium unless reproduced |

`needs_validation` remains for one named missing fact. The validator enforces all of this, including the T3 severity ceiling and the `@finding <id>` tag in a T1 test.

## 8.5 Structured output

Write `findings.json` to the skill's schema (severity from real impact: who can do what to whom, with what precondition). Malformed agent output is discarded, never repaired.

```bash
node pipeline/tools/validate-findings.mjs docs/08-redteam/run-N/findings.json
```

## 8.6 Record verification and report

Fresh agents re-check every final claim against source; a substantive edit goes to yet another fresh verifier. Then assemble `REPORT.md`, `FINDINGS-DETAIL.md`, `NEEDS-VALIDATION.md` from verified records only. The report must name which rounds were FULL and which DIFF, print the capture–recapture estimate, and state the verifier model family.

## 8.7 Always-check list

- [ ] Every route/action: authN present? authZ scoped **in the query**? (IDOR on every `:id`)
- [ ] Mass assignment: request bodies spread into `insert`/`update`?
- [ ] String-built SQL, `sql.raw`, dynamic `ORDER BY` or column names
- [ ] `dangerouslySetInnerHTML`, `href={userInput}` (`javascript:`), unvalidated `redirect()`, open redirect via `next=`
- [ ] SSRF in any server-side fetch with a user-influenced URL; DNS rebinding; redirects
- [ ] CSRF on cookie-authed mutations; server-action origin checks; CORS wildcards with credentials
- [ ] Cookie flags; session fixation; logout invalidation; reset-token entropy, expiry, single use; user enumeration
- [ ] Rate limits on login, signup, reset and expensive endpoints; bypass via `X-Forwarded-For`
- [ ] Unbounded: pagination, body size, uploads, array lengths, regex (ReDoS), JSON depth, query cost, concurrency
- [ ] Errors and logs leaking secrets, SQL, stack traces, tokens, PII; secrets in the client bundle, git history, source maps
- [ ] Races on balance/quota/uniqueness; replay of idempotent-intended actions
- [ ] Caches keyed without user identity; shared module-level state in server code
- [ ] Uploads: type sniffing, traversal, SVG scripts, content-disposition
- [ ] Dependencies: advisories, install scripts, typosquats, unpinned ranges, abandoned packages
- [ ] Headers and CSP effectiveness, tested with a real injected payload
- [ ] Debug endpoints, seed data, default credentials in the production build; `/api/health` leakage
- [ ] AI/LLM (only if present): prompt injection from stored content, tool authority, output rendered as HTML, cross-user context, exfiltration, cost abuse

## 8.8 Rounds and the stop rule

1. **Round 1: FULL.**
2. Patch (`09`).
3. **Round 2: FULL**, different hunter partition and ledger order, different model if available. The prior ledger marks unexamined units only; units whose files changed are reopened.
4. If round 2 found new confirmed findings: patch, then **Round 3: FULL**. If it found none: **Round 3: DIFF** on the patched files and their callers.
5. Estimate from the two independent FULL rounds:

   ```bash
   node pipeline/tools/estimate.mjs --a <nA> --b <nB> --m <overlap>
   node pipeline/bin/pipeline.mjs estimate --a … --b … --m … --write     # persist to docs/12-eval/estimate.json
   ```

6. **Stop** when a FULL round yields 0 new confirmed findings **and** expected remaining ≤1, or after three FULL rounds. Everything left goes to `NEEDS-VALIDATION.md` with the estimate printed in the report.

State in the report that the estimate assumes independent hunts and equally findable bugs, so it is an **optimistic** bound.

## Done when

- [ ] `entrypoints.json` ⊆ ledger units (script output attached)
- [ ] Every scanner lead confirmed, refuted or deferred with a reason
- [ ] Every confirmed finding has a tier and, for T1, a failing test committed and tagged `@finding`
- [ ] `validate-findings.mjs` and `coverage-gate.mjs` pass
- [ ] The report says which rounds were FULL and which were DIFF, and names the verifier family or states `NOT_VERIFIED`

NEVER: report a DIFF round as proof the codebase is clean. Never turn a scanner lead into a finding without a trace.
