// Cross-model routing and independence, tested as behaviour rather than as prose.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { familyOf, independence, candidateFamilies } from "./lib/families.mjs";
import { appendLedger } from "./lib/ledger.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const route = path.join(here, "verifier-route.mjs");
const indep = path.join(here, "independence.mjs");
const repoRoot = path.resolve(here, "..", "..");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "vr-"));

const cli = (script, args, opts = {}) =>
  spawnSync("node", [script, ...args], { encoding: "utf8", cwd: opts.cwd ?? repoRoot, input: opts.input });

test("family resolution: model ids map to families, unknown does not pretend", () => {
  assert.equal(familyOf("claude-sonnet-4"), "anthropic");
  assert.equal(familyOf("gpt-5"), "openai");
  assert.equal(familyOf("gemini-2.5-pro"), "google");
  assert.equal(familyOf("Qwen2.5-Coder"), "qwen");
  assert.equal(familyOf("mystery-model-9"), "unknown");
  assert.equal(familyOf(""), "unknown");
});

test("independence fails closed for same family and for unknown", () => {
  assert.equal(independence("claude-opus", "claude-sonnet").independent, false);
  assert.equal(independence("claude-opus", "gpt-5").independent, true);
  assert.equal(independence("mystery", "gpt-5").independent, false);
  assert.equal(independence("claude-opus", "mystery").independent, false);
  assert.deepEqual(candidateFamilies("claude-opus").slice(0, 2), ["openai", "google"]);
  assert.ok(!candidateFamilies("claude-opus").includes("anthropic"));
});

test("route refuses to send a task to the author's own family", () => {
  const d = tmp();
  const r = cli(route, ["route", "--author-model", "claude-sonnet", "--verifier-model", "claude-opus", "--out", path.join(d, "e.json")]);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /same family/i);
  assert.equal(fs.existsSync(path.join(d, "e.json")), false);
});

test("route without an author model is NOT_VERIFIED, not a guess", () => {
  const d = tmp();
  const r = cli(route, ["route", "--out", path.join(d, "e.json")]);
  assert.equal(r.status, 3);
  assert.match(r.stdout, /NOT_VERIFIED/);
  assert.match(r.stdout, /human command/);
});

