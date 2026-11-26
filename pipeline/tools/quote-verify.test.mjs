import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const TOOL = fileURLToPath(new URL("./quote-verify.mjs", import.meta.url));

function setup({ page, claims }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qv-"));
  const pageFile = path.join(dir, "page.txt");
  fs.writeFileSync(pageFile, page);
  const extracts = path.join(dir, "extracts");
  fs.mkdirSync(extracts);
  fs.writeFileSync(
    path.join(extracts, "reader-1.json"),
    JSON.stringify({
      url: pathToFileURL(pageFile).href,
      accessed: "2026-11-26",
      sourceType: "forum",
      injectionSuspected: false,
      claims,
    }),
  );
  const args = [
    TOOL,
    "--extracts", extracts,
    "--snapshots", path.join(dir, "snapshots"),
    "--log", path.join(dir, "quote-verify.log"),
    "--write-ledger", path.join(dir, "evidence-ledger.md"),
  ];
  const res = spawnSync("node", args, { encoding: "utf8" });
  return { dir, res };
}

const PAGE = "The onboarding flow took me four attempts.\nI gave up and used a spreadsheet instead.";

test("a quote that is a real substring of the page is verified", () => {
  const { res, dir } = setup({ page: PAGE, claims: [{ claim: "onboarding is hard", quote: "took me four attempts", confidence: "H" }] });
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /verified: 1/);
  assert.match(fs.readFileSync(path.join(dir, "evidence-ledger.md"), "utf8"), /verified/);
});

test("whitespace and curly quotes are normalised before matching", () => {
  const { res } = setup({ page: "It’s   “seamless” — allegedly.", claims: [{ claim: "x", quote: "it's \"seamless\" - allegedly", confidence: "M" }] });
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /verified: 1/);
});

test("HTML tags and entities in a snapshot do not break matching", () => {
  const { res } = setup({ page: "<p>Four attempts &amp; then I quit.</p>", claims: [{ claim: "quit", quote: "attempts & then I quit", confidence: "H" }] });
  assert.equal(res.status, 0, res.stdout + res.stderr);
});

test("an invented quote is not-found and the run fails over the threshold", () => {
  const { res, dir } = setup({
    page: PAGE,
    claims: [
      { claim: "real", quote: "used a spreadsheet instead", confidence: "H" },
      { claim: "invented", quote: "the tool changed my life and saved 40% of my week", confidence: "H" },
    ],
  });
  assert.equal(res.status, 1);
  const log = fs.readFileSync(path.join(dir, "quote-verify.log"), "utf8");
  assert.match(log, /not-found/);
  assert.match(res.stdout, /not-found rate: 50\.0%/);
});

test("a tiny quote is rejected rather than matching everywhere", () => {
  const { res } = setup({ page: PAGE, claims: [{ claim: "x", quote: "the", confidence: "L" }] });
  assert.equal(res.status, 1);
});

test("an unreachable page is reported separately from a wrong quote", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qv-"));
  const extracts = path.join(dir, "extracts");
  fs.mkdirSync(extracts);
  fs.writeFileSync(
    path.join(extracts, "reader.json"),
    JSON.stringify({ url: "https://example.invalid/x", accessed: "2026-11-26", sourceType: "forum", claims: [{ claim: "x", quote: "some long enough quote", confidence: "H" }] }),
  );
  const res = spawnSync("node", [TOOL, "--extracts", extracts, "--snapshots", path.join(dir, "s"), "--log", path.join(dir, "l.log")], { encoding: "utf8" });
  assert.match(res.stdout, /unreachable pages: 1/);
});

test("no extracts means nothing was checked, which is a failure", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qv-"));
  fs.mkdirSync(path.join(dir, "extracts"));
  const res = spawnSync("node", [TOOL, "--extracts", path.join(dir, "extracts"), "--log", path.join(dir, "l.log")], { encoding: "utf8" });
  assert.equal(res.status, 1);
  assert.match(res.stderr + res.stdout, /no claims found/);
});
