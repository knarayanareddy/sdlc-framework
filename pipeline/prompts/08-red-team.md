# 08 · Red Team (Cloudflare security-audit-skill 6 phases + Trail of Bits lenses)

Input: repo at HEAD, `docs/04-architecture/*` (as *claims to test*, not as truth), previous run's ledger if any
Output: `docs/08-redteam/run-N/{architecture.md, coverage-ledger.json, findings.json, REPORT.md, FINDINGS-DETAIL.md, NEEDS-VALIDATION.md}` plus `tests/security/*.test.ts`
Gate: feeds G9.

Install first (see each repo's README): `cloudflare/security-audit-skill`, `trailofbits/skills` (plugins: spec-to-code-compliance, sharp-edges, variant-analysis, differential-review, fp-check, insecure-defaults, supply-chain-risk-auditor, post-patch-validation).
**Run every sub-phase below in a fresh session or sub-agent.** If sub-agents aren't available, run the phases sequentially in separate sessions and pass only the files named.

---

## 8.0 Orchestrator prompt

Audit this repository in **full audit mode, standard profile** (use `deep` if it handles money, PII or multi-tenant data) following `security-audit-skill`'s six phases. Write all artifacts to `docs/08-redteam/run-N/`.
If a previous run exists, read its `coverage-ledger.json` and `findings.json`, revalidate changed code, and target gaps. Do not treat stale coverage as covered. Do **not** modify product code in this phase except to add reproduction tests under `tests/security/`. You may execute the app only inside the sandbox. If no sandbox exists, mark dynamic confirmations `needs_validation`.

## 8.1 Phase 1: Reconnaissance (agent R)

Map from the **code**, not the docs: stack, entry points (every `route.ts`, server action, middleware, page with params, form, webhook, cron, env var, DB-sourced user content), trust boundaries, authN/authZ mechanism, data stores, third-party calls, build and CI config. Then diff against `docs/04-architecture/threat-model.md` and list **every divergence** (undocumented endpoints, missing controls). Write `architecture.md` and `coverage-ledger.json` (unit = subsystem × boundary × attack class). Run the skill's ledger validator.
Select companion attack-class files by what exists: always WEB-PROTOCOL-AND-AUTH, CLIENT-SIDE, DATA-ISOLATION, RESOURCE-EXHAUSTION, SUPPLY-CHAIN, plus the general ATTACK-CLASSES (injection, access control, business logic, feature abuse, chained trust, "obvious things"). Add AI-AND-LLM **only** if the code calls a model. Add CLOUD if IaC or deploy config is present.

## 8.2 Phase 2: Coverage-led hunting (hunters H1…Hn, then critics)

One isolated hunter per group of ledger units. Each hunter prompt contains: role, `architecture.md` verbatim, assigned unit IDs, the **verbatim text** of the relevant attack-class blocks (not just their names), exclusions, and the results contract.
Each hunter works from a **concrete invariant**:
1. Name the lower-trust principal and starting capability.
2. Name the accepted value, action, state transition or resource selector.
3. Locate the control that should reject, bind, isolate, limit or revoke it.
4. Trace the exact path after that decision, **end to end across trust boundaries**.
5. Stop at the smallest observable effect (dummy record, wrong return, shared-resource effect).
6. State the source-level fix and the regression test.
Trail of Bits lenses applied by hunters: **sharp-edges** (dangerous defaults, footgun APIs, fail-open config, boolean traps), **variant-analysis** (for every candidate, grep the codebase for the same pattern), **insecure-defaults**.
After each wave, **coverage critics** (fresh) list ledger units not actually examined and entry points absent from the ledger; run another wave until the critic finds no material gap or the budget is hit.

## 8.3 Phase 3: Candidate validation (verifiers V, fresh, did not hunt)

For each unique candidate: "You did not write this. **Try to refute it.**" The verifier must re-read every cited location, re-run any decisive check, and look for a control the hunter missed (framework default, middleware, DB constraint, schema validation, CSP). Use `fp-check` gates. Verdicts: `confirmed` (complete source trace **and** an observed result), `needs_validation` (name the single missing fact), `rejected` (write why, so future runs skip it).

## 8.4 Reproduction tests (mandatory for every `confirmed`)

Write a **deterministic** test in `tests/security/<id>-<slug>.test.ts`, tagged `// @req SEC-…` and `// @finding F-nn`:
- Real DB, no mocks of the vulnerable component, fixed clock and seed.
- It must **fail on the current commit** with an assertion that shows the vulnerable behaviour (not a crash or setup error). Capture the failing output in the finding.
- Minimal attacker capability, smallest dummy data.
- It becomes a permanent regression test after the fix.
If a test cannot be written, the finding is `needs_validation`, not `confirmed`.

## 8.5 Phase 4: Structured output

Write `findings.json` to the skill's schema (severity from real impact: who can do what to whom, with what precondition). Run `validate-findings.cjs`. Discard malformed agent output. Do not repair it.

## 8.6 Phase 5: Independent record verification (fresh agents)

Re-check every final claim against source. Any substantive edit goes to yet another fresh verifier.

## 8.7 Phase 6: Report

Assemble `REPORT.md`, `FINDINGS-DETAIL.md`, `NEEDS-VALIDATION.md` from verified records only.

## 8.8 Trail of Bits spec-to-code pass (separate agent)

Using `SPEC.md` SEC/NFR and the threat model as the specification, run `spec-to-code-compliance`. One agent per SEC requirement: find the implementing code, try to refute any divergence, and cite lines. Divergences become candidates that enter 8.3.

## 8.9 Always-check list (the "obvious things")

- [ ] Every route/action: authn present? authz scoped **in the query**? (IDOR on every `:id`)
- [ ] Mass assignment: are request bodies spread into `db.update/insert`?
- [ ] SQL built from strings; `sql.raw`; dynamic `ORDER BY`/column names
- [ ] `dangerouslySetInnerHTML`, `href={userInput}` (javascript: URLs), unvalidated `redirect()`, open redirect via `next=`
- [ ] SSRF in any server-side fetch with user-influenced URL; DNS-rebinding and redirects
- [ ] CSRF on cookie-authed mutations; server actions origin checks; CORS wildcards with credentials
- [ ] Cookie flags; session fixation; logout invalidation; password reset token entropy, expiry and single-use; user enumeration via timing or message
- [ ] Rate limits on login, signup, reset, expensive endpoints; limit bypass via headers (`X-Forwarded-For`)
- [ ] Unbounded: pagination, body size, upload size, array lengths, regex (ReDoS), JSON depth, query cost, concurrent jobs
- [ ] Errors/logs leaking secrets, SQL, stack traces, tokens, PII; secrets in client bundle (`NEXT_PUBLIC_*`), in git history, in source maps
- [ ] Race conditions on balance/quota/uniqueness; replay of idempotent-intended actions
- [ ] Caches/ISR/`fetch` caching keyed without user identity (cross-user bleed); shared module-level state in server code
- [ ] File upload: type sniffing, path traversal, SVG scripts, content-disposition
- [ ] Dependencies: advisories, install scripts, typosquats, unpinned ranges, abandoned packages; CI secrets exposure
- [ ] Security headers and CSP effectiveness (test with a real injected payload, not just header presence)
- [ ] Debug endpoints, seed data or default credentials left in production build; `/api/health` information leakage
- [ ] AI/LLM (only if present): prompt injection from stored user content, tool-call authority, output rendered as HTML/markdown links, cross-user context leakage, secret exfiltration, cost/token abuse

## 8.10 Rounds

Run 08 at least twice per release candidate: once on the full repo, once after patches (differential). The authors report a single run finds about half of what repeated runs find. Stop when a full round yields 0 new `confirmed` findings, or after 3 rounds. Remaining items go to `NEEDS-VALIDATION.md` for a human.

## Done when

- [ ] Ledger validator and findings validator both pass
- [ ] Every ledger unit is `examined` or has a reason it isn't
- [ ] Every `confirmed` finding has a failing repro test committed
- [ ] Every `rejected` finding states its disproof
