# Decision Digest (non-blocking) — phase H1

Marked: **unreviewed** — no human has answered. The run continues; the final report lists
this as an unreviewed decision.

## Thesis

A per-team list with per-member read state fixes duplicate links without asking anyone to
change tools.

## Top 5 assumptions (from docs/00-intake/brief.md)

| # | Assumption | Chosen | Cost to reverse |
|---|---|---|---|
| A-01 | Links belong to a team, not a user | team | high (migration) |
| A-02 | Only the author or an admin deletes | author/admin | low |
| A-03 | Read state is per member | per member | medium |
| A-04 | One team per account in slice 1 | yes | low |
| A-05 | No notifications in v1 | yes | low |

## Scope in / out

**In:** add, list, mark read, delete own.
**Out:** comments, imports, SSO, notifications.

## What a human might overrule

1. Team-scoped rather than user-scoped lists (A-01). Reversing later is a migration.
2. No notifications (A-05). Cheap to add, and it may be the retention mechanism.
