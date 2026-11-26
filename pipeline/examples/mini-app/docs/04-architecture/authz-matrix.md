# Authorization matrix

| Role | Resource | Create | Read | Update | Delete | Enforcement |
|---|---|---|---|---|---|---|
| member | item (own team) | allow | allow | read-state only | own only | `eq(items.teamId, session.teamId)` in every query |
| member | item (other team) | deny | deny | deny | deny | same clause → row absent → 404 |
| anon | any | deny | deny | deny | deny | session middleware |
| admin | item (own team) | allow | allow | allow | allow | role check + team clause |

Default deny. No cell is blank. Query-level scoping, not only a route guard.
