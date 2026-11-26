#!/usr/bin/env node
// Snapshot + quote verification (v2-01 stages B and C).
// A claim in the research ledger is only allowed to support the thesis if its
// quote is a literal substring of a stored snapshot of the page.
//
//   node pipeline/tools/quote-verify.mjs --extracts docs/01-research/extracts \
//        --snapshots docs/01-research/snapshots --log docs/01-research/quote-verify.log \
//        [--fetch] [--write-ledger docs/01-research/evidence-ledger.md] [--max-not-found 20]
//
// Snapshot sources: file: URLs always work (used by the self-test); http(s) needs
// network access and --fetch. Without --fetch, a missing snapshot is `page-unreachable`.
import fs from "node:fs";

import path from "node:path";
import { parseArgs, sha256, ensureDir, paint, fail } from "./lib/common.mjs";

const { flags } = parseArgs();
const extractsDir = flags.extracts ?? "docs/01-research/extracts";
const snapshotsDir = flags.snapshots ?? "docs/01-research/snapshots";
const logPath = flags.log ?? "docs/01-research/quote-verify.log";
const doFetch = Boolean(flags.fetch);
const maxNotFound = Number(flags["max-not-found"] ?? 20);
const writeLedger = flags["write-ledger"];

if (!fs.existsSync(extractsDir)) fail(`no extracts directory at ${extractsDir}`);

