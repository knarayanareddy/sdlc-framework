# v2-05 · Test strategy, the frozen baseline, and the per-slice tripwire

Input: `docs/02-spec/SPEC.md`, `docs/03-design/*`, `docs/04-architecture/*`
Output: `docs/05-test/{test-plan.md, red-baseline.log, baseline.json, flow-matrix.md}`, test harness, CI config
Gate: **G5**. The tripwire in part 2 runs in every slice of `06`.

```bash
node pipeline/bin/pipeline.mjs phase start 05
node pipeline/bin/pipeline.mjs gate G5 --builtin trace:freeze,trace:check,unit
node pipeline/bin/pipeline.mjs phase done 05
```

ROLE: test architect. Your goal is a suite that fails when the product is wrong, not one with a high coverage number.

## Part 1 · Test integrity

1. Configure the stack via the package tool, never by hand-editing `package.json`. Scripts: `test`, `test:int`, `test:e2e`, `test:sec`, `test:a11y`, `test:mutation`, `test:all`.
2. **Test database isolation:** real Postgres for integration tests, never mocks. A separate database or schema per worker; truncate or roll back between tests; factories, not shared fixtures. Refuse to run against a database whose name does not end `_test`.
3. **Tag every test** with the requirement it proves, on its own comment line:

   ```ts
   // @req SEC-004
   ```

   `trace-check-v2` only counts a tag on its own comment line, only in a file with ≥1 real assertion, and never in a file containing a skip.

4. **Write the tests first** from the Given/When/Then. They must fail for the right reason (feature absent, not setup error). Record the red run in `red-baseline.log`.
5. **Freeze the baseline.** After the red run:

   ```bash
   node pipeline/tools/trace-check-v2.mjs docs/02-spec/SPEC.md tests --allow-uncovered --baseline docs/05-test/baseline.json
   ```

   From then on every gate uses `--check-baseline`. Deleting a file, losing an assertion, or losing a test case fails the gate. New test files are always allowed.

6. A legitimate test change (the test was wrong) goes in its own commit with the reason in `docs/test-changes.md`, and the **orchestrator** re-baselines, not the builder.

## Layers (each has an exit criterion)

| Layer | What | Exit criterion |
|---|---|---|
| Unit | pure logic, validators, formatters | every branch of domain logic |
| Property | invariants: parse∘serialize identity, idempotency, monotonic totals, authorization never widens | ≥1 property per invariant |
| Integration | handlers against a real DB, constraints, transactions, rollbacks | every API contract row and status code |
| Contract | responses validated against the spec schema, unknown fields rejected | 100% of endpoints |
| E2E | one test per user job from an empty DB + seed | every P0 flow green |
| Information-flow | canary values through real entry points | matrix 100% |
| Authz matrix | generated from `authz-matrix.md`, plus cross-tenant attempts | every cell executed |
| Security regression | one file per finding, failing on the vulnerable code | created in 08/09 |
| Resilience | DB down, slow query, third-party 500, duplicate submit, partial failure | spec'd error state, no corruption |
| Concurrency | double-spend, lost update, parallel creates | invariants hold under `Promise.all` ×50 |
| Migration | fresh migrate, migrate with data, drift check | green |
| Accessibility | axe on every screen and state, keyboard-only walkthrough | 0 serious/critical |
| Visual | screenshot baselines at 3 breakpoints | reviewed, not blindly updated |
| Performance | budgets from NFRs | budgets met |
| Mutation | Stryker on domain, authz, validation | ≥70% overall, ≥85% on auth/authz/validation |

**Flow-of-information tests.** For each row of the spec's table: submit a unique canary (plus `<script>`, `' OR 1=1--`, `${7*7}`, unicode, 1 MB). Assert it arrives where the spec says, is transformed as specified, does not appear where forbidden (other users, logs, error bodies, URLs, analytics, caches, exports, as executable markup), and is deleted on schedule. Record `docs/05-test/flow-matrix.md` (row × sink × pass/fail).

**Walking skeleton.** One e2e that boots the production build, migrates and seeds, signs in, creates one record, reads it back, signs out, checks `/api/health`. Green before slice 1 and after every later commit.

**Quality rules.** No `sleep`; wait on conditions. Fixed clock and seeded randomness. A test that fails twice in 20 runs is quarantined and fixed in the same slice. One behaviour per test. Never assert on implementation details. Mocks only for third-party network — never the DB or your own modules in integration tests.

## Part 2 · Per-slice tripwire (runs in `06`, before every commit)

Deterministic, target ≤10 minutes.

```bash
node pipeline/tools/tripwire.mjs --config pipeline.config.json --log docs/06-build/slice-NN-tripwire.log
```

| Check | Fails on |
|---|---|
| `tsc --noEmit`, `eslint .`, `npm run build` | any error |
| `trace-check-v2 --check-baseline` | any problem line |
| Semgrep or CodeQL | a new finding not in `docs/06-build/semgrep-accepted.json` with a reason |
| gitleaks | any hit |
| osv-scanner / `npm audit --audit-level=high` | high or critical with a fix available |
| incremental mutation on the slice's changed files | below the module-class threshold |
| walking skeleton e2e | red |

A check whose tool is not installed is `NOT_VERIFIED`, never green, and `--strict` turns that into a failure for the release gate. Surviving mutants: add a test that kills each, or write why it is equivalent in the slice log. Do not lower the threshold.

## GATE G5

- [ ] `trace-check-v2` reports 0 requirements without a tagged test and 0 unknown ids
- [ ] Red baseline recorded; failures are "not implemented", not harness errors
- [ ] Baseline frozen and `--check-baseline` passes
- [ ] Walking skeleton e2e green
- [ ] CI runs lint, typecheck, unit, int, e2e, a11y, build
- [ ] Test plan lists known gaps honestly

NEVER: edit `baseline.json` in the build phase. Never mark a surviving mutant "equivalent" without a written argument.
