// Cross-model routing and independence, tested as behaviour rather than as prose.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { familyOf, independence, candidateFamilies } from "./lib/families.mjs";
import { appendLedger } from "./lib/ledger.mjs";
import { sha256 } from "./lib/common.mjs";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
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

// A fixture project with a known file, so the citations below resolve against real lines.
function project(label = "vr") {
  const d = tmp();
  fs.mkdirSync(path.join(d, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(d, "src", "items.ts"),
    ["export function deleteItem(id: string, ownerId: string) {", "  return db.items.delete({ id });", "}", ""].join("\n"),
  );
  fs.writeFileSync(path.join(d, "SPEC.md"), ["# SPEC", "", "### REQ-002 Links are private", ""].join("\n"));
  return d;
}

const routeIn = (d, extra = []) =>
  cli(route, ["route", "--author-model", "claude-sonnet", "--claim", "a|b", "--files", "src/items.ts", "--out", path.join(d, "env.json"), ...extra], { cwd: d });

const verdictRunner = (d, makeBody) => {
  const env = JSON.parse(fs.readFileSync(path.join(d, "env.json"), "utf8"));
  const file = path.join(d, `v-${Math.random().toString(16).slice(2)}.mjs`);
  fs.writeFileSync(file, `process.stdout.write(JSON.stringify(${JSON.stringify(makeBody(env))}));`);
  return spawnSync("node", [route, "check", "--envelope", path.join(d, "env.json"), "--verdict", file.replace(/\.mjs$/, ".mjs")], { encoding: "utf8", cwd: d });
};

// `check` reads a verdict FILE, and since 2.7.2 it also wants the attestation `dispatch`
// leaves next to it. Writing it here keeps the tests about the verdict's content; the absence
// of an attestation is its own test below.
const checkVerdictFile = (d, makeBody, extra = []) => {
  const env = JSON.parse(fs.readFileSync(path.join(d, "env.json"), "utf8"));
  const vf = path.join(d, "verdicts.json");
  fs.writeFileSync(vf, JSON.stringify(makeBody(env)));
  fs.writeFileSync(
    `${vf}.attest`,
    JSON.stringify({
      verdictSha256: sha256(fs.readFileSync(vf, "utf8")),
      envelopeHash: env.envelopeHash,
      transport: "test transport",
      at: new Date().toISOString(),
    }),
  );
  return cli(route, ["check", "--envelope", path.join(d, "env.json"), "--verdict", vf, ...extra], { cwd: d });
};

test("the verifier is shown the files, not just their names (F-01)", () => {
  const d = project();
  const promptFile = path.join(d, "prompt.md");
  const r = routeIn(d, ["--write-prompt", promptFile]);
  assert.equal(r.status, 0, r.stdout + r.stderr);

  const env = JSON.parse(fs.readFileSync(path.join(d, "env.json"), "utf8"));
  assert.match(String(env.files[0].text), /deleteItem/, "the envelope must carry the excerpt");
  assert.equal(env.files[0].lines, 3);

  const prompt = fs.readFileSync(promptFile, "utf8");
  // The defect: the prompt listed "src/items.ts (169 bytes)" and then demanded a file:line.
  assert.match(prompt, /1 \| export function deleteItem/);
  assert.match(prompt, /3 \| \}/);
  assert.match(prompt, /never be shown|not shown here|outside your evidence/i);
  assert.doesNotMatch(prompt, /^- src\/items\.ts \(\d+ bytes\)$/m, "the file list alone is not the prompt");
});

test("a directory in --files is expanded, not treated as a file (F-10)", () => {
  const d = project();
  const r = cli(route, ["route", "--author-model", "claude-sonnet", "--files", "src", "--out", path.join(d, "env.json")], { cwd: d });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const env = JSON.parse(fs.readFileSync(path.join(d, "env.json"), "utf8"));
  assert.deepEqual(env.files.map((f) => f.path), ["src/items.ts"]);
});

