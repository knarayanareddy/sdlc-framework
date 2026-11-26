// Append-only, hash-chained gate ledger (v2-00 §4).
// Hash = sha256(prevHash + "|" + canonical(entryWithoutHash)).
//
// What this does and does not buy you (read this before quoting it):
//   · Detects an accidental edit or a naive in-place line change: an edited line no
//     longer matches its own hash, so `verifyLedger` reports the entry.
//   · Does NOT stop an agent that truncates the tail, recomputes the whole chain, or
//     writes entries with `gate-ledger.mjs append`. The chain is unkeyed and lives in
//     the same working tree the agent can write to.
//   · Two defences narrow that gap without a secret:
//       - `verifyLedger(file, { progress })` cross-checks the ledger against
//         docs/progress.json, so deleting trailing lines leaves gates that progress
//         still claims were recorded.
//       - every entry records `tree`, a hash of the tracked + untracked source files
//         the gate actually saw, so a post-gate source edit is visible.
//   · Set PIPELINE_LEDGER_KEY (outside the build agent's environment) and each entry
//     also carries an HMAC. Recomputed chains then fail unless the agent has the key.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { ZERO_HASH, canonical, ensureDir, sha256 } from "./common.mjs";

export const LEDGER_FIELDS = Object.freeze([
  "seq",
  "at",
  "phase",
  "gate",
  "status",
  "command",
  "commandSource",
  "exitCode",
  "commit",
  "tree",
  "evidence",
  "filesGivenToVerifier",
  "modelFamily",
  "prevHash",
  "hmac",
]);

// Orchestrator-written state that changes on every gate. Hashing it into `tree` would make
// every entry differ from every other for reasons unrelated to the code under test.
const TREE_SKIP = Object.freeze([
  "docs/progress.json",
  "docs/gate-ledger.jsonl",
  "docs/FINAL-REPORT.md",
]);

export function hashEntry(entry) {
  const { hash: _ignored, hmac: _seal, ...rest } = entry;
  return sha256(`${entry.prevHash}|${canonical(rest)}`);
}

// A deterministic hash of the files a gate actually ran against: every tracked and
// untracked-but-not-ignored file, minus the orchestrator's own state files.
// Returns null when git is unavailable, so callers record "unknown" rather than a lie.
export function treeSha(cwd = process.cwd(), { skip = TREE_SKIP } = {}) {
  const res = spawnSync("git", ["ls-files", "-z", "-co", "--exclude-standard"], {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0 || typeof res.stdout !== "string") return null;
  const files = res.stdout.split("\0").filter(Boolean).filter((f) => !skip.includes(f)).sort();
  const hash = crypto.createHash("sha256");
  for (const file of files) {
    hash.update(file);
    hash.update("\0");
    try {
      hash.update(fs.readFileSync(path.join(cwd, file)));
    } catch {
      hash.update("<unreadable>");
    }
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function ledgerKey(env = process.env) {
  const key = env.PIPELINE_LEDGER_KEY;
  return key && key.length >= 16 ? key : null;
}

const seal = (hash, key) => (key ? crypto.createHmac("sha256", key).update(hash).digest("hex") : null);

// Never throws: a truncated or hand-edited line is reported, not crashed on.
export function readLedgerSafe(file) {
  if (!fs.existsSync(file)) return { entries: [], error: null };
  const lines = fs
    .readFileSync(file, "utf8")
    .split("\n")
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => line.trim().length > 0);
  const entries = [];
  for (const { line, n } of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      return {
        entries,
        error: `line ${n} is not valid JSON — the ledger was truncated mid-write or edited by hand (${line.slice(0, 60)}…)`,
      };
    }
  }
  return { entries, error: null };
}

export function readLedger(file) {
  const { entries, error } = readLedgerSafe(file);
  if (error) throw new Error(`ledger: ${error}`);
  return entries;
}

export function appendLedger(file, entry, { cwd = process.cwd(), env = process.env } = {}) {
  const { entries, error } = readLedgerSafe(file);
  if (error) throw new Error(`ledger: refusing to append to a corrupt ledger — ${error}`);
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
  if (!record.tree) record.tree = treeSha(cwd);
  record.hash = hashEntry(record);
  const key = ledgerKey(env);
  if (key) record.hmac = seal(record.hash, key);
  else delete record.hmac;

  ensureDir(path.dirname(file));
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`);
  return record;
}

export function verifyLedger(file, { progress = null, requireHmac = false, env = process.env } = {}) {
  const { entries, error } = readLedgerSafe(file);
  if (error) return { ok: false, count: entries.length, error };
  if (entries.length === 0) {
    return { ok: false, count: 0, error: "ledger is empty: no genesis entry" };
  }
  let prev = ZERO_HASH;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.seq !== i) return { ok: false, count: entries.length, error: `entry ${i}: seq is ${e.seq}` };
    if (e.prevHash !== prev) return { ok: false, count: entries.length, error: `entry ${i}: prevHash does not chain to entry ${i - 1}` };
    if (e.hash !== hashEntry(e)) return { ok: false, count: entries.length, error: `entry ${i} (${e.gate ?? "?"}): hash mismatch, the line was edited after it was written` };
    const key = ledgerKey(env);
    if (key && e.hmac && e.hmac !== seal(e.hash, key)) {
      return { ok: false, count: entries.length, error: `entry ${i} (${e.gate ?? "?"}): HMAC does not match PIPELINE_LEDGER_KEY` };
    }
    if (requireHmac && !e.hmac) {
      return {
        ok: false,
        count: entries.length,
        error: `entry ${i} (${e.gate ?? "?"}) carries no HMAC: set PIPELINE_LEDGER_KEY outside the build agent's environment and re-record`,
      };
    }
    prev = e.hash;
  }

  // Cross-check against progress.json: the only defence against a truncated tail, because
  // deleting the last lines of a hash chain leaves the remaining chain perfectly valid.
  if (progress) {
    const last = new Map();
    for (const e of entries) if (e.gate) last.set(e.gate, e);
    for (const [gate, g] of Object.entries(progress.gates ?? {})) {
      const e = last.get(gate);
      if (!e) {
        return {
          ok: false,
          count: entries.length,
          error: `${gate} is recorded in progress.json but has no ledger entry — the ledger was truncated or the gate was written by hand`,
        };
      }
      if (e.status !== g.status) {
        return { ok: false, count: entries.length, error: `${gate}: progress.json says ${g.status}, the ledger says ${e.status}` };
      }
    }
    for (const [id, p] of Object.entries(progress.phases ?? {})) {
      if (p?.status !== "done") continue;
      if (!last.has(`P${id}`)) {
        return { ok: false, count: entries.length, error: `phase ${id} is done in progress.json but has no ledger entry` };
      }
    }
  }

  return { ok: true, count: entries.length, error: null };
}
