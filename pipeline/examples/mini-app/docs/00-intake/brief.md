# Brief: a shared reading list for small teams

**Who:** 4–12 person teams who already keep a reading list in a group chat.

**Problem:** links get lost in chat. Nobody knows what has been read, and the same link
is posted three times.

**Proposal:** one list per team. Add a link with a title. Mark it read. Only members of
the team can read or change its list.

**Out of scope for slice 1:** comments, tags, email digests, importing from chat.

**Riskiest assumption:** that teams will switch from chat to a second tool at all. Cheapest
test: instrument the "paste a link into chat" workaround rate in a 5-person pilot.

## Ambiguities, resolved by default (rule: decide, don't ask)

| # | Question | Chosen default | Rejected alternative | Why | Cost to reverse |
|---|---|---|---|---|---|
| A-01 | Does a link belong to a user or a team? | Team | User | The stated problem is duplicate links in a shared space | High: migration |
| A-02 | Can a member delete another member's link? | No, only the author or an admin | Any member | Least surprise | Low |
| A-03 | Read state per link or per member? | Per member | Per link | Different people read different things | Medium |
