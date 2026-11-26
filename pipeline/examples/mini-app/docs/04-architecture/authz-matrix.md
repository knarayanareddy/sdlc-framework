# Authorization matrix

| Role | Route | Resource | Create | Read | Update | Delete | Enforcement |
|---|---|---|---|---|---|---|---|
| member | `GET /api/items` | item (own team) | — | allow | — | — | `eq(items.teamId, session.teamId)` in every query |
| member | `GET /api/items` | item (other team) | — | deny | — | — | same clause → row absent → 404 |
| member | `POST /api/items` | item (own team) | allow | — | — | — | team id taken from the session, never the body |
| member | `POST /api/items/:id/read` | read state (own) | allow | — | allow (idempotent) | — | `(member_id, item_id)` primary key scoped by team |
| member | `POST /api/items/:id/read` | read state (other team) | deny | — | deny | — | team clause → 404 |
| anon | any | any | deny | deny | deny | deny | session middleware |
| admin | `GET /api/items` | item (own team) | — | allow | — | — | role check + team clause |

Default deny. No cell is blank. Query-level scoping, not only a route guard.
