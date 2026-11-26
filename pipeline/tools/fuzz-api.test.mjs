// The fuzzer is tested against two servers it starts itself: one that listens and one that
// validates. If it cannot tell them apart, it is decoration.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const fuzz = path.join(here, "fuzz-api.mjs");

function makeServer({ strict }) {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > 4 * 1024 * 1024) {
        req.destroy();
      }
    });
    req.on("end", () => {
      const json = (code, obj) => {
        res.writeHead(code, { "content-type": "application/json" });
        res.end(JSON.stringify(obj));
      };
      if (!strict) {
        // The failure mode this tool exists to find: it trusts everything and crashes on shapes.
        if (req.method === "POST" && req.url === "/api/items") {
          try {
            const parsed = JSON.parse(body);
            // Trusts the shape it was given: a wrong type reaches the handler and crashes.
            if (parsed.quantity !== undefined && typeof parsed.quantity !== "number") throw new Error("NaN");
            if (body.length > 2 * 1024 * 1024) return json(201, { ok: true });
            if (String(parsed.title ?? "").includes("<script>")) {
              res.writeHead(200, { "content-type": "text/html" });
              return res.end(`<div>${parsed.title}</div>`);
            }
            return json(201, { id: 1 });
          } catch {
            return json(500, { error: "boom" });
          }
        }
        if (req.method === "GET" && req.url.startsWith("/api/items/")) {
          if (req.url.includes("etc%2fpasswd")) {
            res.writeHead(200, { "content-type": "text/plain" });
            return res.end("root:x:0:0:root:/root:/bin/bash\n");
          }
          return json(200, { id: 1 });
        }
        if (req.method === "DELETE" || req.method === "OPTIONS") return json(501, { error: "not implemented" });
        return json(404, {});
      }
      // Strict: rejects what the contract says must be rejected.
      if (req.method === "POST" && req.url === "/api/items") {
        if (body.length > 1024) return json(413, { error: "too large" });
        let parsed;
        try {
          parsed = JSON.parse(body);
        } catch {
          return json(400, { error: "invalid json" });
        }
        const allowed = new Set(["title", "quantity"]);
        for (const k of Object.keys(parsed)) if (!allowed.has(k)) return json(400, { error: `unknown field ${k}` });
        if (parsed.quantity !== undefined && typeof parsed.quantity !== "number") return json(400, { error: "quantity must be a number" });
        if (typeof parsed.title === "string" && parsed.title.length > 200) return json(400, { error: "title too long" });
        return json(201, { id: 1 });
      }
      if (req.method === "GET" && req.url.startsWith("/api/items/")) return json(200, { id: 1 });
      if (req.method === "DELETE" || req.method === "OPTIONS" || req.method === "PUT") return json(405, { error: "method not allowed" });
      return json(404, {});
    });
  });
  return server;
}

const dirs = [];
function contractFile(port) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "fuzz-"));
  dirs.push(d);
  const file = path.join(d, "api-contract.json");
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        baseUrl: `http://127.0.0.1:${port}`,
        endpoints: [
          {
            method: "POST",
            path: "/api/items",
            body: { unknownFields: "reject", fields: { title: { type: "string", maxLength: 200 }, quantity: { type: "integer", min: 1 } } },
            responses: { ok: [200, 201], clientError: [400, 401, 403, 404, 405, 409, 413, 415, 422, 429] },
          },
          { method: "GET", path: "/api/items/1" },
        ],
      },
      null,
      2,
    ),
  );
  return file;
}

const execFileAsync = promisify(execFile);

// Async on purpose: the fake servers live in THIS process, so a spawnSync here would block
// the event loop that has to answer the fuzzer's requests.
async function runFuzz(contractFile_, extra = []) {
  try {
    const { stdout, stderr } = await execFileAsync("node", [fuzz, "--contract", contractFile_, ...extra], { timeout: 120_000 });
    return { status: 0, stdout, stderr };
  } catch (err) {
    return { status: err.code ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

const servers = [];
const ports = new Map();

// Listen on demand: a hook that races the tests is exactly the flakiness this pipeline bans.
async function port(strict) {
  if (ports.has(strict)) return ports.get(strict);
  const s = makeServer({ strict });
  await new Promise((resolve) => s.listen(0, "127.0.0.1", resolve));
  servers.push(s);
  ports.set(strict, s.address().port);
  return ports.get(strict);
}

after(() => {
  for (const s of servers) s.close();
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

test("it finds the violations in a server that trusts its input", async () => {
  const contract = contractFile(await port(false));
  const out = path.join(path.dirname(contract), "fuzz.json");
  const leads = path.join(path.dirname(contract), "leads.json");
  const r = await runFuzz(contract, ["--out", out, "--leads", leads]);
  assert.equal(r.status, 1, r.stderr + r.stdout);
  const report = JSON.parse(fs.readFileSync(out, "utf8"));
  const rules = new Set(report.violations.map((v) => v.rule));
  for (const expected of ["server-error", "mass-assignment", "missing-body-limit", "reflected-xss", "path-traversal", "unhandled-method"]) {
    assert.ok(rules.has(expected), `expected ${expected}, got ${[...rules].join(", ")}`);
  }
  const leadFile = JSON.parse(fs.readFileSync(leads, "utf8"));
  assert.ok(leadFile.leads.length >= 6);
  assert.equal(leadFile.leads[0].tool, "pipeline-fuzz");
  assert.match(leadFile.leads[0].text, /:/);
  assert.match(r.stdout, /LEADS for a hunter, not findings/);
});

test("it stays quiet on a server that validates, and says CLEAN", async () => {
  const contract = contractFile(await port(true));
  const out = path.join(path.dirname(contract), "fuzz.json");
  const r = await runFuzz(contract, ["--out", out]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const report = JSON.parse(fs.readFileSync(out, "utf8"));
  assert.deepEqual(report.violations, [], JSON.stringify(report.violations, null, 2));
  assert.equal(report.result, "CLEAN");
  assert.match(r.stdout, /RESULT: CLEAN/);
});

test("an unreachable target is NOT_VERIFIED, not a pass", async () => {
  const contract = contractFile(9); // port 9 (discard) — nothing listens
  const r = await runFuzz(contract);
  assert.equal(r.status, 3);
  assert.match(r.stdout, /NOT_VERIFIED/);
  assert.match(r.stdout, /human command/);
});

test("a missing contract is NOT_VERIFIED with the reason", () => {
  const r = spawnSync("node", [fuzz, "--contract", "/tmp/no-such-contract.json"], { encoding: "utf8" });
  assert.equal(r.status, 3);
  assert.match(r.stdout, /no contract/);
});

test("the report always records how many cases ran", async () => {
  const contract = contractFile(await port(true));
  const out = path.join(path.dirname(contract), "fuzz.json");
  await runFuzz(contract, ["--out", out]);
  const report = JSON.parse(fs.readFileSync(out, "utf8"));
  assert.ok(report.cases >= 10, `only ${report.cases} cases`);
  assert.ok(report.observations.length >= report.cases - 1);
});
