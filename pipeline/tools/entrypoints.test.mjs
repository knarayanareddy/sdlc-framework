import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const TOOL = new URL("./entrypoints.mjs", import.meta.url).pathname;

function fixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ep-"));
  for (const [rel, body] of Object.entries(files)) {
    const target = path.join(dir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body);
  }
  return dir;
}

function enumerate(dir) {
  const out = path.join(dir, "entrypoints.json");
  const res = spawnSync("node", [TOOL, "--root", dir, "--out", out, "--stable"], { encoding: "utf8" });
  assert.equal(res.status, 0, res.stderr);
  return JSON.parse(fs.readFileSync(out, "utf8"));
}

const APP = {
  "app/api/items/[id]/route.ts": `export async function GET() {}\nexport async function DELETE() {}\n`,
  "app/api/items/route.ts": `export const POST = async () => {}\n`,
  "app/dashboard/page.tsx": `export default function Page() { return null }\n`,
  "app/(marketing)/about/page.tsx": `export default function Page() { return null }\n`,
  "src/middleware.ts": `export function middleware() {}\n`,
  "src/actions/thing.ts": `"use server";\nexport async function doThing() {}\n`,
  "src/lib/db.ts": `const url = process.env.DATABASE_URL;\nconst other = process.env["API_KEY"];\n`,
  "src/lib/query.ts": `const q = sql.raw("select 1");\nconst r = fetch(userUrl);\n`,
  "src/lib/db.test.ts": `process.env.SHOULD_BE_IGNORED\n`,
  "node_modules/pkg/index.js": `process.env.IGNORED_TOO\n`,
};

test("enumerates routes, verbs, pages, middleware, actions, env, raw sql and fetches", () => {
  const dir = fixture(APP);
  const { entrypoints, counts } = enumerate(dir);
  const ids = entrypoints.map((e) => e.id);

  assert.ok(ids.includes("route:GET /api/items/:id"), ids.join("\n"));
  assert.ok(ids.includes("route:DELETE /api/items/:id"));
  assert.ok(ids.includes("route:POST /api/items"));
  assert.ok(ids.includes("page:/dashboard"));
  assert.ok(ids.includes("page:/about"), "route groups are stripped from the path");
  assert.ok(ids.includes("middleware:src/middleware.ts"));
  assert.ok(ids.includes("action:src/actions/thing.ts#doThing"));
  assert.ok(ids.includes("env:DATABASE_URL"));
  assert.ok(ids.includes('env:API_KEY'));
  assert.ok(ids.some((id) => id.startsWith("rawSql:src/lib/query.ts")));
  assert.ok(ids.some((id) => id.startsWith("fetch:src/lib/query.ts")));
  assert.equal(counts.route, 3);
});

test("ignores test files and node_modules", () => {
  const dir = fixture(APP);
  const ids = enumerate(dir).entrypoints.map((e) => e.id);
  assert.ok(!ids.some((id) => id.includes("SHOULD_BE_IGNORED")));
  assert.ok(!ids.some((id) => id.includes("IGNORED_TOO")));
});

test("output is deterministic and sorted", () => {
  const dir = fixture(APP);
  const a = enumerate(dir).entrypoints.map((e) => e.id);
  const b = enumerate(dir).entrypoints.map((e) => e.id);
  assert.deepEqual(a, b);
  assert.deepEqual(a, [...a].sort());
});

test("dynamic segments become :params and catch-alls become *", () => {
  const dir = fixture({
    "app/docs/[...slug]/page.tsx": `export default function P() { return null }\n`,
    "app/users/[id]/posts/[postId]/page.tsx": `export default function P() { return null }\n`,
  });
  const ids = enumerate(dir).entrypoints.map((e) => e.id);
  assert.ok(ids.includes("page:/docs/*"), ids.join("\n"));
  assert.ok(ids.includes("page:/users/:id/posts/:postId"));
});

test("an app with no entry points is reported, not silently empty", () => {
  const dir = fixture({ "README.md": "nothing here\n" });
  const res = spawnSync("node", [TOOL, "--root", dir], { encoding: "utf8" });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /no entry points found/);
});
