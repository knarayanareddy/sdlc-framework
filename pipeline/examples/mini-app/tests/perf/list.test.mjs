// @req NFR-001
// The automatable half of the budget: p95 of building the list response for 10,000 items,
// with the worst realistic read set (one read row per item, single member).
// What this does NOT measure: the 50 rps figure, which needs the load rig against a
// production build (docs/07-qa). Stated plainly because a budget test that oversells its
// scope is the kind of evidence this pipeline exists to stop.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildList } from "../../src/lib/reads.mjs";

const ITEMS = Array.from({ length: 10_000 }, (_, i) => ({ id: `item_${i}`, url: `https://example.com/${i}`, title: `link ${i}` }));
const READS = Array.from({ length: 10_000 }, (_, i) => ({ memberId: "m-1", itemId: `item_${i}`, readAt: "2026-11-26T10:00:00Z" }));
const BUDGET_MS = 300;

function p95(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
}

test("NFR-001: p95 of the 10k-item list response stays under the budget", () => {
  const samples = [];
  for (let run = 0; run < 60; run++) {
    const t0 = process.hrtime.bigint();
    const body = buildList(ITEMS, READS, { memberId: "m-1" });
    samples.push(Number(process.hrtime.bigint() - t0) / 1e6);
    if (run === 0) {
      assert.equal(body.items.length, ITEMS.length);
      assert.equal(body.items[0].read, true);
      // another member has read nothing, and must see nothing marked read
      assert.equal(buildList(ITEMS, READS, { memberId: "m-2" }).items[0].read, false);
    }
  }
  const measured = p95(samples);
  assert.ok(measured < BUDGET_MS, `p95 ${measured.toFixed(1)} ms exceeds the ${BUDGET_MS} ms budget`);
});
