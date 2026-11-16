# 10 · Release Readiness + Handoff

Input: whole repo and `docs/`
Output: `docs/FINAL-REPORT.md`, `README.md`, `.env.example`, `docs/RUNBOOK.md`
Gate G10.

---

ROLE: Release manager. Your job is to prevent surprises for the person receiving this.

CHECKS (run them, don't recall them)
- [ ] `npx next typegen`, `tsc --noEmit`, `npm run build` pass
- [ ] Production server starts; `/api/health` returns 200 and **reveals no internals**
- [ ] Clean-room install from README succeeds in a fresh directory and DB
- [ ] Full suite on a clean DB: unit, int, e2e, a11y, security, resilience. 3 consecutive green runs
- [ ] Traceability: `node pipeline/tools/trace-check.mjs docs/02-spec/SPEC.md tests` exits 0, so **every requirement has a passing test**
- [ ] Final `spec-to-code-compliance` pass shows 0 P0 divergences
- [ ] Final red-team round has 0 confirmed findings (`08` + `09`)
- [ ] `npm audit` has no high/critical with a fix available; lockfile committed; SBOM generated (`npx @cyclonedx/cyclonedx-npm`)
- [ ] Secret scan on the working tree **and git history**; `.env` in `.gitignore`; `.env.example` complete
- [ ] No debug routes, no seed credentials enabled in production mode; source maps policy decided
- [ ] Migrations are forward-safe and a rollback/restore procedure is documented and was tried
- [ ] Backups, data retention and deletion path described
- [ ] Observability: structured logs, error tracking hook, health check, key metrics listed; no PII in logs
- [ ] Final UX walkthrough with fresh screenshots at 3 breakpoints; swap-the-logo test passes; all states present
- [ ] Performance and a11y budgets re-verified on the production build
- [ ] README: what it is, run it, test it, env vars, architecture map, how the pipeline artifacts are laid out
- [ ] Licences of all dependencies are compatible with intended use

FINAL-REPORT.md MUST CONTAIN
1. What was built (against thesis and P0 requirements, with pass/fail)
2. Gate results G1-G10 with evidence links
3. Test summary: counts per layer, mutation score, flake runs, flow-matrix result
4. Security summary: red-team rounds, findings by severity, fixes, residual `needs_validation`
5. **`NOT_VERIFIED` list** with the exact human command or access needed
6. Known limitations and deliberate trade-offs (link to ADRs and assumptions)
7. Assumptions I made that you may want to overrule (top 5, from `assumptions.md`)
8. What to measure after launch to validate the riskiest assumption in `thesis.md`
9. Post-release loop: real-user feedback channel, telemetry plan, dependency-update cadence (Renovate/Dependabot), re-audit trigger (any change to auth, data model or dependencies)

NEVER: state "no vulnerabilities". State what was tested, how many rounds, and what remains unverified.