test("a routed envelope is hash-sealed and names a different family", () => {
  const d = tmp();
  const out = path.join(d, "env.json");
  const r = cli(route, [
    "route", "--phase", "07", "--gate", "G7", "--author-model", "claude-sonnet-4",
    "--task", "compliance sweep", "--claim", "every REQ has a test|no route lacks authz",
    "--files", "README.md", "--out", out,
  ]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const env = JSON.parse(fs.readFileSync(out, "utf8"));
  assert.notEqual(env.verifier.family, env.author.family);
  assert.equal(env.claims.length, 2);
  assert.equal(env.envelopeHash.length, 64);
  assert.equal(env.files[0].path, "README.md");
});

test("dispatch with no transport is NOT_VERIFIED and prints what a human must run", () => {
  const d = tmp();
  const out = path.join(d, "env.json");
  cli(route, ["route", "--author-model", "claude-sonnet", "--files", "README.md", "--out", out]);
  const r = spawnSync("node", [route, "dispatch", "--envelope", out, "--out", path.join(d, "v.json")], {
    encoding: "utf8", cwd: repoRoot, env: { ...process.env, PIPELINE_VERIFIER_CMD: "" },
  });
  assert.equal(r.status, 3);
  assert.match(r.stdout, /no verifier transport configured/);
  assert.match(r.stdout, /PIPELINE_VERIFIER_CMD/);
});

test("dispatch rejects a verdict that answers a different envelope", () => {
  const d = tmp();
  const out = path.join(d, "env.json");
  cli(route, ["route", "--author-model", "claude-sonnet", "--claim", "x is true", "--files", "README.md", "--out", out]);
  const liar = path.join(d, "liar.mjs");
  fs.writeFileSync(liar, `process.stdout.write(JSON.stringify({envelopeHash:"${"0".repeat(64)}",model:"gpt-5",claims:[{id:"C1",verdict:"confirmed",evidence:["a:1"]}]}));`);
  const r = spawnSync("node", [route, "dispatch", "--envelope", out, "--cmd", `node ${liar}`, "--out", path.join(d, "v.json")], {
    encoding: "utf8", cwd: repoRoot,
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /envelopeHash mismatch/);
});

test("a real verdict must answer every claim with evidence", () => {
  const d = tmp();
  const out = path.join(d, "env.json");
  cli(route, ["route", "--author-model", "claude-sonnet", "--claim", "a|b", "--files", "README.md", "--out", out]);
  const env = JSON.parse(fs.readFileSync(out, "utf8"));
  const half = path.join(d, "half.mjs");
  fs.writeFileSync(half, `process.stdout.write(JSON.stringify({envelopeHash:"${env.envelopeHash}",model:"gpt-5",claims:[{id:"C1",verdict:"confirmed"}]}));`);
  const bad = spawnSync("node", [route, "dispatch", "--envelope", out, "--cmd", `node ${half}`, "--out", path.join(d, "v.json")], { encoding: "utf8", cwd: repoRoot });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /needs evidence/);
  assert.match(bad.stderr, /C2 was not answered/);

  const good = path.join(d, "good.mjs");
  fs.writeFileSync(good, `process.stdout.write(JSON.stringify({envelopeHash:"${env.envelopeHash}",model:"gpt-5",claims:[
    {id:"C1",verdict:"confirmed",evidence:["README.md:12"]},
    {id:"C2",verdict:"refuted",evidence:["src/x.ts:40"],note:"a route with no authz"}]}));`);
  const okRun = spawnSync("node", [route, "dispatch", "--envelope", out, "--cmd", `node ${good}`, "--out", path.join(d, "v.json")], { encoding: "utf8", cwd: repoRoot });
  assert.equal(okRun.status, 0, okRun.stderr);
  assert.match(okRun.stdout, /verdict accepted/);
  assert.match(okRun.stdout, /refuted/);
});

test("check catches an envelope edited after routing", () => {
  const d = tmp();
  const out = path.join(d, "env.json");
  cli(route, ["route", "--author-model", "claude-sonnet", "--files", "README.md", "--out", out]);
  const env = JSON.parse(fs.readFileSync(out, "utf8"));
  const verdictPath = path.join(d, "v.json");
  fs.writeFileSync(verdictPath, JSON.stringify({ envelopeHash: env.envelopeHash, model: "gpt-5", claims: [{ id: "C1", verdict: "confirmed", evidence: ["README.md:1"] }] }));
  env.claims[0].statement = "a claim the verifier never saw";
  fs.writeFileSync(out, JSON.stringify(env));
  const r = cli(route, ["check", "--envelope", out, "--verdict", verdictPath]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /edited after routing/);
});

function seedLedger(file, rows) {
  for (const [gate, model] of rows) {
    appendLedger(file, { phase: "07", gate, status: "passed", command: "true", exitCode: 0, commit: "abc1234", modelFamily: model, filesGivenToVerifier: ["docs/02-spec/SPEC.md"] });
  }
}

test("independence gate: all cross-family is a PASS", () => {
  const d = tmp();
  const ledger = path.join(d, "l.jsonl");
  seedLedger(ledger, [["G7", "gpt-5"], ["G9", "gemini-2.5-pro"]]);
  const r = cli(indep, ["--ledger", ledger, "--builder-family", "anthropic", "--require", "G7,G9", "--json"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.verdict, "PASS");
  assert.equal(out.independent, 2);
});

test("independence gate: a same-family verifier is a hard failure", () => {
  const d = tmp();
  const ledger = path.join(d, "l.jsonl");
  seedLedger(ledger, [["G7", "claude-opus"], ["G9", "gpt-5"]]);
  const r = cli(indep, ["--ledger", ledger, "--builder-family", "anthropic", "--require", "G7,G9"]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /SAME_FAMILY/);
  assert.match(r.stdout, /RESULT: FAIL/);
});

test("independence gate: no verifier recorded is NOT_VERIFIED, and --strict fails", () => {
  const d = tmp();
  const ledger = path.join(d, "l.jsonl");
  seedLedger(ledger, [["G7", null]]);
  const loose = cli(indep, ["--ledger", ledger, "--builder-family", "anthropic", "--require", "G7"]);
  assert.equal(loose.status, 3);
  assert.match(loose.stdout, /NOT_VERIFIED/);
  const strict = cli(indep, ["--ledger", ledger, "--builder-family", "anthropic", "--require", "G7", "--strict"]);
  assert.equal(strict.status, 3);
  assert.match(strict.stderr, /independence is required/);
});

test("independence gate: an unreadable ledger is NOT_VERIFIED with a command", () => {
  const r = cli(indep, ["--ledger", "/tmp/definitely-not-a-ledger.jsonl"]);
  assert.equal(r.status, 3);
  assert.match(r.stdout, /human command/);
});
