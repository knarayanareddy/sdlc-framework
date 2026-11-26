#!/usr/bin/env node
// Deterministic entry-point enumerator (v2-08 §8.1′ #6).
// The floor under the coverage ledger: a script lists every way into the app, so
// "examined" cannot be self-attested by an LLM that forgot a route.
//
//   node pipeline/tools/entrypoints.mjs --root . --out docs/08-redteam/run-1/entrypoints.json [--stable]
import fs from "node:fs";
import path from "node:path";
import { parseArgs, writeJson, walk, paint, fail } from "./lib/common.mjs";
import { assertScopeResolved, printScope, resolveScope } from "./lib/scope.mjs";

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

const frameworks = new Set();
const markFramework = (name) => frameworks.add(name);

const found = new Map();
const add = (entry) => {
  if (!found.has(entry.id)) found.set(entry.id, entry);
};

// `--root .` inside a repo that contains the pipeline itself used to enumerate the
// pipeline's own tools as application entry points.
// `walk` skips build/, out/ and dist/ so it does not index compiled output — but a Next app
// router can legitimately own `app/api/build/route.ts`, and that route was invisible
// (SECOND-OPINION-3 G-12). Those three names are skipped only when they hold no route file.
function holdsRoutes(dir) {
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
      const p = path.join(cur, entry.name);
      if (entry.isDirectory()) {
        if (!["node_modules", ".git"].includes(entry.name)) stack.push(p);
        continue;
      }
      if (/^(route|page)\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) return true;
    }
  }
  return false;
}

const BUILDISH = new Set(["build", "out", "dist"]);
function walkApp(dir, out = [], skip = new Set(["node_modules", ".git", ".next", "coverage", ".turbo", ".vercel"])) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    if (BUILDISH.has(entry.name) && !holdsRoutes(path.join(dir, entry.name))) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walkApp(p, out, skip);
    else if (entry.isFile()) out.push(p);
  }
  return out;
}

const files = walkApp(root)
  .filter((f) => path.relative(root, f).split(path.sep)[0] !== "pipeline")
  .filter((f) => CODE.test(f) && !IGNORE_FILE.test(f));

for (const abs of files) {
  const rel = path.relative(root, abs).split(path.sep).join("/");
  const text = fs.readFileSync(abs, "utf8");

  // 1. Route handlers: exported HTTP verbs.
  if (/\/route\.(ts|tsx|js|jsx|mjs|cjs)$/.test(rel)) {
    markFramework("next-app");
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
    markFramework("next-app");
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

  // 8. Express / Fastify / Hono route registrations. A server that mounts its routes in code
  // was invisible to a Next-only enumerator, so its coverage ledger could be empty and "clean"
  // (SECOND-OPINION-3 G-12).
  const mounted = /\b[A-Za-z_$][\w$]*(?:\.\w+)?\.(get|post|put|patch|delete|all|use)\s*\(\s*(?:"([^"]+)"|'([^']+)'|`([^`]+)`)/g;
  for (const m of text.matchAll(mounted)) {
    const verb = String(m[1]).toUpperCase();
    const route = (m[2] ?? m[3] ?? m[4] ?? "").trim();
    if (!route.startsWith("/")) continue;
    markFramework(/express|fastify|hono/.test(text) ? (/fastify/.test(text) ? "fastify" : /hono/.test(text) ? "hono" : "express") : "express");
    add({
      id: `route:${verb === "ALL" || verb === "USE" ? "ANY" : verb} ${route}`,
      kind: "route",
      file: rel,
      line: lineOf(text, m.index ?? 0),
      detail: `${verb} ${route} (mounted in code)`,
    });
  }

  // 9. Next pages router: pages/api/** is a route whatever the method.
  const pagesIdx = rel.indexOf("pages/api/");
  if (pagesIdx !== -1) {
    markFramework("next-pages");
    const route = `/api/${rel
      .slice(pagesIdx + "pages/api/".length)
      .replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, "")
      .replace(/\/index$/, "")}`.replace(/\/\[([^\]]+)\]/g, "/:$1");
    const methods = [...text.matchAll(/req\.method\s*===?\s*["'](GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)["']/g)].map((m) => m[1]);
    for (const verb of methods.length ? [...new Set(methods)] : ["ANY"]) {
      add({ id: `route:${verb} ${route}`, kind: "route", file: rel, line: 1, detail: `${verb} ${route} (pages router)` });
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

  // 7. Outbound fetches with a non-literal URL (SSRF surface). Backticks were excluded,
  // so the most common SSRF shape — fetch(`http://${userHost}/api`) — was invisible.
  const fetchRe = /\bfetch\(\s*(?:`[^`]*\$\{|[^)"'\s`])/g;
  for (const m of text.matchAll(fetchRe)) {
    add({ id: `fetch:${rel}:${lineOf(text, m.index ?? 0)}`, kind: "outboundFetch", file: rel, line: lineOf(text, m.index ?? 0), detail: "non-literal URL" });
  }
}

// Brownfield: --scope <prefix,...> and/or --changed-since <ref> restrict the enumeration to
// the part of the app that changed. The run says it was scoped, and a scope that selects
// nothing is NOT_VERIFIED rather than an empty (and therefore "clean") list.
const scope = resolveScope({ scope: flags.scope, changedSince: flags["changed-since"], cwd: process.cwd() });
assertScopeResolved(scope, `node pipeline/tools/entrypoints.mjs --root ${root} --changed-since <ref>   # or drop the scope flags`);
const entrypoints = [...found.values()]
  .filter((e) => !scope || scope.matches(e.file))
  .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
const counts = entrypoints.reduce((acc, e) => ({ ...acc, [e.kind]: (acc[e.kind] ?? 0) + 1 }), {});

const payload = {
  ...(stable ? {} : { generatedAt: new Date().toISOString() }),
  root: stable ? "." : path.basename(root),
  ...(scope ? { scoped: scope.label } : {}),
  // Which route conventions were recognised. An empty list with code in the tree means this
  // enumerator understood none of the app, which is NOT_VERIFIED, not an empty ledger.
  frameworks: [...frameworks].sort(),
  counts,
  total: entrypoints.length,
  entrypoints,
};

printScope(scope);
if (outPath) {
  writeJson(outPath, payload);
  console.log(`entrypoints: ${entrypoints.length} → ${path.relative(process.cwd(), outPath) || outPath}`);
  console.log(Object.entries(counts).map(([k, v]) => `  ${k}: ${v}`).join("\n"));
  if (entrypoints.length === 0) {
    console.log(
      paint.yellow(
        scope
          ? `NOT_VERIFIED: the scope (${scope.label}) contains no entry points, so coverage cannot be claimed`
          : "NOT_VERIFIED: no entry points found, so coverage cannot be claimed",
      ),
    );
    console.log(`human command: node pipeline/tools/entrypoints.mjs --root <the app directory> --out ${path.relative(process.cwd(), outPath) || outPath}`);
    process.exit(3);
  }
  if (entrypoints.every((e) => !["route", "page"].includes(e.kind))) {
    console.log(
      paint.yellow(
        `NOT_VERIFIED: no route convention matched (recognised: next app router, next pages/api, express, fastify, hono; found: ${[...frameworks].join(", ") || "none"})`,
      ),
    );
    console.log("human command: add the route registration to the coverage ledger by hand, or extend pipeline/tools/entrypoints.mjs");
    process.exit(3);
  }
} else {
  console.log(JSON.stringify(payload, null, 2));
  if (entrypoints.length === 0) fail("no entry points found");
}
