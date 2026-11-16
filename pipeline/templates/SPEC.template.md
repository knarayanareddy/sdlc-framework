# {{Product}}: Specification

Status: draft | Version: 0.1 | Owner: {{agent/human}} | Research refs: docs/01-research/*

## 1. Thesis
One paragraph. Cite `E-nn`. State the riskiest assumption and how we test it.

## 2. Personas / Jobs to be done
| ID | When… | I want… | So I can… | Current workaround | Evidence |
|---|---|---|---|---|---|
| J-1 | | | | | E-00 |

## 3. Scope
**In:** …
**Out (and why):** …
**Anti-features:** …

## 4. Information-flow table
| Datum | Entry point | Trust | Validation (type/size/charset) | Stored where | Who can read | Rendered/logged where | Retention | Deletion |
|---|---|---|---|---|---|---|---|---|
| example: display name | PATCH /api/profile | untrusted | string 1-60, no control chars | users.display_name | owner, admins | profile page (escaped), never logged | until account deletion | cascade |

## 5. Authorization matrix
| Role | Resource | Create | Read | Update | Delete | Enforcement point |
|---|---|---|---|---|---|---|
| anon | | deny | deny | deny | deny | middleware + query |

## 6. Data model
Tables, columns, types, constraints, indexes, ownership column, cascade rules.

## 7. API contract
| Method | Path | Auth | Request schema | Response schema | Errors | Idempotent? | Rate limit |
|---|---|---|---|---|---|---|---|

## 8. Requirements

### REQ-001 Example: create an item
- Priority: P0
- Rationale: J-1, E-00
- Statement: When an authenticated user submits a valid item, the system shall persist it owned by that user and return it.
- Acceptance:
  - Given a signed-in user, When they POST a valid item, Then the response is 201 and the item is readable only by them.
  - Given an item title of 201 characters, When submitted, Then the response is 422 with code `TITLE_TOO_LONG`.
- Test level: integration + e2e
- Test file: tests/integration/items.test.ts
- Done-when: both acceptance cases pass; flow row "item title" green; axe clean on the form.

### SEC-001 Example: owner scoping
- Priority: P0
- Rationale: threat-model T-03 (IDOR)
- Statement: The system shall scope every item query by the session user id at the query level.
- Acceptance:
  - Given users A and B, When B requests A's item id, Then the response is 404 and no data is leaked.
- Test level: security
- Test file: tests/security/idor-items.test.ts
- Done-when: authz-matrix cells for items all pass.

### NFR-001 Example: latency
- Priority: P1
- Rationale: perceived performance
- Statement: The list endpoint shall respond in p95 < 300 ms at 50 rps with 10k rows.
- Acceptance:
  - Given 10k seeded rows, When autocannon runs at 50 rps for 30 s, Then p95 < 300 ms.
- Test level: performance
- Test file: tests/perf/list.test.mjs
- Done-when: budget met on production build.

## 9. State coverage
| Screen | Empty | Loading | Error | Partial | Offline | Denied | First-run |
|---|---|---|---|---|---|---|---|

## 10. Error catalog
| Code | HTTP | User message | Log level | Recovery |
|---|---|---|---|---|

## 11. Abuse cases
| ID | Feature | Hostile action | Control | SEC id |
|---|---|---|---|---|

## 12. Observability
Log fields, redaction list, health endpoint contract, metrics.

## 13. Slices
| Slice | Delivers | Demo script | Definition of done |
|---|---|---|---|
| 0 (walking skeleton) | Auth, one record end-to-end, CI, seed, health | | e2e green on prod build |

## 14. Open questions (each with a default decision)
| Q | Default | Reversal cost |
|---|---|---|
