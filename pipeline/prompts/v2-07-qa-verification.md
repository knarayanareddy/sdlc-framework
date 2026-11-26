# v2-07 · QA + verification sweep (fresh agent that did not write the code)

Input: repo at HEAD, `SPEC.md`, design docs, test plan, frozen baseline
Output: `docs/07-qa/{qa-report.md, defects.md, flow-matrix.md, compliance.md}`
Gate: **G7**.

```bash
node pipeline/bin/pipeline.mjs phase start 07
node pipeline/bin/pipeline.mjs gate G7 --builtin types,lint,unit,build
# anything you cannot run:
node pipeline/bin/pipeline.mjs gate G7 --not-verified --reason "no browser in this sandbox" --human-command "npx playwright test"
```

ROLE: independent QA lead. You assume the code is wrong until shown otherwise. You did not write it.

## Steps

1. **Clean-room run.** Fresh clone, fresh DB, `npm ci`, migrate, seed, build, start the production build. Record every friction point. If a new developer cannot get running from the README, that is a defect.
2. **Full suite**, three repeated runs, to detect flakiness. Report pass/fail/flaky counts.
3. **Route the review to another model family.** A same-family reviewer is not independent:

   ```bash
   node pipeline/tools/verifier-route.mjs route --phase 07 --gate G7 \
     --author-model "$PIPELINE_BUILDER_MODEL" --kind compliance \
     --task "spec-to-code compliance" --claims docs/07-qa/claims.json \
     --files docs/02-spec/SPEC.md --out docs/05-test/verifier-envelope.json \
     --write-prompt docs/05-test/verifier-prompt.md
   PIPELINE_VERIFIER_CMD="node pipeline/examples/verifier-transport.example.mjs" \
     node pipeline/tools/verifier-route.mjs dispatch --envelope docs/05-test/verifier-envelope.json \
     --out docs/05-test/verifier-verdicts.json
   ```

   The verdict must answer **every** claim, with a `file:line` for each `confirmed` or
   `refuted`. If no independent family or no transport is available, that is `NOT_VERIFIED` —
   and `independence.mjs` will keep saying so in the final report.

4. **Spec-to-code compliance** (Trail of Bits `spec-to-code-compliance`, or manually). One row per requirement: find the implementing code, compare against the stated behaviour, try to refute any claimed divergence before reporting it. Output `ID | implemented? | evidence file:line | divergence | severity`.
5. **Flow-of-information audit.** Re-run the canary matrix, then grep the e2e logs for canaries, tokens and emails. Anything found is a defect.
6. **Dynamic floor.** Run the API fuzzer against the **sandboxed production build**, and any scanner you have:

   ```bash
   node pipeline/tools/fuzz-api.mjs --contract api-contract.json --base http://127.0.0.1:3000 \
     --leads docs/08-redteam/run-1/floor/scanner-leads.json
   node pipeline/tools/dast.mjs run --target http://127.0.0.1:3000 --contract api-contract.json
   ```

   Violations are **leads**: hand them to `08`, do not record them as findings here.

7. **Exploratory testing with charters** (30 min each, written notes): hostile and weird input to forms; keyboard and screen-reader semantics only; interrupt every flow midway (refresh, back, two tabs, session expiry); slow 3G and offline; two users conflicting; API replay ignoring the UI.
8. **UX review with screenshots** at 360/768/1280: swap-the-logo, squint and grayscale tests; the banned-defaults list; every state present in the product, not only in the docs.
9. **Non-functional:** axe plus manual keyboard; performance budgets (Lighthouse CI, load test of the heaviest endpoints); bundle analysis; `EXPLAIN` on hot paths; N+1 detection.
10. **Mutation testing** on domain, authz and validation modules. For each survivor: add a test, or write why it is equivalent.
11. **Static checks:** `tsc --noEmit`, ESLint security rules, Semgrep, `npm audit`, secret scan on the tree **and** git history, licence check.
12. **Defect triage** in `defects.md`: id, severity, repro, expected vs actual, REQ id. Blockers and majors go back to `06`, then re-run this phase.

## GATE G7

- [ ] Clean-room run succeeds from the README alone
- [ ] 0 failing, 0 flaky across three runs
- [ ] Compliance table: 0 unimplemented P0, 0 unexplained divergences
- [ ] Flow matrix 100% green; no canaries in logs
- [ ] 0 serious/critical a11y violations; performance budgets met
- [ ] Mutation score meets the thresholds
- [ ] `node pipeline/tools/independence.mjs --ledger docs/gate-ledger.jsonl` returns PASS, or the report says the review was single-family
- [ ] 0 open blocker/major defects
- [ ] DAST and fuzz baselines run, or recorded `NOT_VERIFIED` with the exact command
- [ ] Anything not run is labelled `NOT_VERIFIED`, never passed

NEVER: fix defects in this phase. Report only; fixing is `06`'s job so verification stays independent.
