# 04 · Architecture + Threat Model (security by design)

Input: `docs/02-spec/SPEC.md`
Output: `docs/04-architecture/{architecture.md, adrs/*.md, threat-model.md, authz-matrix.md, dependency-vetting.md}`
Gate G4. Runs in parallel with 03.

---

ROLE: Principal engineer and application security architect.

TASK
1. **architecture.md**: modules and boundaries, request lifecycle, data lifecycle, error handling strategy, background jobs, caching, configuration and secrets. Include a diagram (Mermaid) with **trust boundaries drawn explicitly** (browser | edge | app server | DB | third parties).
2. **ADRs** (one file each): framework choices, auth approach, validation library (e.g. zod at every boundary), ORM usage rules (parameterized only), session/token design, file handling, rate-limit store. Each lists options considered, decision, consequences.
3. **Threat model** (`threat-model.md`):
   - For every entry point (route, server action, form, webhook, file upload, query param, header, cookie, third-party callback, env var, DB content that came from users): STRIDE analysis and 1-3 concrete abuse cases.
   - Attack-class sweep, to be reused by the red team: injection (SQL, command, template, header, log), authN/session, access control (IDOR, BOLA, function-level, mass assignment), data isolation (tenant bleed through caches, logs, errors, search, exports), SSRF and open redirect, XSS/CSRF/clickjacking/CORS, deserialization and prototype pollution, business-logic abuse (races, replay, negative amounts, state skipping), resource exhaustion (unbounded lists, regex, uploads, N+1, expensive queries, amplification), supply chain, secrets leakage, and, **only if the app calls an LLM**, prompt injection, tool abuse and exfiltration.
   - Each threat → control → the SEC requirement that enforces it → the test that proves it. Add missing SEC requirements to the spec via a change note.
4. **authz-matrix.md**: role × resource × action, default deny, plus how each cell is enforced (middleware, query scoping, DB constraint). Specify *query-level* ownership scoping, not just route guards.
5. **Resource limits:** body size, upload size and type, pagination max, per-user and per-IP rate limits, query timeouts, concurrency caps, response size.
6. **dependency-vetting.md:** for each non-trivial dependency: maintainer activity, last release, weekly downloads, install scripts, known advisories, licence, and whether a ~20-line implementation would be safer. Lockfile committed; exact versions; `npm audit` policy.
7. **Security headers and cookies:** CSP (nonce-based), HSTS, X-Content-Type-Options, Referrer-Policy, frame-ancestors, `HttpOnly; Secure; SameSite` cookies.
8. **Logging and privacy:** structured logs; redaction list; no secrets, tokens or raw PII; audit log for security-relevant events.

GATE G4 (fresh reviewer)
- [ ] Every entry point in the spec's info-flow table has ≥1 abuse case
- [ ] Every threat maps to a SEC id and a planned test file
- [ ] Authz matrix has no blank cells
- [ ] Limits are numeric
- [ ] Reviewer attempts three abuse paths on paper and finds none unaddressed

NEVER: leave "TBD" in controls. Never rely on client-side checks as a control.
