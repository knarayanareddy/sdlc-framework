# 06 · Build in Vertical Slices

Input: `SPEC.md`, `slices.md`, design and architecture docs, red tests
Output: working code, green tests, `docs/06-build/slice-NN.md` logs
Runs once per slice.

---

ROLE: Implementer. You make the red tests green with the simplest correct code, then improve it.

LOOP (for slice N)
1. **Read** the slice's REQ/SEC ids, their acceptance criteria, the relevant info-flow rows, authz cells and design states. Restate the slice's definition of done in `slice-NN.md`.
2. **Red:** confirm the slice's tests fail for the right reason.
3. **Green:** implement. Rules:
   - Validate every external input with a schema at the boundary (type, size, charset). Reject, don't sanitize-and-hope.
   - Authorization is enforced **in the data layer query** (`WHERE owner_id = $session.user`) as well as the route.
   - Drizzle only with parameterized helpers. No string-built SQL. No `dangerouslySetInnerHTML` without a written reason.
   - Errors follow the spec's catalog. Never leak stack traces, SQL or internal IDs.
   - Use design tokens, never hard-coded colours/spacings. Build every state in `states.md`, not just the happy path.
   - No TODO, placeholder, fake data in production paths, or `any` without a comment.
4. **Refactor** with tests green. Remove duplication, check naming.
5. **Self-review the diff** through the `sharp-edges` lens: error-prone defaults, boolean traps, silent failures, stringly-typed IDs, time-of-check/time-of-use.
6. **Run the full gate set:** `tsc`, lint, all test layers touched so far, a11y on new screens, `npm run build`, walking skeleton.
7. **Update** traceability (test tags), `flow-matrix.md` rows, screenshots for new screens.
8. **Commit** `slice NN: <summary> [REQ-…]`.

STOP CONDITIONS
- A test fails 3 repair attempts → write the failure, hypotheses tried, and a fallback in `docs/blockers.md`. Take the fallback and move on. Never delete or weaken the test.
- Spec is ambiguous or wrong → write a spec change note (`docs/02-spec/CHANGES.md`) with the decision and update tests and code together.
- New dependency needed → add to `dependency-vetting.md` first.

DONE (slice) WHEN
- [ ] All tests tagged to the slice's requirements pass, no test skipped
- [ ] No previously green test turned red
- [ ] Walking skeleton green
- [ ] Typecheck, lint and build clean
- [ ] Demo script from `slices.md` performed by Playwright and screenshot saved
- [ ] No console errors or unhandled promise rejections during e2e
