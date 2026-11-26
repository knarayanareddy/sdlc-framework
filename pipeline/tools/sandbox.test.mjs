// The sandbox is only worth having if its protections are real. Each test here executes
// something and checks the effect, not the documentation.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const sandbox = path.join(here, "sandbox.mjs");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "sbx-"));

const run = (args, opts = {}) =>
  spawnSync("node", [sandbox, ...args], {
    encoding: "utf8",
    cwd: opts.cwd ?? here,
    env: { ...process.env, ...(opts.env ?? {}) },
    timeout: 60_000,
  });

test("check reports capabilities as data, and never boasts", () => {
  const r = run(["check", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const caps = JSON.parse(r.stdout);
  assert.equal(caps.platform, process.platform);
  assert.equal(typeof caps.networkNamespace.available, "boolean");
  assert.equal(typeof caps.docker.available, "boolean");
  assert.ok(caps.networkNamespace.how.length > 0);
});

test("the environment is scrubbed: an inherited secret is not passed through", () => {
  const d = tmp();
  const out = path.join(d, "r.json");
  const r = run(["run", "--cmd", "node -e \"process.stdout.write(String(process.env.SECRET_TOKEN||'absent'))\"", "--out", out], {
    env: { SECRET_TOKEN: "leak-me" },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "absent");
  const rec = JSON.parse(fs.readFileSync(out, "utf8"));
  assert.equal(rec.controls.envScrubbed, true);
  assert.ok(rec.notes.some((n) => /secret-looking/.test(n)));
});

test("--keep-env is an explicit, narrow exception", () => {
  const r = run(["run", "--keep-env", "SECRET_TOKEN", "--cmd", "node -e \"process.stdout.write(String(process.env.SECRET_TOKEN||'absent'))\""], {
    env: { SECRET_TOKEN: "leak-me" },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "leak-me");
});

test("the command runs in a fresh workdir, so it cannot write to your tree", () => {
  const src = tmp();
  fs.writeFileSync(path.join(src, "marker.txt"), "original\n");
  const d = tmp();
  const out = path.join(d, "r.json");
  const r = run(["run", "--copy", src, "--cmd", "cat marker.txt > /dev/null && echo mutated > marker.txt && pwd", "--out", out]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(path.join(src, "marker.txt"), "utf8").trim(), "original");
  const rec = JSON.parse(fs.readFileSync(out, "utf8"));
  assert.equal(rec.isolated, true);
  assert.notEqual(path.resolve(r.stdout.trim()), path.resolve(src));
});

test("a timeout actually kills the process", () => {
  const d = tmp();
  const out = path.join(d, "r.json");
  const r = run(["run", "--timeout", "700", "--cmd", "node -e \"setTimeout(()=>{},30000)\"", "--out", out]);
  assert.equal(r.status, 124, r.stderr);
  const rec = JSON.parse(fs.readFileSync(out, "utf8"));
  assert.equal(rec.timedOut, true);
  assert.ok(rec.durationMs < 5000, `took ${rec.durationMs} ms`);
});

test("output is capped instead of filling the disk", () => {
  const d = tmp();
  const out = path.join(d, "r.json");
  const r = run(["run", "--max-output", "500", "--cmd", "node -e \"console.log('x'.repeat(200000))\"", "--out", out]);
  const rec = JSON.parse(fs.readFileSync(out, "utf8"));
  assert.equal(rec.truncated, true);
  assert.ok(rec.stdoutBytes > 500);
  assert.ok(r.stdout.length <= 500);
});

test("network denial is applied or declared NOT_VERIFIED, never assumed", () => {
  const caps = JSON.parse(run(["check", "--json"]).stdout);
  const d = tmp();
  const out = path.join(d, "r.json");
  const r = run(["run", "--deny-network", "--cmd", "echo hi", "--out", out]);
  const rec = JSON.parse(fs.readFileSync(out, "utf8"));
  if (caps.networkNamespace.available) {
    assert.equal(rec.controls.networkDenied, true);
  } else {
    assert.equal(rec.controls.networkDenied, "NOT_VERIFIED");
    assert.match(r.stderr, /NOT_VERIFIED: networkDenied/);
  }
});

test("--require-all refuses to call an unverified execution sandboxed", () => {
  const caps = JSON.parse(run(["check", "--json"]).stdout);
  const r = run(["run", "--deny-network", "--require-all", "--cmd", "echo hi"]);
  if (caps.networkNamespace.available) assert.equal(r.status, 0, "netns is available, so nothing is unverified");
  else {
    assert.equal(r.status, 3);
    assert.match(r.stderr, /refusing to call this execution sandboxed/);
  }
});

test("the generated profile passes, and tampering with it does not", () => {
  const d = tmp();
  const file = path.join(d, "docker-compose.sandbox.yml");
  const gen = run(["profile", "--out", file]);
  assert.equal(gen.status, 0, gen.stderr);
  assert.match(gen.stdout, /passes every control check/);
  assert.equal(run(["verify", "--file", file]).status, 0);

  const text = fs.readFileSync(file, "utf8");
  const tamper = (from, to) => {
    const bad = path.join(d, `bad-${Math.random().toString(16).slice(2)}.yml`);
    fs.writeFileSync(bad, text.replace(from, to));
    return run(["verify", "--file", bad]);
  };

  assert.equal(tamper('network_mode: "none"', "network_mode: host").status, 1);
  assert.equal(tamper("read_only: true", "read_only: false").status, 1);
  assert.equal(tamper("cap_drop:\n      - ALL", "cap_add:\n      - ALL").status, 1);

  const privileged = path.join(d, "priv.yml");
  fs.writeFileSync(privileged, text.replace("    pids_limit: 128", "    pids_limit: 128\n    privileged: true"));
  const r = run(["verify", "--file", privileged]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /privileged mode/);

  const sock = path.join(d, "sock.yml");
  fs.writeFileSync(sock, text.replace("      - ./:/work:ro", "      - ./:/work:ro\n      - /var/run/docker.sock:/var/run/docker.sock"));
  assert.match(run(["verify", "--file", sock]).stdout, /docker socket/);
});
