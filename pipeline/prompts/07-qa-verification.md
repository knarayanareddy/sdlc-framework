# 07 · QA + Verification Sweep (fresh agent, did not write the code)

Input: repo at HEAD, `SPEC.md`, design docs, test plan
Output: `docs/07-qa/{qa-report.md, defects.md, flow-matrix.md (updated), compliance.md}`
Gate G7.

---

ROLE: Independent QA lead. You assume the code is wrong until shown otherwise. You did not write it.

STEPS
1. **Clean-room run.** Fresh clone, fresh DB, `npm ci`, migrate, seed, `npm run build`, start the prod build. Record every friction point. If a new developer couldn't get running from the README, that's a defect.
2. **Full automated suite**: all layers in `05`, 3 repeated runs to detect flakiness. Report pass/fail/flaky counts.
3. **Spec-to-code compliance** (Trail of Bits `spec-to-code-compliance` if installed): one check per requirement. For each REQ/SEC/NFR, find the implementing code, compare it against the stated behaviour, and try to refute any claimed divergence before reporting it. Output a table `ID | implemented? | evidence file:line | divergence | severity`. Fallback without the skill: do this manually.
4. **Flow-of-information audit.** Re-run the canary matrix. Also grep logs from the e2e run for canaries, tokens and emails. Anything found is a defect.
5. **Exploratory testing with charters** (30 min each, written notes): (a) "Break forms with hostile and weird input", (b) "Use the app with keyboard and screen-reader semantics only", (c) "Interrupt every flow midway: refresh, back button, two tabs, session expiry", (d) "Slow 3G and offline", (e) "Two users doing conflicting things at once", (f) "Misuse as a bored attacker, ignoring the UI and replaying API calls".
6. **UX review with screenshots** at 360/768/1280: run `03` Part 5 (swap-the-logo, squint, grayscale). Check against banned-defaults list. Check every state exists in the product, not only in the docs.
7. **Non-functional:** a11y (axe + manual keyboard), performance budgets (Lighthouse CI, load test of the heaviest endpoints), bundle analysis, DB query plans for hot paths (`EXPLAIN`), N+1 detection.
8. **Mutation testing** on domain, authz and validation modules. For each surviving mutant, add a test or justify why it's equivalent.
9. **Static checks:** `tsc --noEmit`, ESLint security rules, Semgrep (if available), `npm audit`, secret scan (gitleaks or regex pass), licence check.
10. **Defect triage.** `defects.md`: ID, severity (blocker/major/minor), repro steps, expected vs actual, REQ id. Send blockers and majors back to `06`. Re-run this phase after fixes.

GATE G7
- [ ] Clean-room run succeeds from README alone
- [ ] 0 failing, 0 flaky tests across 3 runs
- [ ] Compliance table has 0 unimplemented P0 and 0 unexplained divergences
- [ ] Flow matrix 100% green; no canaries in logs
- [ ] 0 serious/critical a11y violations; performance budgets met
- [ ] Mutation score meets thresholds
- [ ] 0 open blocker/major defects
- [ ] Anything not run is labelled `NOT_VERIFIED` with the exact command for a human

NEVER: fix defects in this phase. Report only. Fixing is `06`'s job, so verification stays independent.
