import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db, pool } from "../src/db";
import { GET, PUT } from "../src/app/api/gates/route";
import { MAX_NOTE, parseGateUpdate } from "../src/lib/gates";

const HOST = "localhost:3000";

// Safety: these tests truncate gate_status. Refuse to run against anything that isn't a *_test database.
if (!/_test$/.test(new URL(process.env.DATABASE_URL ?? "postgres://x/none").pathname)) {
  throw new Error("Refusing to run: DATABASE_URL does not point at a *_test database");
}

describe("test database mirrors the Drizzle schema", () => {
  it("has exactly the columns src/db/schema.ts declares", async () => {
    const { getTableColumns } = await import("drizzle-orm");
    const { gateStatus } = await import("../src/db/schema");
    const declared = Object.values(getTableColumns(gateStatus)).map((c) => c.name).sort();
    const res = await db.execute(sql`select column_name from information_schema.columns where table_name = 'gate_status'`);
    expect(res.rows.map((r) => String(r.column_name)).sort()).toEqual(declared);
  });
});

function put(body: unknown, headers: Record<string, string> = {}, raw?: string) {
  return PUT(
    new Request(`http://${HOST}/api/gates`, {
      method: "PUT",
      headers: { "content-type": "application/json", host: HOST, ...headers },
      body: raw ?? JSON.stringify(body),
    }),
  );
}

beforeEach(async () => {
  await db.execute(sql`truncate table gate_status`);
});
afterAll(async () => {
  await pool.end();
});

describe("parseGateUpdate (allowlist validation)", () => {
  it("accepts a valid update and trims the note", () => {
    const r = parseGateUpdate({ gate: "G5", status: "passed", note: "  ran trace-check-v2  " });
    expect(r).toEqual({ ok: true, value: { gate: "G5", status: "passed", note: "ran trace-check-v2" } });
  });
  it.each([
    [null], [[]], ["x"], [{ gate: "G6", status: "passed" }], [{ gate: "G5", status: "done" }], [{ gate: "G5", status: 1 }],
    [{ gate: "G5", status: "passed", admin: true }], [{ gate: "G5", status: "passed", note: 5 }], [{ gate: "__proto__", status: "passed" }],
    [{ gate: "G5", status: "passed", note: "x".repeat(MAX_NOTE + 1) }],
  ])("rejects %j", (input) => {
    expect(parseGateUpdate(input).ok).toBe(false);
  });
  it("strips control characters from notes", () => {
    const r = parseGateUpdate({ gate: "G1", status: "failed", note: "a\u0000b\u001bc" });
    expect(r.ok && r.value.note).toBe("abc");
  });
});

describe("PUT/GET /api/gates against real Postgres", () => {
  it("stores a gate and returns it", async () => {
    const res = await put({ gate: "G5", status: "NOT_VERIFIED", note: "no browser available" });
    expect(res.status).toBe(200);
    const body = await (await GET(new Request(`http://${HOST}/api/gates`))).json();
    expect(body.gates.G5).toMatchObject({ status: "NOT_VERIFIED", note: "no browser available" });
  });

  it("upserts rather than duplicating, and clears with null", async () => {
    await put({ gate: "G7", status: "failed" });
    await put({ gate: "G7", status: "passed", note: "fixed" });
    let body = await (await GET(new Request(`http://${HOST}/api/gates`))).json();
    expect(Object.keys(body.gates)).toEqual(["G7"]);
    expect(body.gates.G7.status).toBe("passed");
    expect((await put({ gate: "G7", status: null })).status).toBe(200);
    body = await (await GET(new Request(`http://${HOST}/api/gates`))).json();
    expect(body.gates).toEqual({});
  });

  it("rejects a cross-origin write and stores nothing", async () => {
    const res = await put({ gate: "G1", status: "passed" }, { origin: "https://evil.example" });
    expect(res.status).toBe(403);
    const body = await (await GET(new Request(`http://${HOST}/api/gates`))).json();
    expect(body.gates).toEqual({});
  });

  it("accepts a same-origin write", async () => {
    expect((await put({ gate: "G1", status: "passed" }, { origin: `http://${HOST}` })).status).toBe(200);
  });

  it("rejects non-JSON content types (form posts can't change the board)", async () => {
    const res = await put({}, { "content-type": "text/plain" }, "gate=G1&status=passed");
    expect(res.status).toBe(415);
  });

  it("enforces the body limit on bytes read, even when the Content-Length header lies", async () => {
    const big = JSON.stringify({ gate: "G1", status: "passed", note: "é".repeat(1500) });
    const res = await put(null, { "content-length": "10" }, big);
    expect(res.status).toBe(413);
  });

  it("returns 400 for malformed JSON and 422 for unknown fields, with no stack trace", async () => {
    expect((await put(null, {}, "{not json")).status).toBe(400);
    const res = await put({ gate: "G1", status: "passed", isAdmin: true });
    expect(res.status).toBe(422);
    expect(JSON.stringify(await res.json())).not.toMatch(/at .*\.ts|node_modules|select|insert/i);
  });

  it("never interprets a hostile note as SQL", async () => {
    const note = "'); drop table gate_status; --";
    expect((await put({ gate: "G2", status: "passed", note })).status).toBe(200);
    const body = await (await GET(new Request(`http://${HOST}/api/gates`))).json();
    expect(body.gates.G2.note).toBe(note);
  });

  it("export download is a JSON attachment with no-store", async () => {
    await put({ gate: "G3", status: "passed" });
    const res = await GET(new Request(`http://${HOST}/api/gates?download=1`));
    expect(res.headers.get("content-disposition")).toContain("progress.json");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(JSON.parse(await res.text()).gates.G3.status).toBe("passed");
  });
});
