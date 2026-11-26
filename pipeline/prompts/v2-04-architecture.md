# v2-04 · Architecture + threat model (security by design)

Input: `docs/02-spec/SPEC.md`, `docs/00-control/guardrails.md`
Output: `docs/04-architecture/{architecture.md, adrs/*.md, threat-model.md, authz-matrix.md, dependency-vetting.md}`
Gate: **G4**. Runs in parallel with `03`.

```bash
node pipeline/bin/pipeline.mjs phase start 04
node pipeline/bin/pipeline.mjs gate G4 --builtin plan
# plan-check: every SEC-* id is modelled, every route/action the code exposes appears in the
# authz matrix, and (from phase 06 on) every REQ-*/SEC-*/NFR-* is delivered by a slice log.
# It fails on a plan that contradicts itself, which --evidence never could.
node pipeline/bin/pipeline.mjs phase done 04
```

ROLE: principal engineer and application security architect.

## 1 · `architecture.md`

Modules and boundaries, request lifecycle, data lifecycle, error strategy, background jobs, caching, configuration and secrets. Include a Mermaid diagram with **trust boundaries drawn explicitly** (browser | edge | app server | DB | third parties).

## 2 · ADRs

One file each: framework choice, auth approach, validation library (zod at every boundary), ORM rules (parameterized only), session/token design, file handling, rate-limit store. Each lists options considered, the decision, and the consequences.

## 3 · `threat-model.md`

For every entry point — route, server action, form, webhook, upload, query param, header, cookie, third-party callback, env var, and DB content that came from users — do a STRIDE pass and write one to three concrete abuse cases.

Attack-class sweep, reused later by the red team: injection (SQL, command, template, header, log), authN/session, access control (IDOR, BOLA, function-level, mass assignment), data isolation (tenant bleed through caches, logs, errors, search, exports), SSRF and open redirect, XSS/CSRF/clickjacking/CORS, deserialization and prototype pollution, business-logic abuse (races, replay, negative amounts, state skipping), resource exhaustion (unbounded lists, regex, uploads, N+1, amplification), supply chain, secret leakage, and — **only if the app calls an LLM** — prompt injection, tool abuse and exfiltration.

Each row: threat → control → the SEC requirement that enforces it → the test that proves it. Missing SEC requirements go into the spec with a change note.

Cross-check with the script, not the memory. The enumerator lists the entry points for you:

```bash
node pipeline/tools/entrypoints.mjs --root . --out docs/04-architecture/entrypoints.json
```

Every id in that file must appear in the threat model. The same file becomes the floor for the red team's coverage ledger in `08`.

## 4 · `authz-matrix.md`

Role × **route** × resource × CRUD, default deny, plus how each cell is enforced (middleware, query scoping, DB constraint). Specify **query-level** ownership scoping, not only route guards.

The route column is checked mechanically: `plan-check` matches the matrix against
`entrypoints.json` (or the spec's `| METHOD | path |` table before phase 08). A route that exists
in the code and not in the matrix fails G4, and so does a matrix row for a route that does not
exist. One row per route per role.

## 5 · Resource limits

Body size, upload size and type, pagination max, per-user and per-IP rate limits, query timeouts, concurrency caps, response size. Numbers, not adjectives.

## 6 · `dependency-vetting.md`

For each non-trivial dependency: maintainer activity, last release, weekly downloads, install scripts, known advisories, licence, and whether a ~20-line implementation would be safer. Lockfile committed; exact versions; `npm audit` policy. Anything needing an install script goes on the allowlist here **before** it is installed (`--ignore-scripts` is the default).

## 7 · Headers and cookies

CSP (nonce-based), HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `frame-ancestors`, `HttpOnly; Secure; SameSite` cookies.

## 8 · Logging and privacy

Structured logs, a redaction list, no secrets/tokens/raw PII, and an audit log for security-relevant events.

## GATE G4 (fresh reviewer)

- [ ] `gate G4 --builtin plan` passes (threat ids modelled, routes covered)
- [ ] Every entry point from `entrypoints.json` has ≥1 abuse case
- [ ] Every threat maps to a SEC id and a planned test file
- [ ] The authz matrix has no blank cells
- [ ] Limits are numeric
- [ ] Reviewer walks three abuse paths on paper and finds none unaddressed

NEVER: leave "TBD" in controls. Never treat a client-side check as a control.