test("a claim backed by a file:line the verifier could see is accepted", () => {
  const d = project();
  routeIn(d);
  const r = checkVerdictFile(
    d,
    (env) => ({
      schemaVersion: 1,
      envelopeHash: env.envelopeHash,
      model: "gpt-5",
      claims: [
        { id: "C1", verdict: "confirmed", evidence: ["src/items.ts:1"] },
        { id: "C2", verdict: "corrected", evidence: ["src/items.ts:1-2"], note: "ownerId is accepted and ignored" },
      ],
    }),
    ["--allow-refuted"],
  );
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /verdict accepted/);
});

test("a citation to a file that was never provided is rejected as from memory (F-11)", () => {
  const d = project();
  routeIn(d);
  const r = checkVerdictFile(d, (env) => ({
    envelopeHash: env.envelopeHash,
    model: "gpt-5",
    claims: [{ id: "C1", verdict: "confirmed", evidence: ["src/authz.ts:88"] }],
  }));
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /src\/authz\.ts.*came from memory/);
});

test("a citation to a line beyond the excerpt is rejected", () => {
  const d = project();
  routeIn(d);
  const r = checkVerdictFile(d, (env) => ({
    envelopeHash: env.envelopeHash,
    model: "gpt-5",
    claims: [{ id: "C1", verdict: "confirmed", evidence: ["src/items.ts:900"] }],
  }));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /only 3 line\(s\) were shown/);
});

test("a verdict with no model and no family cannot be judged independent (F-16)", () => {
  const d = project();
  routeIn(d);
  const r = checkVerdictFile(d, (env) => ({
    envelopeHash: env.envelopeHash,
    claims: [{ id: "C1", verdict: "confirmed", evidence: ["src/items.ts:1"] }],
  }));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /neither a model nor a family/);
});

test("a refuted claim fails the gate, and --allow-refuted records it instead", () => {
  const d = project();
  routeIn(d);
  const refuted = (env) => ({
    envelopeHash: env.envelopeHash,
    model: "gpt-5",
    claims: env.claims.map((c) => ({ id: c.id, verdict: "refuted", evidence: ["src/items.ts:2"], note: "ownerId is never checked" })),
  });
  const strict = checkVerdictFile(d, refuted);
  assert.equal(strict.status, 1);
  assert.match(strict.stderr, /claim\(s\) were not confirmed/);

  const allowed = checkVerdictFile(d, refuted, ["--allow-refuted"]);
  assert.equal(allowed.status, 0, allowed.stderr);
  assert.match(allowed.stdout, /verdict accepted/);
});

