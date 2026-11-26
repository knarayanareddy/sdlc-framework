# v2-11 · Deploy + post-deploy verification

Input: release-candidate commit, `docs/RUNBOOK.md`, `docs/FINAL-REPORT.md`
Output: `docs/11-deploy/{deploy-log.md, smoke-results.md, rollback-drill.md, alerts-test.md}`
Gate: **G11**. Where there is no staging target, every item is `NOT_VERIFIED` with the exact human command.

```bash
node pipeline/bin/pipeline.mjs phase start 11
# with no staging target, say so honestly:
node pipeline/bin/pipeline.mjs gate G11 --not-verified \
  --reason "no staging target is available in this environment" \
  --human-command "curl -sI https://staging.example/.well-known/build-id"
node pipeline/bin/pipeline.mjs phase done 11
```

ROLE: release engineer. Prove the thing that was tested is the thing that is running.

## Checks

1. **Artifact identity.** Record the commit SHA, lockfile hash and build id in the deploy log. After deploy, `/api/health` (or a version endpoint) must return the recorded build id, and must not reveal dependency versions, stack traces, hostnames or env names.
2. **Staging first.** Production-shaped config (same env var *names*, different values). Run migrations against a **copy of representative data**, not an empty database.
3. **Smoke journey.** Walking-skeleton e2e against the staging URL, then the P0 flows from `jtbd.md`. Three consecutive green runs.
4. **Headers and cookies on the real host.** Assert CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `frame-ancestors` and cookie flags on the deployed origin. Test CSP with a real injected payload, not by reading the header.
5. **Rollback drill.** Roll back to the previous build; verify the health build id changed; verify data written by the new build is still readable (or document why not); roll forward again.
6. **Migration safety.** Prove the previous build still works against the new schema (expand/contract). If it cannot, record the rollback limitation in the runbook.
7. **Alert test.** Trigger one synthetic failure (kill the DB connection on staging, or return 500 from a test route). Show the alert or log line that would page a human. If none exists, that is a defect.
8. **Canary** where the platform supports it: 5% of traffic for a fixed window, with error-rate and latency thresholds written down **before** you start.
9. **Config drift.** Diff the staging and production env var *names* and feature flags; list and justify every difference.

## GATE G11

- [ ] Deployed build id equals the tested commit
- [ ] Smoke and P0 flows green ×3 on staging
- [ ] Headers and cookies verified on the deployed origin
- [ ] Rollback drill completed with results recorded
- [ ] An alert fired in the test, or the gap is a logged defect
- [ ] Anything not run is `NOT_VERIFIED` with the exact command

NEVER: deploy from a dirty tree. Test rollback only on paper. Claim monitoring works without making it fire.
