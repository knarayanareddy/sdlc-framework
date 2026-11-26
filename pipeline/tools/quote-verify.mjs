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

async function snapshot(url) {
  const file = path.join(snapshotsDir, `${sha256(url)}.txt`);
  if (fs.existsSync(file)) return { status: "cached", text: fs.readFileSync(file, "utf8"), file };
  if (url.startsWith("file:")) {
    // Accept an absolute file URL and a workspace-relative "file:docs/..." path, so an
    // example or an offline run can verify quotes with no network at all.
    const raw = url.slice(5).replace(/^\/\//, "");
    const target = path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
    if (!fs.existsSync(target)) return { status: "page-unreachable", text: null, file };
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
const totals = { claims: 0, verified: 0, notFound: 0, unreachable: 0 };
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
    for (const claim of d.claims ?? []) {
      totals.claims += 1;
      if (d.injectionSuspected) lines.push(`injection-suspected ${d.url}`);
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
        rows.push(
          `| ${id} | ${claim.claim ?? ""} | ${d.url} | ${d.accessed ?? "unknown"} | ${d.sourceType ?? "unknown"} | ${claim.confidence ?? "?"} | verified |`.replace(/\n/g, " "),
        );
        lines.push(`verified ${d.url} :: ${needle.slice(0, 60)}${needle.length > 60 ? "…" : ""}`);
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
    "| E-id | claim | source URL | date accessed | source type | confidence | status |",
    "|---|---|---|---|---|---|---|",
  ].join("\n");
  ensureDir(path.dirname(writeLedger));
  fs.writeFileSync(writeLedger, `${header}\n${rows.join("\n")}\n`);
}

console.log(`claims: ${totals.claims}  verified: ${totals.verified}  not-found: ${totals.notFound}  unreachable pages: ${totals.unreachable}`);
if (totals.notFound) console.log(`not-found rate: ${rate.toFixed(1)}% (threshold ${maxNotFound}%)`);
if (writeLedger) console.log(`ledger written: ${writeLedger} (${rows.length} verified rows)`);
console.log(`log: ${logPath}`);

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
