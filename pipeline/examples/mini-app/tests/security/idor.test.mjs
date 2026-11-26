// @finding F-01
// @req SEC-001
// Regression test for an IDOR that was found on GET /api/items/:id: the query was not
// scoped by team, so a member of team B could read team A's item by guessing its id.
import { test } from "node:test";
import assert from "node:assert/strict";
import { canRead } from "../../src/lib/can-read.mjs";

test("a member of another team is denied", () => {
  const item = { id: "item_1", teamId: "team-a" };
  assert.equal(canRead(item, { teamId: "team-b" }), false);
});

test("the owner's team is allowed", () => {
  const item = { id: "item_1", teamId: "team-a" };
  assert.equal(canRead(item, { teamId: "team-a" }), true);
});

test("a missing item or member denies rather than throwing", () => {
  assert.equal(canRead(null, { teamId: "team-a" }), false);
  assert.equal(canRead({ teamId: "team-a" }, null), false);
});
