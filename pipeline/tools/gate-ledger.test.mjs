import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendLedger, readLedger, verifyLedger, hashEntry } from "./lib/ledger.mjs";
import { ZERO_HASH } from "./lib/common.mjs";

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ledger-")), "l.jsonl");

test("the first entry chains to the genesis hash", () => {
  const file = tmp();
  const first = appendLedger(file, { phase: "00", gate: "G0", status: "passed", command: "true", exitCode: 0 });
  assert.equal(first.prevHash, ZERO_HASH);
  assert.equal(first.seq, 0);
  assert.equal(verifyLedger(file).ok, true);
});

test("entries chain to each other and verify", () => {
  const file = tmp();
  appendLedger(file, { gate: "G0", status: "passed", command: "true", exitCode: 0 });
  const second = appendLedger(file, { gate: "G1", status: "passed", command: "true", exitCode: 0 });
  const entries = readLedger(file);
  assert.equal(second.prevHash, entries[0].hash);
  assert.equal(verifyLedger(file).ok, true);
});

test("editing a historical line breaks the chain", () => {
  const file = tmp();
  appendLedger(file, { gate: "G0", status: "passed", command: "true", exitCode: 0 });
  const lines = fs.readFileSync(file, "utf8").trim().split("\n");
  lines[0] = lines[0].replace('"passed"', '"failed"');
  fs.writeFileSync(file, `${lines.join("\n")}\n`);
  const result = verifyLedger(file);
  assert.equal(result.ok, false);
  assert.match(result.error, /hash mismatch/);
});

test("deleting a middle line breaks the chain", () => {
  const file = tmp();
  for (const gate of ["G0", "G1", "G2"]) appendLedger(file, { gate, status: "passed", command: "true", exitCode: 0 });
  const lines = fs.readFileSync(file, "utf8").trim().split("\n");
  fs.writeFileSync(file, `${[lines[0], lines[2]].join("\n")}\n`);
  assert.equal(verifyLedger(file).ok, false);
});

test("an empty ledger is not a valid chain", () => {
  const file = tmp();
  fs.writeFileSync(file, "");
  assert.equal(verifyLedger(file).ok, false);
});

test("unknown fields are refused rather than silently dropped", () => {
  const file = tmp();
  assert.throws(() => appendLedger(file, { gate: "G0", status: "passed", sneaky: true }), /unknown field/);
});

test("the hash does not depend on key order", () => {
  const base = { prevHash: ZERO_HASH, seq: 0, at: "x", phase: null, gate: "G0", status: "passed", command: "true", exitCode: 0, commit: null, evidence: null, filesGivenToVerifier: null, modelFamily: null };
  const reordered = Object.fromEntries(Object.entries(base).reverse());
  assert.equal(hashEntry(base), hashEntry(reordered));
});
