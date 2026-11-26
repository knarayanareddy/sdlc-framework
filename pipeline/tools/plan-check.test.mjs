// The plan has to agree with itself before any code does. These fixtures are the ways it
// did not: a SEC id nobody threat-modelled, a route the matrix never covers, a requirement
// no slice delivered.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const TOOL = fileURLToPath(new URL("./plan-check.mjs", import.meta.url));

const SPEC = [
  "# SPEC",
  "",
  "## 7. API contract",
  "",
  "| Method | Path | Auth |",
  "|---|---|---|",
  "| GET | /api/items | session |",
  "| POST | /api/items | session |",
  "",
  "## 8. Requirements",
  "",
  "### REQ-001 Add an item",
  "- Priority: P0",
  "### REQ-002 Mark it read",
  "- Priority: P1",
  "### SEC-001 Tenant scoping",
  "- Priority: P0",
  "### NFR-001 List latency",
  "- Priority: P1",
  "",
].join("\n");

const THREAT = [
  "# Threat model",
  "",
  "| Entry point | Threat | Control | SEC id |",
  "|---|---|---|---|",
  "| GET /api/items | Info disclosure | team clause | SEC-001 |",
  "",
].join("\n");

const AUTHZ = ["# Authorization matrix", "", "| Role | Route | Read | Write |", "|---|---|---|---|", "| member | `GET /api/items` | allow | — |", "| member | `POST /api/items` | — | allow |", ""].join("\n");

function project({ spec = SPEC, threat = THREAT, authz = AUTHZ, slices = null, entrypoints = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plan-"));
  const write = (rel, body) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  };
  write("docs/02-spec/SPEC.md", spec);
  if (threat !== null) write("docs/04-architecture/threat-model.md", threat);
  if (authz !== null) write("docs/04-architecture/authz-matrix.md", authz);
  for (const [rel, body] of Object.entries(slices ?? {})) write(rel, body);
  if (entrypoints) write("docs/08-redteam/run-1/entrypoints.json", JSON.stringify(entrypoints));
  return dir;
}

const run = (dir, args = []) => spawnSync("node", [TOOL, ...args], { encoding: "utf8", cwd: dir });

const ALL_SLICES = {
  "docs/06-build/slice-01.md": "# Slice 01 — REQ-001, SEC-001\n",
  "docs/06-build/slice-02.md": "# Slice 02 — REQ-002, NFR-001\n",
};

test("a plan that holds together passes, and says what it did not require", () => {
  const dir = project({ slices: ALL_SLICES });
  const r = run(dir, ["--require", "threat,authz,slices"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /1\/1 SEC ids modelled/);
  assert.match(r.stdout, /2\/2 routes covered/);
  assert.match(r.stdout, /4\/4 ids delivered across 2 slice\(s\)/);

  const g4 = run(dir); // default: threat + authz only, slices not required
  assert.equal(g4.status, 0, g4.stdout + g4.stderr);
  assert.match(g4.stdout, /NOT_REQUIRED/);
});

test("a SEC requirement the threat model never mentions fails the plan", () => {
  const dir = project({ threat: THREAT.replace("| SEC-001 |", "| SEC-002 |"), slices: ALL_SLICES });
  const r = run(dir, ["--require", "threat"]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /threat: SEC-001 is in the spec but not in docs\/04-architecture\/threat-model\.md/);
});

test("a route that is exposed but absent from the matrix fails the plan", () => {
  const dir = project({ authz: AUTHZ.replace("| member | `POST /api/items` | — | allow |", ""), slices: ALL_SLICES });
  const r = run(dir, ["--require", "authz"]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /authz: route:POST \/api\/items/);
});

test("the enumerator's routes are the ground truth once they exist", () => {
  // A route the code exposes that the spec's API table never promised must still be in the
  // matrix: the enumerator sees the app, the table sees the plan.
  const entrypoints = { entrypoints: [{ id: "route:DELETE /api/items/:id", kind: "route", file: "src/app/api/items/[id]/route.ts" }] };
  const dir = project({ entrypoints, slices: ALL_SLICES });
  const r = run(dir, ["--require", "authz"]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /authz: route:DELETE \/api\/items\/:id \(src\/app\/api\/items\/\[id\]\/route\.ts\)/);
});

test("a requirement no slice delivers fails the plan", () => {
  const dir = project({ slices: { "docs/06-build/slice-01.md": "# Slice 01 — REQ-001, SEC-001\n" } });
  const r = run(dir, ["--require", "threat,authz,slices"]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /slices: REQ-002 is in the spec but no slice log delivers it/);
  assert.match(r.stdout, /slices: NFR-001 is in the spec but no slice log delivers it/);
});

test("a slice log that names no requirement is a log entry pretending to be work", () => {
  const dir = project({ slices: { ...ALL_SLICES, "docs/06-build/slice-03.md": "# Slice 03 — refactor\n" } });
  const r = run(dir, ["--require", "slices"]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /slice-03\.md references no REQ\/SEC\/NFR id/);
});

test("a missing threat model is NOT_VERIFIED with a command, not a pass", () => {
  const dir = project({ threat: null, slices: ALL_SLICES });
  const r = run(dir, ["--require", "threat"]);
  assert.equal(r.status, 3);
  assert.match(r.stdout, /RESULT: NOT_VERIFIED/);
  assert.match(r.stdout, /human command: write docs\/04-architecture\/threat-model\.md/);
});

test("missing slice logs at phase 06 are NOT_VERIFIED, with the reason the phase explains", () => {
  const dir = project({});
  const r = run(dir, ["--require", "threat,authz,slices"]);
  assert.equal(r.status, 3);
  assert.match(r.stdout, /no slice logs matching docs\/06-build\/slice-\*\.md/);
  assert.match(r.stdout, /slice logs arrive in phase 06/);
});

test("no spec is NOT_VERIFIED, never a silent pass", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plan-"));
  const r = run(dir);
  assert.equal(r.status, 3);
  assert.match(r.stdout, /no spec at docs\/02-spec\/SPEC\.md/);
});
