#!/usr/bin/env node
// Deterministic entry-point enumerator (v2-08 §8.1′ #6).
// The floor under the coverage ledger: a script lists every way into the app, so
// "examined" cannot be self-attested by an LLM that forgot a route.
//
//   node pipeline/tools/entrypoints.mjs --root . --out docs/08-redteam/run-1/entrypoints.json [--stable]
import fs from "node:fs";
import path from "node:path";
import { parseArgs, writeJson, walk, paint, fail } from "./lib/common.mjs";

const { flags } = parseArgs();
const root = path.resolve(flags.root ?? ".");
const outPath = flags.out ? path.resolve(flags.out) : null;
const stable = Boolean(flags.stable);

const CODE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const IGNORE_FILE = /\.(test|spec|stories)\.|\.d\.ts$/;

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

// /src/app/api/items/[id]/route.ts  →  /api/items/:id
function routePathFromFile(file) {
  const normalised = file.split(path.sep).join("/");
  const idx = normalised.startsWith("app/") ? 0 : normalised.indexOf("/app/");
  if (idx === -1) return null;
  const afterApp = normalised.slice(normalised.startsWith("app/") ? 4 : idx + 5);
  const dir = afterApp.split("/").slice(0, -1);
  const segments = dir
    .filter((s) => !(s.startsWith("(") && s.endsWith(")"))) // route groups
    .filter((s) => !s.startsWith("@")); // parallel slots
  const mapped = segments.map((s) => {
    if (/^\[\[\.\.\..+\]\]$/.test(s)) return "*";
    if (/^\[\.\.\..+\]$/.test(s)) return "*";
    if (/^\[.+\]$/.test(s)) return `:${s.slice(1, -1)}`;
    return s;
  });
  return `/${mapped.join("/")}`.replace(/\/$/, "") || "/";
}

function pageParams(file) {
  const normalised = file.split(path.sep).join("/");
  const idx = normalised.startsWith("app/") ? 0 : normalised.indexOf("/app/");
  if (idx === -1) return [];
  return normalised
    .slice(normalised.startsWith("app/") ? 4 : idx + 5)
    .split("/")
    .filter((s) => /^\[.+\]$/.test(s))
    .map((s) => s.slice(1, -1));
}

const found = new Map();
const add = (entry) => {
  if (!found.has(entry.id)) found.set(entry.id, entry);
};

const files = walk(root).filter((f) => CODE.test(f) && !IGNORE_FILE.test(f));

for (const abs of files) {
  const rel = path.relative(root, abs).split(path.sep).join("/");
  const text = fs.readFileSync(abs, "utf8");

  // 1. Route handlers: exported HTTP verbs.
  if (/\/route\.(ts|tsx|js|jsx|mjs|cjs)$/.test(rel)) {
    const base = routePathFromFile(rel);
    for (const m of text.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)) {
      add({ id: `route:${m[1]} ${base}`, kind: "route", file: rel, line: lineOf(text, m.index ?? 0), detail: `${m[1]} ${base}` });
    }
    for (const m of text.matchAll(/export\s+const\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*=/g)) {
      add({ id: `route:${m[1]} ${base}`, kind: "route", file: rel, line: lineOf(text, m.index ?? 0), detail: `${m[1]} ${base}` });
    }
  }

  // 2. Pages with dynamic params.
  if (/\/page\.(tsx|jsx|ts|js)$/.test(rel)) {
    const base = routePathFromFile(rel) ?? "/";
    const params = pageParams(rel);
    add({
      id: `page:${base}`,
      kind: "page",
      file: rel,
      line: 1,
      detail: params.length ? `params: ${params.join(", ")}` : "static",
    });
  }

  // 3. Middleware.
  if (/(^|\/)(middleware|proxy)\.(ts|js|mjs)$/.test(rel)) {
    add({ id: `middleware:${rel}`, kind: "middleware", file: rel, line: 1, detail: "request interception" });
  }

  // 4. Server actions / server modules.
  if (/["']use server["']/.test(text)) {
    for (const m of text.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/g)) {
      add({ id: `action:${rel}#${m[1]}`, kind: "serverAction", file: rel, line: lineOf(text, m.index ?? 0), detail: m[1] });
    }
    for (const m of text.matchAll(/export\s+const\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?\(/g)) {
      add({ id: `action:${rel}#${m[1]}`, kind: "serverAction", file: rel, line: lineOf(text, m.index ?? 0), detail: m[1] });
    }
  }

  // 5. Environment reads (a config boundary: secrets and mode switches).
  for (const m of text.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
    add({ id: `env:${m[1]}`, kind: "env", file: rel, line: lineOf(text, m.index ?? 0), detail: m[1] });
  }
  for (const m of text.matchAll(/process\.env\[\s*["']([A-Z0-9_]+)["']\s*\]/g)) {
    add({ id: `env:${m[1]}`, kind: "env", file: rel, line: lineOf(text, m.index ?? 0), detail: m[1] });
  }

  // 6. Raw SQL escape hatches.
  for (const m of text.matchAll(/\b(sql\.raw|\.unsafe)\s*\(/g)) {
    add({ id: `rawSql:${rel}:${lineOf(text, m.index ?? 0)}`, kind: "rawSql", file: rel, line: lineOf(text, m.index ?? 0), detail: m[1] });
  }

  // 7. Outbound fetches with a non-literal URL (SSRF surface).
  for (const m of text.matchAll(/\bfetch\(\s*([^)"'\s`])/g)) {
    add({ id: `fetch:${rel}:${lineOf(text, m.index ?? 0)}`, kind: "outboundFetch", file: rel, line: lineOf(text, m.index ?? 0), detail: "non-literal URL" });
  }
}

const entrypoints = [...found.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
const counts = entrypoints.reduce((acc, e) => ({ ...acc, [e.kind]: (acc[e.kind] ?? 0) + 1 }), {});

const payload = { ...(stable ? {} : { generatedAt: new Date().toISOString() }), root: stable ? "." : path.basename(root), counts, total: entrypoints.length, entrypoints };

if (outPath) {
  writeJson(outPath, payload);
  console.log(`entrypoints: ${entrypoints.length} → ${path.relative(process.cwd(), outPath) || outPath}`);
  console.log(Object.entries(counts).map(([k, v]) => `  ${k}: ${v}`).join("\n"));
  if (entrypoints.length === 0) {
    console.log(paint.yellow("warn: no entry points found; point --root at the app directory"));
  }
} else {
  console.log(JSON.stringify(payload, null, 2));
  if (entrypoints.length === 0) fail("no entry points found");
}
