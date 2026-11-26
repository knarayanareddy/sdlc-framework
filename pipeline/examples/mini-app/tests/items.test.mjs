// @req REQ-001 REQ-002 REQ-003
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateItem, canRead } from "../src/lib/can-read.mjs";
import { markRead, readState } from "../src/lib/reads.mjs";

test("REQ-001: a valid item is accepted and its title is trimmed", () => {
  const result = validateItem({ url: "https://example.com/a", title: "  A good link  " });
  assert.equal(result.ok, true);
  assert.equal(result.value.title, "A good link");
});

test("REQ-001: a title of 201 characters is rejected with TITLE_TOO_LONG", () => {
  const result = validateItem({ url: "https://example.com/a", title: "x".repeat(201) });
  assert.equal(result.ok, false);
  assert.equal(result.code, "TITLE_TOO_LONG");
});

test("REQ-001: a javascript: URL is rejected", () => {
  const result = validateItem({ url: "javascript:alert(1)", title: "nope" });
  assert.equal(result.ok, false);
  assert.equal(result.code, "URL_SCHEME");
});

test("REQ-002: a member sees only their own team's items", () => {
  const mine = { teamId: "team-a" };
  assert.equal(canRead(mine, { teamId: "team-a" }), true);
  assert.equal(canRead(mine, { teamId: "team-b" }), false);
});

test("REQ-003: marking the same item read twice leaves exactly one row", () => {
  const first = markRead([], { memberId: "m-1", itemId: "item_1", at: "2026-11-26T10:00:00Z" });
  assert.equal(first.created, true);
  const second = markRead(first.rows, { memberId: "m-1", itemId: "item_1", at: "2026-11-26T10:00:05Z" });
  assert.equal(second.created, false);
  assert.equal(second.rows.length, 1, "a second submit must not insert a second row");
  assert.equal(second.rows[0].readAt, "2026-11-26T10:00:00Z", "the original read time stands");
});

test("REQ-003: read state is per member, not per item", () => {
  const rows = markRead([], { memberId: "m-1", itemId: "item_1" }).rows;
  assert.equal(readState(rows, { memberId: "m-1", itemId: "item_1" }), true);
  assert.equal(readState(rows, { memberId: "m-2", itemId: "item_1" }), false);
});

test("REQ-003: a missing member or item is refused, not silently recorded", () => {
  assert.equal(markRead([], { memberId: "", itemId: "item_1" }).ok, false);
  assert.equal(markRead([], { memberId: "m-1", itemId: "" }).ok, false);
});
