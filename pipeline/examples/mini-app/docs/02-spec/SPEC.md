# Shared reading list: Specification

Status: frozen after G4 | Version: 0.1 | Owner: agent | Research refs: docs/01-research/*

## 1. Thesis

Small teams lose links in chat and repost the same one three times. A per-team list with
per-member read state fixes the duplicate without asking anyone to change tools (`E-02`, `E-03`).
Riskiest assumption: teams will open a second tool at all. Cheapest test: instrument the
paste-into-chat rate during a 5-person pilot.

## 2. Personas / Jobs to be done

| ID | When… | I want… | So I can… | Current workaround | Evidence |
|---|---|---|---|---|---|
| J-1 | someone posts a link I want to keep | to add it to the team list in one step | find it again next week | scroll back in chat | E-01 |
| J-2 | I open the list | to see what I have not read yet | pick the next thing | none | E-03 |

## 3. Scope

**In:** one team per account, add link, list links, mark read, delete own link.
**Out (and why):** comments (not the stated problem), imports (no demand evidence), SSO (pilot is small).
**Anti-features:** a chat client, a browser extension, notifications.

## 4. Information-flow table

| Datum | Entry point | Trust | Validation | Stored where | Who can read | Rendered/logged where | Retention | Deletion |
|---|---|---|---|---|---|---|---|---|
| link URL | POST /api/items | untrusted | http(s) only, ≤2048 chars | items.url | team members | list page, escaped | until deletion | cascade with team |
| link title | POST /api/items | untrusted | string 1–200, control chars stripped | items.title | team members | list page, escaped | until deletion | cascade |
| read state | POST /api/items/:id/read | untrusted | boolean per member | reads.member_id | the member | list page | until deletion | cascade |

## 5. Authorization matrix

| Role | Resource | Create | Read | Update | Delete | Enforcement point |
|---|---|---|---|---|---|---|
| member | item in own team | allow | allow | allow (read state) | own only | query scoped by team_id + member_id |
| member | item in another team | deny | deny | deny | deny | query scoped by team_id |
| anon | any | deny | deny | deny | deny | session middleware |

## 6. Data model

`items(id, team_id, author_id, url, title, created_at)` with a unique index on
`(team_id, url)` so a duplicate is a database fact, not an application check.
`reads(member_id, item_id, read_at)` primary key `(member_id, item_id)`.

## 7. API contract

| Method | Path | Auth | Request schema | Response schema | Errors | Idempotent? | Rate limit |
|---|---|---|---|---|---|---|---|
| GET | /api/items | session | — | `{items:[…]}` | 401 | yes | 120/min |
| POST | /api/items | session | `{url,title}` | `{id,url,title}` | 422 `TITLE_TOO_LONG`, 409 `DUPLICATE_URL` | no (409 on repeat) | 30/min |
| POST | /api/items/:id/read | session | — | `{readAt}` | 404 | yes | 120/min |

## 8. Requirements

### REQ-001 Add a link to the team list
- Priority: P0
- Rationale: J-1, E-01
- Statement: When a signed-in member submits a URL and a title, the system shall store the item owned by that member's team and return 201 with its id.
- Acceptance:
  - Given a signed-in member, When they POST `{url,title}`, Then the response is 201 and the item appears in their team's list.
  - Given a title of 201 characters, When submitted, Then the response is 422 with code `TITLE_TOO_LONG`.
- Test level: integration
- Test file: tests/items.test.mjs
- Done-when: both acceptance cases pass; flow row "link title" green.

### REQ-002 List the team's links with read state
- Priority: P0
- Rationale: J-2, E-03
- Statement: When a signed-in member opens the list, the system shall return every item in their team with a boolean read state for that member.
- Acceptance:
  - Given two items in the team and one marked read, When the list is fetched, Then both items are returned and exactly one has `read: true`.
- Test level: integration
- Test file: tests/items.test.mjs
- Done-when: acceptance case passes; a second team's item is never present.

### REQ-003 Mark an item read
- Priority: P1
- Rationale: J-2
- Statement: When a member marks an item read, the system shall record one read row for that member and item and return 200.
- Acceptance:
  - Given an item, When marked read twice, Then exactly one read row exists.
- Test level: integration
- Test file: tests/items.test.mjs
- Done-when: double submit leaves one row.

### SEC-001 Owner and team scoping in the query
- Priority: P0
- Rationale: threat-model T-01 (IDOR), `A-01`
- Statement: The system shall scope every item query by the session member's team id inside the query itself.
- Acceptance:
  - Given members of teams A and B, When B requests A's item id, Then the response is 404 and no field of A's item appears in the body.
- Test level: security
- Test file: tests/security/idor.test.mjs
- Done-when: `canRead` denies a mismatched tenant; authz-matrix cells for items all pass.

### NFR-001 List latency
- Priority: P1
- Rationale: perceived performance on a phone
- Statement: The list endpoint shall respond in p95 under 300 ms at 50 requests per second with 10000 items in the team.
- Acceptance:
  - Given 10000 seeded items, When autocannon runs at 50 rps for 30 seconds, Then p95 is under 300 ms.
- Test level: performance
- Test file: tests/perf/list.test.mjs
- Done-when: budget met on a production build.

## 9. State coverage

| Screen | Empty | Loading | Error | Partial | Offline | Denied | First-run |
|---|---|---|---|---|---|---|---|
| list | "No links yet" + add form | skeleton rows | retry banner | last good list + notice | cached list, read-only | 403 page | one-line explainer |

## 10. Error catalog

| Code | HTTP | User message | Log level | Recovery |
|---|---|---|---|---|
| TITLE_TOO_LONG | 422 | "Titles are limited to 200 characters." | info | edit and resubmit |
| DUPLICATE_URL | 409 | "That link is already on the list." | info | open the existing item |
| TEAM_READ_DENIED | 403 | "You are not a member of this team." | warn | request access |

## 11. Abuse cases

| ID | Feature | Hostile action | Control | SEC id |
|---|---|---|---|---|
| T-01 | list/detail | request another team's item id | query scoped by team_id | SEC-001 |
| T-02 | add | 5 MB title or a `javascript:` URL | length + scheme validation at the boundary | SEC-001 |
| T-03 | add | double submit of the same URL | unique index `(team_id, url)` | REQ-001 |

## 12. Observability

Log `{route, status, team_id, duration_ms}`. Never log `url` (may contain tokens in query
strings) or title. Health endpoint returns `{ok}` only.

## 13. Slices

| Slice | Delivers | Demo script | Definition of done |
|---|---|---|---|
| 0 (walking skeleton) | session, one item end to end, health | add a link, see it in the list | e2e green on a production build |
| 1 | REQ-001, REQ-002, SEC-001 | two teams, cross-team request returns 404 | tests tagged to those ids pass |
| 2 | REQ-003, NFR-001 | mark read twice, then list 10 000 items | one read row; p95 of the list response under budget |

## 14. Open questions (each with a default decision)

| Q | Default | Reversal cost |
|---|---|---|
| Should read state be visible to teammates? | No | Low |
| Do we need pagination at 10000 items? | Yes, cursor | Medium |
