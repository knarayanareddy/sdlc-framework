# 02 · Spec Authoring (the build guide)

Input: `docs/00-intake/*`, `docs/01-research/*`, `pipeline/templates/SPEC.template.md`
Output: `docs/02-spec/SPEC.md`, `docs/02-spec/slices.md`
Gate G2.

---

ROLE: Staff engineer writing the contract that builders and testers will both be held to.

TASK: Fill in `SPEC.template.md`, adapting it to the product. The spec must be precise enough that a
different agent can build it without talking to you and a third can test it without reading the code.

RULES
1. **Every requirement is a `### REQ-nnn`, `### SEC-nnn` or `### NFR-nnn` heading** with: Priority (P0/P1/P2), Rationale (cite `E-nn` or `A-nn`), Statement in EARS form ("When <trigger>, the system shall <response>"), **Acceptance** as Given/When/Then, Test level (unit | integration | e2e | security), and Done-when.
2. **No weasel words.** Replace "fast", "secure", "user-friendly", "robust" with numbers or observable behaviour (e.g. "p95 API < 300 ms at 50 rps on the dev DB with 10k rows").
3. **Information-flow table (mandatory).** For every datum entering the system: source, trust level, validation (schema, max size, charset), where stored, who may read it, where it is rendered or logged, retention, and deletion path. This table is what the flow-of-information tests and red-team recon will use.
4. **Every state has a spec:** empty, loading, error, partial failure, offline/timeout, permission denied, first-run, rate-limited, concurrent edit.
5. **Data model** with constraints, indexes and ownership column for every user-owned table. **API contract** with request/response schemas, status codes, error shape, idempotency, pagination and rate limits.
6. **Authorization matrix:** role × resource × action, with a default of deny.
7. **Abuse cases:** for each P0 feature, write what a hostile user does with it. Each maps to a SEC requirement.
8. **Slices.** Break the build into vertical slices: slice 0 is a *walking skeleton* (thin end-to-end path: UI → API → DB → back, with auth, CI and seed). Each slice lists the REQ ids it delivers, its demo script, and its definition of done.
9. **Out of scope** list and **open questions with a default decision** (never leave a question open).
10. **Traceability:** each requirement lists the test file path it will be proven by (to be created in `05`).

CHECKLIST (author)
- [ ] Product thesis and personas link to research IDs
- [ ] Scope in/out
- [ ] ≥1 REQ per user job in `jtbd.md`
- [ ] NFR budgets: performance, accessibility (WCAG 2.2 AA), bundle size, availability, data limits
- [ ] SEC requirements: authn, authz, input validation, output encoding, CSRF/CORS, rate limits, secrets, logging without PII, dependency policy
- [ ] Error catalog (code, user message, log level, recovery)
- [ ] Observability: log fields, health endpoint, key metrics
- [ ] Slice plan with DoD

GATE G2
- [ ] `node pipeline/tools/trace-check.mjs docs/02-spec/SPEC.md tests --allow-uncovered` exits 0 (structure only)
- [ ] **Fresh-context reviewer** tries to write a test for every requirement. Any requirement it can't test is rewritten.
- [ ] Reviewer lists contradictions between requirements, the info-flow table and the data model. Count must be 0.
- [ ] A P0 requirement exists for every thesis claim

NEVER: describe implementation where behaviour will do (the spec says what, `04` says how).
