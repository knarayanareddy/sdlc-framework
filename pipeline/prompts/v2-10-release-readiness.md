# v2-10 · Release readiness + handoff

Input: the whole repo and `docs/`
Output: `docs/FINAL-REPORT.md`, `README.md`, `.env.example`, `docs/RUNBOOK.md`
Gate: **G10**.

```bash
node pipeline/bin/pipeline.mjs phase start 10
node pipeline/bin/pipeline.mjs report                      # writes docs/FINAL-REPORT.md from the ledger
node pipeline/bin/pipeline.mjs gate G10 --builtin ledger,progress,types,build
node pipeline/bin/pipeline.mjs phase done 10               # checks FINAL-REPORT.md, README.md, .env.example exist
```

ROLE: release manager. Your job is to prevent surprises for the person receiving this.

## Checks (run them, do not recall them)

- [ ] `npx next typegen`, `tsc --noEmit`, `npm run build` pass
- [ ] The production server starts and `/api/health` returns 200 **without revealing internals**
- [ ] Clean-room install from the README succeeds in a fresh directory and DB
- [ ] Full suite on a clean DB — unit, int, e2e, a11y, security, resilience — three consecutive green runs
- [ ] `trace-check-v2` with `--check-baseline` exits 0, so every requirement has a **base-lined, non-skipped** test
- [ ] Final `spec-to-code-compliance` pass shows 0 P0 divergences
- [ ] Final red-team round is FULL and has 0 confirmed findings; the estimate is in the report
- [ ] `npm audit` has no high/critical with a fix available; lockfile committed; SBOM generated (`npx @cyclonedx/cyclonedx-npm`)
- [ ] Secret scan on the working tree **and** git history; `.env` ignored; `.env.example` complete
- [ ] No debug routes; no seed credentials in production mode; source-map policy decided
- [ ] Migrations forward-safe; rollback/restore documented **and tried**
- [ ] Backups, retention and deletion paths described
- [ ] Observability: structured logs, error-tracking hook, health check, key metrics; no PII in logs
- [ ] Final UX walkthrough with fresh screenshots at three breakpoints; swap-the-logo passes; all states present
- [ ] Performance and a11y budgets re-verified on the production build
- [ ] README: what it is, how to run it, how to test it, env vars, architecture map, how the pipeline artifacts are laid out
- [ ] Dependency licences compatible with the intended use
- [ ] `pipeline verify` re-ran every recorded gate and found no drift

## FINAL-REPORT.md must contain

1. What was built, against the thesis and P0 requirements, with pass/fail.
2. Gate results G0–G12 with evidence links.
3. Test summary: counts per layer, mutation score, flake runs, flow-matrix result.
4. Security summary: rounds (FULL vs DIFF), findings by severity and tier, fixes, residual `needs_validation`.
5. The **`NOT_VERIFIED` list** with the exact human command or access needed.
6. Known limitations and deliberate trade-offs, linked to ADRs and assumptions.
7. The top five assumptions a human may want to overrule, from `assumptions.md`.
8. What to measure after launch to validate the riskiest assumption in `thesis.md`.
9. The post-release loop: feedback channel, telemetry plan, dependency-update cadence, re-audit trigger (any change to auth, data model or dependencies).
10. Whether planted-bug calibration has been run for this pipeline version. If not, say **"red team not calibrated"** next to any zero-finding claim.

`pipeline report` generates the skeleton from the ledger; you fill in the narrative. Do not hand-edit the gate table.

NEVER: state "no vulnerabilities". State what was tested, how many rounds, and what remains unverified.
