// @req REQ-001 REQ-002
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateItem, canRead } from "../src/lib/can-read.mjs";

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
