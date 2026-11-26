// "The file exists and is 64 bytes" was the whole check for design docs and slice logs, so a
// file of "a" closed them (SECOND-OPINION-3 B-33). These tests are the bypass and its fix.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const TOOL = fileURLToPath(new URL("./expect-files.mjs", import.meta.url));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "expect-"));
const run = (cwd, args) => spawnSync("node", [TOOL, ...args], { cwd, encoding: "utf8" });

const DOC = [
  "# Design brief",
  "",
  "For a small team that keeps a shared list. The register is quick and unglamorous: rows, ruled lines,",
  "a small square checkbox, no card grid. The signature element is the row itself, which stays in place",
  "while the title strikes through on mark-read, so REQ-001 costs no layout shift and SEC-001 stays visible.",
  "Banned defaults avoided: centred hero, three icon cards, purple gradient.",
  "",
].join("\n");

test("64 bytes of 'a' is not a document", () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "brief.md"), "a".repeat(200));
  assert.equal(run(dir, ["brief.md", "--substance"]).status, 1);
  fs.writeFileSync(path.join(dir, "brief.md"), DOC);
  const ok = run(dir, ["brief.md", "--substance"]);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a placeholder is not a document, however long", () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "brief.md"), `${DOC}\nTODO: write the rest\n`);
  const r = run(dir, ["brief.md", "--substance"]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /PROBLEM substance/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("--require-id asks the doc to name a requirement: slice logs must", () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, "docs/06-build"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "docs/06-build/slice-01.md"),
    [
      "# Slice 01",
      "",
      "Red: `node --test tests/items.test.mjs` failed, because canRead did not exist yet.",
      "Green: `src/lib/can-read.mjs` added and the suite passes; the handler calls it before rendering.",
      "Tripwire: the mapping is honoured, checked by running the gate command before the commit.",
      "Commit: one vertical slice, no scaffolding behind it, nothing half-wired.",
      "What a reviewer should be able to check from this log: the failing test is named, the file that",
      "makes it pass is named, and the tripwire that has to run before the commit is written down.",
      "Anything not covered by this slice is listed in the next one, not implied here.",
      "",
    ].join("\n"),
  );
  assert.equal(run(dir, ["--glob", "docs/06-build/slice-*.md", "--substance"]).status, 0);
  const strict = run(dir, ["--glob", "docs/06-build/slice-*.md", "--substance", "--require-id"]);
  assert.equal(strict.status, 1, strict.stdout);
  fs.appendFileSync(path.join(dir, "docs/06-build/slice-01.md"), "Covers REQ-001.\n");
  assert.equal(run(dir, ["--glob", "docs/06-build/slice-*.md", "--substance", "--require-id"]).status, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a JSON artefact has to parse, not just weigh enough", () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "tokens.json"), JSON.stringify({ only: "x".repeat(80) }));
  assert.equal(run(dir, ["tokens.json", "--substance"]).status, 1, "one key is not a token set");
  // three keys, and over the byte floor, so only the parse decides
  fs.writeFileSync(path.join(dir, "tokens.json"), JSON.stringify({ colour: { ink: "#111", paper: "#fff" }, space: 4, type: "sans" }));
  assert.equal(run(dir, ["tokens.json", "--substance"]).status, 0);
  fs.writeFileSync(path.join(dir, "tokens.json"), "{not json at all, but long enough to pass a byte floor ................}");
  assert.equal(run(dir, ["tokens.json", "--substance"]).status, 1, "unparseable JSON is not evidence");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("without --substance the byte floor is unchanged", () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "brief.md"), "a".repeat(200));
  assert.equal(run(dir, ["brief.md"]).status, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});
