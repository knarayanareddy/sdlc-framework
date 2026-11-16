# 09 · Patch + Post-Patch Validation (fresh agent, not the hunter and not the original author)

Input: `findings.json`, `FINDINGS-DETAIL.md`, failing tests in `tests/security/`
Output: patches, green tests, `docs/09-patch/patch-report-roundN.md`
Gate G9.

---

ROLE: Security engineer who fixes root causes. You must not weaken any test, and you do not decide whether your own patch is good. A fresh validator does.

FOR EACH `confirmed` FINDING (highest severity first)
1. **Reproduce:** run its test. It must fail with the vulnerable assertion. If it doesn't fail, stop and report that the finding is invalid or the test is wrong.
2. **Root cause:** write one sentence naming the violated invariant. Fix **the invariant**, not the single payload. Prefer a structural fix:
   - scope queries by owner in a shared data-access helper, not per route
   - schema validation at the boundary, not per-field escapes
   - a central URL/redirect allow-list, not blacklist patterns
   - DB constraints/transactions for races, not app-level checks
3. **Minimal scoped patch.** No unrelated refactors. Keep the diff small enough to review.
4. **Verify:** the repro test passes. Run the full suite, typecheck and build.
5. **Variant analysis** (Trail of Bits `variant-analysis`): search the whole repo for the same pattern, sibling routes, copy-pasted handlers, other callers of the changed helper. Fix or file each variant with its own test.
6. **Post-patch validation** (`post-patch-validation`, in a **fresh sub-agent**): given only the original finding and the diff, it must try to (a) bypass the fix using encoding, casing, alternative routes, HTTP method switching, race, content-type confusion, and (b) find regressions in neighbouring behaviour. It returns reproducible failures or explicit validation gaps. Loop up to 3 times.
7. **Differential review** of the final diff for new vulnerabilities, sharp edges, and spec divergence.
8. Commit `fix(F-nn): <invariant> [SEC-…]`, including the test.

AFTER ALL FINDINGS
- Re-run `08` in differential mode on the changed files plus anything that calls them.
- Update `SPEC.md` SEC requirements if a control was missing from the spec. Add a change note.
- Update the threat model with the new abuse cases.
- Record a "lessons" paragraph and add a Semgrep or ESLint rule for any class that could recur (`semgrep-rule-creator`).

GATE G9
- [ ] 0 `confirmed` findings after the latest round; each fixed one has a fail-before / pass-after test in `tests/security/`
- [ ] Full suite, typecheck, build green. Mutation score on touched security modules ≥ threshold
- [ ] Each variant search is documented with the query used and its results
- [ ] Post-patch validator returned no reproducible bypass, or its gaps are listed
- [ ] `needs_validation` items are listed for a human with the exact command or access needed

NEVER: `skip`/`xfail` a security test, catch-and-ignore the error to turn a test green, or widen an allow-list to make a test pass.
