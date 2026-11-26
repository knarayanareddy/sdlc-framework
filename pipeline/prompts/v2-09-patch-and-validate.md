# v2-09 · Patch + post-patch validation (a fresh agent, not the hunter and not the author)

Input: `findings.json`, `FINDINGS-DETAIL.md`, failing tests in `tests/security/`
Output: patches, green tests, `docs/09-patch/patch-report-roundN.md`
Gate: **G9**.

```bash
node pipeline/bin/pipeline.mjs phase start 09
node pipeline/bin/pipeline.mjs gate G9 --builtin findings,coverage
node pipeline/bin/pipeline.mjs phase done 09
```

ROLE: security engineer who fixes root causes. You must not weaken any test, and you do not decide whether your own patch is good. A fresh validator does.

## Per `confirmed` finding (highest severity first)

1. **Reproduce.** Run its test. It must fail with the vulnerable assertion. If it does not, stop and report that the finding is invalid or the test is wrong.
2. **Root cause.** One sentence naming the violated invariant. Fix **the invariant**, not the payload. Prefer structural fixes:
   - scope queries by owner in a shared data-access helper, not per route;
   - schema validation at the boundary, not per-field escapes;
   - a central URL/redirect allow-list, not blacklist patterns;
   - DB constraints and transactions for races, not app-level checks.
3. **Minimal scoped patch.** No unrelated refactors. Small enough to review.
4. **Verify.** The repro test passes. Full suite, typecheck and build pass. `trace-check-v2 --check-baseline` still passes.
5. **Variant analysis** (`variant-analysis`): search the whole repo for the same pattern — sibling routes, copy-pasted handlers, other callers of the changed helper. Fix or file each variant with its own test, and record the query you searched with.
6. **Mutation of the fix.** The fix must survive mutation of its own invariant: if deleting the new check leaves every test green, the test is not testing the fix.
7. **Post-patch validation** (`post-patch-validation`, fresh sub-agent). Given only the original finding and the diff, it must try to (a) bypass the fix with encoding, casing, alternative routes, method switching, races and content-type confusion, and (b) find regressions in neighbouring behaviour. Loop up to three times.
8. **Differential review** of the final diff for new vulnerabilities, sharp edges and spec divergence.
9. **Commit** `fix(F-nn): <invariant> [SEC-…]`, including the test.

## After all findings

- Re-run `08` in differential mode on the changed files plus anything that calls them.
- If a control was missing from the spec, add the SEC requirement and a change note.
- Update the threat model with the new abuse cases.
- Write the lessons paragraph. For any class that could recur, add a Semgrep or ESLint rule (`semgrep-rule-creator`).

## GATE G9

- [ ] 0 `confirmed` findings after the latest **FULL** round; every fixed one has a fail-before / pass-after test in `tests/security/`
- [ ] `validate-findings.mjs` passes, and the findings file records the round as FULL
- [ ] Full suite, typecheck, build green; mutation score on the touched security modules ≥ threshold
- [ ] Each variant search documented with the query used and its results
- [ ] The post-patch validator returned no reproducible bypass, or its gaps are listed
- [ ] `needs_validation` items are listed for a human with the exact command or access needed

NEVER: `skip`/`xfail` a security test. Catch-and-ignore an error to make a test green. Widen an allow-list to make a test pass. Record G9 on the strength of a DIFF round.
