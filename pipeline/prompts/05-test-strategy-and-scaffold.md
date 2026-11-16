# 05 · Test Strategy + Scaffolding (tests before features)

Input: `docs/02-spec/SPEC.md`, `docs/03-design/*`, `docs/04-architecture/*`
Output: `docs/05-test/test-plan.md`, test harness, failing tests tagged to requirements, CI config
Gate G5.

---

ROLE: Test architect. Your goal is a suite that fails when the product is wrong, not one that merely has a high coverage number.

TASK
1. **Install and configure** (via the package tool, never by editing `package.json`): Vitest, @testing-library/react, fast-check, Playwright, @axe-core/playwright, Stryker (mutation), msw if third parties exist. Add npm scripts: `test`, `test:int`, `test:e2e`, `test:sec`, `test:a11y`, `test:mutation`, `test:all`.
2. **Test DB isolation:** real Postgres, not mocks, for integration tests. Use a separate database or schema per worker and truncate or roll back between tests. Seed with builders (factories), not shared fixtures.
3. **Tag every test** with the requirement it proves: a comment `// @req REQ-012` or `// @req SEC-004` (multiple allowed). `tools/trace-check.mjs` reads these.
4. **Write the tests first from the Given/When/Then.** They must **fail for the right reason** (feature absent), not for setup errors. Record the red run in `docs/05-test/red-baseline.log`.

LAYERS (each has an exit criterion)
| Layer | What | Exit criterion |
|---|---|---|
| Unit | Pure logic, validators, formatters, state machines | Every branch of domain logic |
| Property-based | Invariants: parse∘serialize identity, idempotency, monotonic totals, authorization never widens | ≥1 property per domain invariant |
| Integration | Route handlers and server actions against real DB, including constraints, transactions, rollbacks | Every API contract row, every status code |
| Contract | Responses validated against the spec's schemas; unknown fields rejected | 100% of endpoints |
| E2E (Playwright) | One test per user job in `jtbd.md` from **empty DB + seed** to done. Trace on failure | Every P0 flow green on a clean DB |
| **Information-flow** | See below | Matrix 100% |
| **Authz matrix** | Generated from `authz-matrix.md`: for each role × resource × action, assert allow/deny, plus cross-tenant attempts | Every cell executed |
| Security regression | `tests/security/`: one file per finding, written to fail on the vulnerable code | Created in `08/09` |
| Resilience | DB down, slow query, third-party 500/timeout, duplicate submit, retry storms, partial failure mid-transaction | Each yields spec'd error state, no data corruption |
| Concurrency | Double-spend, lost update, parallel creates against unique constraints | Invariants hold under `Promise.all` x50 |
| Migration | Fresh migrate, migrate with data, schema drift check | Green |
| Accessibility | axe on every screen and state, plus keyboard-only walkthrough | 0 serious/critical violations |
| Visual | Screenshot baselines at 3 breakpoints | Reviewed, not blindly updated |
| Performance | Budgets from NFRs: API p95 under load (autocannon/k6), LCP/CLS/INP via Lighthouse CI, bundle size | Budgets met |
| Mutation | Stryker on domain and security modules | Score ≥ 70% overall, ≥ 85% on auth/authz/validation |

**FLOW-OF-INFORMATION TESTS (the "does everything connect" check)**
For each row of the spec's information-flow table:
1. Submit a **unique canary** (e.g. `CANARY_<row>_<uuid>` plus variants containing `<script>`, `' OR 1=1--`, `${7*7}`, unicode, 1 MB string) via the real entry point.
2. Assert it **arrives** where the spec says (DB row, API response, rendered page, email/outbox).
3. Assert it **is transformed** as specified (trimmed, encoded, truncated, rejected with correct error).
4. Assert it **does not appear** where forbidden: other users' views, logs, error bodies, URLs, analytics, caches, exports, HTML as executable markup.
5. Assert deletion and retention behaviour.
Record results in `docs/05-test/flow-matrix.md` (row × sink × pass/fail).

**WALKING SKELETON (find blockers on day one)**
Create a single e2e that boots the production build, runs migrations and seed, signs in, creates one record, reads it back, signs out, and checks `/api/health`. It must be green before slice 1 starts and stays green in every later commit.

**QUALITY RULES FOR TESTS**
- No `sleep`; wait on conditions. Fixed clock and seeded randomness. A test failing twice in 20 runs is quarantined and fixed within the slice.
- One behaviour per test; names read like requirements.
- Never assert on implementation details (private functions, class names).
- Mocks only for third-party network. Never mock the DB or your own modules in integration tests.
- Coverage is reported (line + branch), but **mutation score and requirement traceability are the real gates**.

GATE G5
- [ ] `node pipeline/tools/trace-check.mjs docs/02-spec/SPEC.md tests --allow-uncovered` lists **0 requirements without a planned test** and 0 tests tagged with unknown IDs
- [ ] Red baseline recorded; failures are "not implemented", not harness errors
- [ ] Walking skeleton e2e green
- [ ] CI config runs lint, typecheck, unit, int, e2e, a11y, build
- [ ] Test plan lists known gaps honestly
