# v2-05 · Test integrity (amends `05`) and per-slice tripwire (amends `06`)

Input: `docs/02-spec/SPEC.md`, `pipeline/tools/trace-check-v2.mjs`, `docs/00-control/protected-paths.txt`
Output: `docs/05-test/baseline.json`, tripwire script `pipeline/tools/tripwire.sh`, per-slice `docs/06-build/slice-NN-tripwire.log`
Status: `trace-check-v2` and its baseline mode are **BUILT and self-tested**. The tripwire script is **SPECIFIED**.

---

## Part 1 · Test integrity (phase 05)

1. Replace `trace-check.mjs` with `trace-check-v2.mjs` everywhere in the pipeline. Run `node content/tools/trace-check-v2.selftest.mjs` once. It must report all behaviours as expected before the tool is trusted.
2. Write the failing tests from Given/When/Then. Tags go on their own comment line: `// @req SEC-004`.
3. Record the red run, then **freeze**:
   `node pipeline/tools/trace-check-v2.mjs docs/02-spec/SPEC.md tests --allow-uncovered --baseline docs/05-test/baseline.json`
4. From now on, every gate in 06 to 10 includes:
   `node pipeline/tools/trace-check-v2.mjs docs/02-spec/SPEC.md tests --allow-uncovered --check-baseline docs/05-test/baseline.json`
   Deleted test files, lost assertions and new skips fail the gate. New test files are always allowed.
5. A legitimate test change (wrong test) goes in its own commit, with the reason in `docs/test-changes.md` and a **re-baseline by the orchestrator, not the builder**.
6. Property-based tests (fast-check) count as assertions via `fc.assert(`. A property with no shrinkable input is a smell: review it.

## Part 2 · Per-slice tripwire (phase 06, after the slice is green, before commit)

Deterministic, target ≤10 minutes. All must pass:

| Check | Command (default Next.js stack) | Fails on |
|---|---|---|
| Types, lint, build | `tsc --noEmit`, `eslint .`, `npm run build` | any error |
| Trace + baseline | `trace-check-v2` as above | any problem line |
| SAST | `semgrep --config p/owasp-top-ten --config p/typescript --error` (or CodeQL via Trail of Bits `static-analysis`) | any new finding not in `docs/06-build/semgrep-accepted.json` with a reason |
| Secrets | `gitleaks detect --no-banner` | any hit |
| Dependencies | `osv-scanner --lockfile package-lock.json` or `npm audit --audit-level=high` | high or critical with a fix available |
| Incremental mutation | `stryker run --mutate "<files changed in this slice>"` | score below the threshold for the module class (auth, authz, validation ≥ 85%; other domain ≥ 70%) |
| Walking skeleton | the e2e from `05` | red |

Surviving mutants: add a test that kills each one, or write why it is equivalent in the slice log. Do not lower the threshold.

## Part 3 · Fresh differential review (boundary slices only)

If the slice touches **authentication, authorisation, a new route or server action, a data boundary, file handling, a redirect or an outbound fetch, or adds a dependency**, spawn a fresh agent, different model family where available, with:
- the diff only (`git diff <base>..HEAD`), the SEC requirements of the slice, and `threat-model.md`
- Trail of Bits `differential-review`, `sharp-edges`, `insecure-defaults`
- task: try to break each new input handler; report candidates with file:line. It does not fix.

Candidates go back to the builder as red tests. Non-boundary slices skip Part 3.

DONE (slice) additionally requires: tripwire log with all rows green; mutation survivors resolved; Part 3 candidates (if any) resolved with tests.

NEVER: edit `baseline.json` in the build phase. Never mark a surviving mutant "equivalent" without a written argument.
