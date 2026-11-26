// Append-only, hash-chained gate ledger (v2-00 §4).
// Hash = sha256(prevHash + "|" + canonical(entryWithoutHash)).
// Editing any historical line breaks the chain, which is the tamper test at G0.

import fs from "node:fs";
import path from "node:path";
import { ZERO_HASH, canonical, ensureDir, sha256 } from "./common.mjs";

export const LEDGER_FIELDS = Object.freeze([
  "seq",
  "at",
  "phase",
  "gate",
  "status",
  "command",
  "exitCode",
  "commit",
  "evidence",
  "filesGivenToVerifier",
  "modelFamily",
  "prevHash",
]);

export function hashEntry(entry) {
  const { hash: _ignored, ...rest } = entry;
  return sha256(`${entry.prevHash}|${canonical(rest)}`);
}

export function readLedger(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

export function appendLedger(file, entry) {
  const entries = readLedger(file);
  const prevHash = entries.length ? entries[entries.length - 1].hash : ZERO_HASH;

  const known = new Set(LEDGER_FIELDS);
  for (const key of Object.keys(entry)) {
    if (!known.has(key)) throw new Error(`ledger: refusing unknown field "${key}"`);
  }

  const record = {};
  for (const field of LEDGER_FIELDS) record[field] = entry[field] ?? null;
  record.seq = entries.length;
  record.at = new Date().toISOString();
  record.prevHash = prevHash;
  record.hash = hashEntry(record);

  ensureDir(path.dirname(file));
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`);
  return record;
}

export function verifyLedger(file) {
  const entries = readLedger(file);
  if (entries.length === 0) {
    return { ok: false, count: 0, error: "ledger is empty: no genesis entry" };
  }
  let prev = ZERO_HASH;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.seq !== i) return { ok: false, count: entries.length, error: `entry ${i}: seq is ${e.seq}` };
    if (e.prevHash !== prev) return { ok: false, count: entries.length, error: `entry ${i}: prevHash does not chain to entry ${i - 1}` };
    if (e.hash !== hashEntry(e)) return { ok: false, count: entries.length, error: `entry ${i} (${e.gate ?? "?"}): hash mismatch, the line was edited after it was written` };
    prev = e.hash;
  }
  return { ok: true, count: entries.length, error: null };
}