test("an insufficient claim must name the missing fact", () => {
  const d = project();
  routeIn(d);
  const r = checkVerdictFile(d, (env) => ({
    envelopeHash: env.envelopeHash,
    model: "gpt-5",
    claims: [{ id: "C1", verdict: "insufficient" }, { id: "C2", verdict: "insufficient", missing: "the schema of db.items" }],
  }), ["--allow-refuted"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /C1: "insufficient" must name the missing fact/);
  assert.doesNotMatch(r.stderr, /C2: "insufficient"/);
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

// ---- P2 · independence must fail closed when the builder is unknown (F-02) -------------
test("independence is NOT_VERIFIED when the builder's family is unknown, never PASS", () => {
  const d = tmp();
  const ledger = path.join(d, "l.jsonl");
  seedLedger(ledger, [["G7", "gpt-5"], ["G9", "gemini-2.5-pro"]]);
  // This is the defect: with no builder family, both rows were INDEPENDENT and the tool
  // printed RESULT: PASS, exit 0 — "openai verified a unknown build".
  const r = cli(indep, ["--ledger", ledger, "--require", "G7,G9"]);
  assert.equal(r.status, 3, r.stdout + r.stderr);
  assert.match(r.stdout, /RESULT: NOT_VERIFIED/);
  assert.match(r.stdout, /builder's own family is unknown/);
  assert.match(r.stdout, /--builder-family/);
  assert.doesNotMatch(r.stdout, /INDEPENDENT/);
  assert.doesNotMatch(r.stdout, /RESULT: PASS/);
});

test("the builder family is derived from PIPELINE_BUILDER_MODEL when it is not declared", () => {
  const d = tmp();
  const ledger = path.join(d, "l.jsonl");
  seedLedger(ledger, [["G7", "gpt-5"], ["G9", "claude-opus"]]);
  const res = spawnSync("node", [indep, "--ledger", ledger, "--require", "G7,G9", "--json"], {
    encoding: "utf8",
    cwd: repoRoot,
    env: { ...process.env, PIPELINE_BUILDER_MODEL: "claude-sonnet-4" },
  });
  assert.equal(res.status, 1, "the same-family verifier must be caught, not waved through");
  const out = JSON.parse(res.stdout);
  assert.equal(out.builderFamily, "anthropic");
  assert.equal(out.builderFamilySource, 'model id "claude-sonnet-4"');
  assert.equal(out.rows.find((x) => x.gate === "G9").state, "SAME_FAMILY");
  assert.equal(out.rows.find((x) => x.gate === "G7").state, "INDEPENDENT");
});

test("an oversized file is truncated and the prompt says so", () => {
  const d = project();
  fs.writeFileSync(path.join(d, "big.txt"), "x".repeat(250_000));
  const promptFile = path.join(d, "prompt.md");
  const r = cli(route, ["route", "--author-model", "claude-sonnet", "--files", "big.txt", "--out", path.join(d, "env.json"), "--write-prompt", promptFile], { cwd: d });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const env = JSON.parse(fs.readFileSync(path.join(d, "env.json"), "utf8"));
  assert.equal(env.files[0].bytes, 250_000);
  assert.equal(env.files[0].truncated, true);
  assert.ok(env.files[0].text.length <= 200_000);
  assert.match(fs.readFileSync(promptFile, "utf8"), /truncated/);
});

// ---------------------------------------------------------------------------
// P7 · 2.7.2 — a verdict is evidence only when dispatch produced it (G-06)
// ---------------------------------------------------------------------------
test("a hand-written verdict with no dispatch attestation is NOT_VERIFIED", () => {
  const d = project();
  assert.equal(routeIn(d).status, 0);
  const env = JSON.parse(fs.readFileSync(path.join(d, "env.json"), "utf8"));
  const vf = path.join(d, "forged.json");
  // The builder holds the envelope, so it can echo the hash. Before 2.7.2 that was enough.
  fs.writeFileSync(vf, JSON.stringify({ envelopeHash: env.envelopeHash, model: "gpt-5", claims: [{ id: "C1", verdict: "confirmed", evidence: ["src/items.ts:2"] }] }));

  const r = cli(route, ["check", "--envelope", path.join(d, "env.json"), "--verdict", vf], { cwd: d });
  assert.equal(r.status, 3, r.stdout + r.stderr);
  assert.match(r.stdout, /no \.attest|not produced by dispatch/);
});

test("a verdict edited after dispatch is rejected", () => {
  const d = project();
  assert.equal(routeIn(d).status, 0);
  const vf = path.join(d, "verdicts.json");
  fs.writeFileSync(vf, JSON.stringify({ envelopeHash: JSON.parse(fs.readFileSync(path.join(d, "env.json"), "utf8")).envelopeHash, model: "gpt-5" }));
  const env = JSON.parse(fs.readFileSync(path.join(d, "env.json"), "utf8"));
  fs.writeFileSync(`${vf}.attest`, JSON.stringify({ verdictSha256: sha256(fs.readFileSync(vf, "utf8")), envelopeHash: env.envelopeHash, at: new Date().toISOString() }));
  fs.writeFileSync(vf, JSON.stringify({ ...JSON.parse(fs.readFileSync(vf, "utf8")), model: "gemini-2.5-pro" }));

  const r = cli(route, ["check", "--envelope", path.join(d, "env.json"), "--verdict", vf], { cwd: d });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /was edited after dispatch/);
});