// Comparison normalises case, whitespace, quote glyphs and dashes, and strips HTML.
// Word order and wording are never altered: that is what makes a match meaningful.
function normalise(text) {
  return String(text)
    .replace(/[\u2018\u2019\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201F\u2033]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u00a0/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// A `file:` source is a page the agent could have written itself, so it may only point at
// the research directory — otherwise a builder can vouch for its own claim by writing the
// "page" it quotes (M-01). The temp dir used to be allowed too, which made every /tmp file a
// citable source and made the suite fail on a clone that lived under /tmp
// (SECOND-OPINION-3 G-10, G-11).
function fileSourceAllowed(target) {
  const allowed = [path.resolve(process.cwd(), "docs", "01-research")];
  const real = (() => {
    try {
      return fs.realpathSync(target);
    } catch {
      return path.resolve(target);
    }
  })();
  return allowed.some((root) => real === root || real.startsWith(`${root}${path.sep}`));
}

const provenance = (snap) => ({
  // What was hashed, what the hash is, and how it got here. The reader's own `accessed`
  // date is self-reported; this is not.
  snapshotFile: snap.file ? path.relative(process.cwd(), snap.file).split(path.sep).join("/") : null,
  snapshotSha256: snap.text ? sha256(snap.text) : null,
  snapshotVia: snap.status,
});

async function snapshot(url) {
  const file = path.join(snapshotsDir, `${sha256(url)}.txt`);
  if (fs.existsSync(file)) return { status: "cached", text: fs.readFileSync(file, "utf8"), file };
  if (url.startsWith("file:")) {
    // Accept an absolute file URL and a workspace-relative "file:docs/..." path, so an
    // example or an offline run can verify quotes with no network at all.
    const raw = url.slice(5).replace(/^\/\//, "");
    const target = path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
    if (!fs.existsSync(target)) return { status: "page-unreachable", text: null, file };
    if (!fileSourceAllowed(target)) {
      return { status: "page-unreachable", text: null, file, note: "file: sources are limited to docs/01-research/" };
    }
    const text = fs.readFileSync(target, "utf8");
    ensureDir(snapshotsDir);
    fs.writeFileSync(file, text);
    return { status: "fetched", text, file };
  }
  if (!/^https?:/.test(url)) return { status: "page-unreachable", text: null, file };
  if (!doFetch) return { status: "page-unreachable", text: null, file, note: "network fetch not enabled (--fetch)" };
  try {
    const res = await fetch(url, { headers: { "user-agent": "sdlc-pipeline-quote-verify/2" }, redirect: "follow" });
    if (!res.ok) return { status: "page-unreachable", text: null, file, note: `HTTP ${res.status}` };
    const raw = await res.text();
    ensureDir(snapshotsDir);
    fs.writeFileSync(file, raw);
    return { status: "fetched", text: raw, file };
  } catch (err) {
    return { status: "page-unreachable", text: null, file, note: err.message };
  }
}

const extractFiles = fs.existsSync(extractsDir)
  ? fs
      .readdirSync(extractsDir)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => path.join(extractsDir, f))
  : [];

const lines = [];
const rows = [];
const totals = { claims: 0, verified: 0, notFound: 0, unreachable: 0, quarantined: 0 };
const seen = new Map();

for (const file of extractFiles) {
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    lines.push(`invalid-json ${path.basename(file)}: ${err.message}`);
    continue;
  }
  const docs = Array.isArray(doc) ? doc : [doc];
  for (const d of docs) {
    if (!d.url) {
      lines.push(`invalid ${path.basename(file)}: object has no url`);
      continue;
    }
    const snap = await snapshot(d.url);
    if (!snap.text) {
      totals.unreachable += 1;
      lines.push(`page-unreachable ${d.url}${snap.note ? ` (${snap.note})` : ""}`);
      continue;
    }
    const haystack = normalise(snap.text);
    // A page that tried to instruct the reader is evidence of an attack, not evidence for a
    // claim: its quotes are set aside, never written to the ledger, and counted separately
    // (M-01). It used to log one line and then verify the claim anyway.
    if (d.injectionSuspected) {
      totals.quarantined += (d.claims ?? []).length;
      lines.push(`quarantined ${d.url} :: injection suspected — ${(d.claims ?? []).length} claim(s) set aside, no ledger rows`);
      continue;
    }
    for (const claim of d.claims ?? []) {
      totals.claims += 1;
      const needle = normalise(claim.quote ?? "");
      const tooShort = needle.length < 8;
      const found = !tooShort && haystack.includes(needle);
      if (found) {
        totals.verified += 1;
        let id = seen.get(d.url);
        if (!id) {
          id = `E-${String(seen.size + 1).padStart(2, "0")}`;
          seen.set(d.url, id);
        }
        const prov = provenance(snap);
        rows.push(
          `| ${id} | ${claim.claim ?? ""} | ${d.url} | ${d.accessed ?? "unknown"} | ${d.sourceType ?? "unknown"} | ${claim.confidence ?? "?"} | verified | \`${String(prov.snapshotSha256).slice(0, 16)}…\` (${prov.snapshotVia}) |`.replace(/\n/g, " "),
        );
        lines.push(`verified ${d.url} :: ${needle.slice(0, 60)}${needle.length > 60 ? "…" : ""} :: snapshot ${prov.snapshotSha256} (${prov.snapshotVia})`);
      } else {
        totals.notFound += 1;
        lines.push(
          tooShort
            ? `not-found ${d.url} :: quote is shorter than 8 characters, too weak to verify`
            : `not-found ${d.url} :: ${needle.slice(0, 60)}${needle.length > 60 ? "…" : ""}`,
        );
      }
    }
  }
}

ensureDir(path.dirname(logPath));
fs.writeFileSync(logPath, `${lines.join("\n")}\n`);

const rate = totals.claims ? (totals.notFound / totals.claims) * 100 : 0;

if (writeLedger) {
  const header = [
    "# Evidence ledger (generated by quote-verify)",
    "",
    "Only `verified` rows may support thesis, ideas-ranked or any requirement rationale.",
    "",
    "| E-id | claim | source URL | date accessed | source type | confidence | status | snapshot |",
    "|---|---|---|---|---|---|---|---|",
  ].join("\n");
  ensureDir(path.dirname(writeLedger));
  fs.writeFileSync(writeLedger, `${header}\n${rows.join("\n")}\n`);
}

console.log(`claims: ${totals.claims}  verified: ${totals.verified}  not-found: ${totals.notFound}  unreachable pages: ${totals.unreachable}  quarantined: ${totals.quarantined}`);
if (totals.quarantined) console.log(paint.yellow(`${totals.quarantined} claim(s) were quarantined: a page that tries to instruct the reader cannot support the thesis`));
if (totals.notFound) console.log(`not-found rate: ${rate.toFixed(1)}% (threshold ${maxNotFound}%)`);
if (writeLedger) console.log(`ledger written: ${writeLedger} (${rows.length} verified rows)`);
console.log(`log: ${logPath}`);

if (totals.verified === 0 && totals.quarantined > 0) {
  console.log(paint.yellow("NOT_VERIFIED: every claim was quarantined, so no quote supports anything"));
  console.log("human command: review the flagged pages by hand; if they are safe, re-run the reader with the page's text pasted in and injectionSuspected reviewed");
  process.exit(3);
}
if (totals.claims === 0) {
  console.log(paint.yellow("warn: no claims found; the reader agent produced nothing to check"));
  console.log("RESULT: FAIL");
  process.exit(1);
}
if (rate > maxNotFound) {
  console.log(paint.red(`PROBLEM not-found rate ${rate.toFixed(1)}% exceeds ${maxNotFound}%; distrust the reader output and re-run stage A`));
  console.log("RESULT: FAIL");
  process.exit(1);
}
console.log("RESULT: PASS");
