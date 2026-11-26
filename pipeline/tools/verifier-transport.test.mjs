// The last-mile transport is the only part that needs a credential, so it is tested for
// everything that does not: request shape, redaction, and refusing to pretend it ran.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const here = path.dirname(new URL(import.meta.url).pathname);
const transport = path.resolve(here, "..", "examples", "verifier-transport.example.mjs");
const route = path.join(here, "verifier-route.mjs");
const repoRoot = path.resolve(here, "..", "..");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "vt-"));

function envelope(d, extra = []) {
  const out = path.join(d, "env.json");
  const r = spawnSync("node", [route, "route", "--author-model", "claude-sonnet", "--claim", "x", "--files", "README.md", "--out", out, ...extra], { encoding: "utf8", cwd: repoRoot });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(fs.readFileSync(out, "utf8"));
}

test("--dry-run prints the exact request and never calls out", () => {
  const d = tmp();
  const env = envelope(d);
  const r = spawnSync("node", [transport, "--dry-run"], {
    encoding: "utf8",
    input: JSON.stringify({ prompt: "verify these claims", envelope: env }),
    env: { ...process.env, PIPELINE_VERIFIER_URL: "https://api.example.com/v1/chat", PIPELINE_VERIFIER_KEY: "", PIPELINE_VERIFIER_MODEL: "gpt-5" },
  });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.dryRun, true);
  assert.equal(out.request.url, "https://api.example.com/v1/chat");
  assert.equal(out.request.method, "POST");
  assert.equal(out.request.body.model, "gpt-5");
  assert.equal(out.request.body.messages.length, 2);
  assert.equal(out.request.body.temperature, 0);
  // The prompt must not appear in a dry run, and the key must never appear at all.
  assert.ok(!r.stdout.includes("verify these claims"));
  assert.match(out.request.headers.authorization, /redacted|no PIPELINE_VERIFIER_KEY/);
  assert.ok(out.missing.includes("PIPELINE_VERIFIER_KEY"));
});

test("a configured but unreachable endpoint is NOT_VERIFIED, not a fake verdict", () => {
  const d = tmp();
  const env = envelope(d);
  const r = spawnSync("node", [transport], {
    encoding: "utf8",
    input: JSON.stringify({ prompt: "verify", envelope: env }),
    env: { ...process.env, PIPELINE_VERIFIER_URL: "http://127.0.0.1:9/v1/chat", PIPELINE_VERIFIER_KEY: "k", PIPELINE_VERIFIER_MODEL: "gpt-5" },
    timeout: 30_000,
  });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /NOT_VERIFIED/);
  assert.match(r.stderr, /human command/);
  assert.equal(r.stdout.trim(), "");
});

test("missing credentials are NOT_VERIFIED with the variables named", () => {
  const d = tmp();
  const env = envelope(d);
  const clean = { ...process.env };
  delete clean.PIPELINE_VERIFIER_URL;
  delete clean.PIPELINE_VERIFIER_KEY;
  const r = spawnSync("node", [transport], { encoding: "utf8", input: JSON.stringify({ prompt: "x", envelope: env }), env: clean });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /PIPELINE_VERIFIER_URL/);
});

test("a sealed envelope stays a refusal if the envelope is broken", () => {
  const r = spawnSync("node", [transport], { encoding: "utf8", input: JSON.stringify({ prompt: "x", envelope: {} }) });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /missing or unsealed/);
});

test("non-JSON on stdin does not become a request", () => {
  const r = spawnSync("node", [transport], { encoding: "utf8", input: "not json at all" });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /stdin was not the JSON envelope/);
});
