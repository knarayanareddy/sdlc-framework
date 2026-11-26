import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const TOOL = fileURLToPath(new URL("./coverage-gate.mjs", import.meta.url));

const ENTRYPOINTS = {
  entrypoints: [
    { id: "route:GET /api/items", kind: "route", file: "app/api/items/route.ts", line: 1 },
    { id: "route:POST /api/items", kind: "route", file: "app/api/items/route.ts", line: 2 },
    { id: "page:/dashboard", kind: "page", file: "app/dashboard/page.tsx", line: 1 },
  ],
};

function gate(ledger) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cov-"));
  const e = path.join(dir, "entrypoints.json");
  const c = path.join(dir, "coverage-ledger.json");
  fs.writeFileSync(e, JSON.stringify(ENTRYPOINTS));
  // The schema requires run + mode: a ledger without them is not a ledger.
  fs.writeFileSync(c, JSON.stringify({ run: "RUN-1", mode: "FULL", ...ledger }));
  const res = spawnSync("node", [TOOL, "--entrypoints", e, "--ledger", c, "--json"], { encoding: "utf8" });
  return { status: res.status, out: JSON.parse(res.stdout) };
}

const unit = (id, status, extra = {}) => ({ id, status, hunter: "H1", ...extra });

test("passes when every entry point is examined", () => {
  const { status, out } = gate({
    mode: "FULL",
    units: [unit("route:GET /api/items", "examined"), unit("route:POST /api/items", "examined"), unit("page:/dashboard", "examined")],
  });
  assert.equal(status, 0);
  assert.equal(out.result, "PASS");
});

test("fails when an entry point is absent from the ledger", () => {
  const { status, out } = gate({ units: [unit("route:GET /api/items", "examined"), unit("route:POST /api/items", "examined")] });
  assert.equal(status, 1);
  assert.match(out.problems.join("\n"), /missing: page:\/dashboard/);
});

test("fails when an examined unit has no hunter attributed", () => {
  const { status, out } = gate({
    units: [{ id: "route:GET /api/items", status: "examined" }, unit("route:POST /api/items", "examined"), unit("page:/dashboard", "examined")],
  });
  assert.equal(status, 1);
  assert.match(out.problems.join("\n"), /unattributed/);
});

test("fails when a unit is excluded without a real reason", () => {
  const { status, out } = gate({
    units: [
      unit("route:GET /api/items", "examined"),
      unit("route:POST /api/items", "examined"),
      { id: "page:/dashboard", status: "excluded", reason: "n/a" },
    ],
  });
  assert.equal(status, 1);
  assert.match(out.problems.join("\n"), /unjustified/);
});

test("fails when a unit is still unexamined", () => {
  const { status, out } = gate({
    units: [unit("route:GET /api/items", "examined"), unit("route:POST /api/items", "examined"), unit("page:/dashboard", "unexamined")],
  });
  assert.equal(status, 1);
  assert.match(out.problems.join("\n"), /unexamined/);
});

test("allows subsystem units that are not entry points", () => {
  const { status, out } = gate({
    units: [
      unit("route:GET /api/items", "examined"),
      unit("route:POST /api/items", "examined"),
      unit("page:/dashboard", "examined"),
      unit("subsystem:session-cache", "examined"),
    ],
  });
  assert.equal(status, 0);
  assert.equal(out.nonEntrypointUnits, 1);
});

test("a missing input file is a failure, not a pass", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cov-"));
  const res = spawnSync("node", [TOOL, "--entrypoints", path.join(dir, "nope.json"), "--ledger", path.join(dir, "nope2.json")], { encoding: "utf8" });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /no entrypoints file/);
});

// ---- P1 · coverage with no subject, or with extra unexamined claims ---------------------
test("an empty entrypoints file is NOT_VERIFIED, not full coverage", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cov-"));
  const e = path.join(dir, "entrypoints.json");
  const c = path.join(dir, "coverage-ledger.json");
  fs.writeFileSync(e, JSON.stringify({ entrypoints: [] }));
  fs.writeFileSync(c, JSON.stringify({ run: "RUN-1", mode: "FULL", units: [] }));
  const res = spawnSync("node", [TOOL, "--entrypoints", e, "--ledger", c], { encoding: "utf8" });
  assert.equal(res.status, 3);
  assert.match(res.stdout, /NOT_VERIFIED: entrypoints.json lists no entry points/);
  assert.match(res.stdout, /human command/);
});

test("a unit the enumerator did not list is still held to the same bar", () => {
  const { status, out } = gate({
    units: [unit("route:GET /api/items", "examined"), unit("route:POST /api/items", "examined"), unit("page:/dashboard", "examined"), unit("subsystem:billing", "unexamined")],
  });
  assert.equal(status, 1);
  assert.match(out.problems.join("\n"), /unexamined: subsystem:billing/);
});

// ---- P4 · a scoped coverage run covers the change, and says so ------------------------
const ENTRYPOINTS_TWO_AREAS = {
  entrypoints: [
    { id: "route:GET /api/items", kind: "route", file: "app/api/items/route.ts", line: 1 },
    { id: "page:/dashboard", kind: "page", file: "app/dashboard/page.tsx", line: 1 },
  ],
};

test("with --scope only the entry points in scope must be covered", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cov-"));
  const e = path.join(dir, "entrypoints.json");
  const c = path.join(dir, "coverage-ledger.json");
  fs.writeFileSync(e, JSON.stringify(ENTRYPOINTS_TWO_AREAS));
  // The dashboard page is not examined; the API route is. Unscoped this fails.
  fs.writeFileSync(c, JSON.stringify({ run: "RUN-1", mode: "FULL", units: [{ id: "route:GET /api/items", status: "examined", hunter: "H-1" }] }));
  const whole = spawnSync("node", [TOOL, "--entrypoints", e, "--ledger", c], { encoding: "utf8" });
  assert.equal(whole.status, 1, "unscoped, an uncovered page is a failure");

  const scoped = spawnSync("node", [TOOL, "--entrypoints", e, "--ledger", c, "--scope", "app/api"], { encoding: "utf8" });
  assert.equal(scoped.status, 0, scoped.stdout + scoped.stderr);
  assert.match(scoped.stdout, /SCOPED \(under app\/api\)/);
});

test("a scope that contains no entry points is NOT_VERIFIED, not a pass", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cov-"));
  const e = path.join(dir, "entrypoints.json");
  const c = path.join(dir, "coverage-ledger.json");
  fs.writeFileSync(e, JSON.stringify(ENTRYPOINTS_TWO_AREAS));
  fs.writeFileSync(c, JSON.stringify({ run: "RUN-1", mode: "FULL", units: [] }));
  const r = spawnSync("node", [TOOL, "--entrypoints", e, "--ledger", c, "--scope", "src/nope"], { encoding: "utf8" });
  assert.equal(r.status, 3);
  assert.match(r.stdout, /the scope \(under src\/nope\) contains no entry points/);
});
