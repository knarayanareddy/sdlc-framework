# Threat model (STRIDE, per entry point)

Trust boundaries: browser | app server | Postgres.

| Entry point | Threat | Abuse case | Control | SEC id | Test |
|---|---|---|---|---|---|
| GET /api/items | Info disclosure | request with another team's session cookie | query scoped by session team_id | SEC-001 | tests/security/idor.test.mjs |
| POST /api/items | Tampering | 5 MB title; `javascript:` URL | schema validation at the boundary, 422 | SEC-001 | tests/items.test.mjs |
| POST /api/items | Repudiation/race | double submit | unique index (team_id, url) → 409 | REQ-001 | tests/items.test.mjs |
| POST /api/items/:id/read | Access control | mark read on another team's item | query scoped by team_id, 404 | SEC-001 | tests/security/idor.test.mjs |
| DATABASE_URL env | Info disclosure | value leaked into an error body | errors never include env; no stack traces | SEC-001 | review |

Resource limits: body ≤ 8 KB, title ≤ 200 chars, URL ≤ 2048 chars, list page ≤ 50 rows.
