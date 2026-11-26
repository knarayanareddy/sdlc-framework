# v2-06 · Build in vertical slices

Input: `SPEC.md` (frozen), `slices.md`, design and architecture docs, red tests, frozen baseline
Output: working code, green tests, `docs/06-build/slice-NN.md`, `docs/06-build/slice-NN-tripwire.log`, `docs/blockers.md`
Gate: none of its own — this phase is rolling. Its exit check is "at least one slice log exists, and every REQ/SEC/NFR id is cited by some slice", enforced by `phase done 06`.

```bash
node pipeline/bin/pipeline.mjs phase start 06
# per slice, after green:
node pipeline/bin/pipeline.mjs gate G5 --builtin trace:check          # cheaper than the full tripwire, still mechanical
node pipeline/tools/tripwire.mjs --config pipeline.config.json --log docs/06-build/slice-NN-tripwire.log
node pipeline/bin/pipeline.mjs phase done 06
```

ROLE: implementer. Make the red tests green with the simplest correct code, then improve it.

## Loop (per slice N)

1. **Read** the slice's REQ/SEC ids, their acceptance criteria, the info-flow rows, authz cells and design states. Restate the definition of done in `slice-NN.md`.
2. **Red:** confirm the slice's tests fail for the right reason.
3. **Green.** Rules:
   - Validate every external input with a schema at the boundary (type, size, charset). Reject; do not sanitize and hope.
   - Authorization is enforced **in the data-layer query** (`WHERE owner_id = $session.user`) as well as at the route.
   - Parameterized queries only. No string-built SQL. No `dangerouslySetInnerHTML` without a written reason.
   - Errors follow the spec catalog. Never leak stack traces, SQL or internal ids.
   - Use design tokens, never hard-coded colours or spacings. Build every state in `states.md`, not only the happy path.
   - No TODO, placeholder, fake data in a production path, or `any` without a comment.
4. **Refactor** with tests green.
5. **Self-review the diff** through the sharp-edges lens: error-prone defaults, boolean traps, silent failures, stringly-typed ids, time-of-check/time-of-use.
6. **Tripwire** (part 2 of `v2-05`) — all rows green or explicitly `NOT_VERIFIED` with the command a human must run.
7. **Boundary slices only:** if the slice touches authentication, authorization, a new route or server action, a data boundary, file handling, a redirect or an outbound fetch, or adds a dependency, spawn a **fresh reviewer** (different model family where available) with only the diff, the slice's SEC ids and the threat model. It reports candidates with file:line; it does not fix. Candidates become red tests.
8. **Update** traceability tags, `flow-matrix.md` rows, and screenshots for new screens.
9. **Commit** `slice NN: <summary> [REQ-…]`.

## Stop conditions

- A test fails three repair attempts → `pipeline blocker add --phase 06 --text "…" --fallback "…"`, take the fallback, move on. Never delete or weaken the test.
- The spec is ambiguous or wrong → write `docs/02-spec/CHANGES.md`, then `pipeline freeze --refreeze`; update tests and code together.
- A new dependency is needed → `dependency-vetting.md` first, then install with `--ignore-scripts` unless allowlisted.

## Done (slice)

- [ ] All tests tagged to the slice's requirements pass; no test skipped
- [ ] No previously green test turned red (`trace-check-v2 --check-baseline` proves it)
- [ ] Walking skeleton green
- [ ] Typecheck, lint, build clean
- [ ] Tripwire log written, all rows green or `NOT_VERIFIED` with a human command
- [ ] Demo script from `slices.md` performed by Playwright; screenshot saved
- [ ] No console errors or unhandled rejections during e2e

NEVER: edit a test to make it pass. Never mark a gate green yourself — the orchestrator runs it.
