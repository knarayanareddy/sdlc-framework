// Pure domain rules for read state, so the read path can be unit-tested without a database.
// REQ-003: a member marking an item read twice must leave exactly one row, and the second
// call must be a no-op rather than a second insert (the spec's acceptance case).

export function markRead(reads, { memberId, itemId, at = new Date().toISOString() }) {
  if (!memberId || !itemId) return { ok: false, code: "READ_ARGS" };
  const existing = reads.find((r) => r.memberId === memberId && r.itemId === itemId);
  if (existing) return { ok: true, created: false, rows: reads };
  return { ok: true, created: true, rows: [...reads, { memberId, itemId, readAt: at }] };
}

export function readState(reads, { memberId, itemId }) {
  return reads.some((r) => r.memberId === memberId && r.itemId === itemId);
}

// The list response: every item in the team with this member's read flag. Kept pure so
// NFR-001's per-request budget can be measured without a server.
export function buildList(items, reads, { memberId }) {
  // One pass to index the member's reads, then one pass over the items. The naive
  // `reads.some(...)` inside the map is O(items x reads): ~210 ms at 10,000 x 10,000, which
  // is under NFR-001's 300 ms budget on this machine but has no headroom left. The index
  // keeps it at ~2 ms.
  const readIds = new Set(reads.filter((r) => r.memberId === memberId).map((r) => r.itemId));
  return {
    items: items.map((item) => ({
      id: item.id,
      url: item.url,
      title: item.title,
      read: readIds.has(item.id),
    })),
  };
}
