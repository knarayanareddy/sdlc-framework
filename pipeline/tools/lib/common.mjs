// Shared helpers for every pipeline tool. Node built-ins only: the pipeline must not
// acquire a dependency tree of its own (v2-00 install policy, R-04).

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

export const ZERO_HASH = "0".repeat(64);

export const sha256 = (s) => crypto.createHash("sha256").update(String(s), "utf8").digest("hex");

// Stable JSON: keys sorted, so a hash never depends on key order.
export function canonical(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
}

// --flag value | --flag=value | --flag  →  { flags, positional }
export function parseArgs(argv = process.argv.slice(2)) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq > -1) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          flags[a.slice(2)] = next;
          i++;
        } else {
          flags[a.slice(2)] = true;
        }
      }
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

export function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    if (fallback !== undefined) return fallback;
    throw new Error(`could not read JSON from ${file}: ${err.message}`);
  }
}

export function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function exists(p) {
  return fs.existsSync(p);
}

// A file that exists but is empty (or nearly) is not evidence.
export function substantialFile(p, minBytes = 64) {
  try {
    return fs.statSync(p).size >= minBytes;
  } catch {
    return false;
  }
}

export function run(cmd, { cwd = process.cwd(), timeout = 900_000, env } = {}) {
  const started = Date.now();
  const res = spawnSync(cmd, {
    cwd,
    shell: true,
    encoding: "utf8",
    timeout,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, ...env },
  });
  return {
    code: res.status === null ? 1 : res.status,
    signal: res.signal,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
    durationMs: Date.now() - started,
  };
}

const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const wrap = (n) => (s) => (useColor ? `\u001b[${n}m${s}\u001b[0m` : String(s));

export const paint = {
  bold: wrap(1),
  dim: wrap(2),
  red: wrap(31),
  green: wrap(32),
  yellow: wrap(33),
  blue: wrap(34),
  magenta: wrap(35),
  cyan: wrap(36),
};

export function ok(msg) {
  console.log(paint.green(msg));
}
export function warn(msg) {
  console.log(paint.yellow(`warn: ${msg}`));
}
export function fail(msg, code = 1) {
  console.error(paint.red(`error: ${msg}`));
  process.exit(code);
}

// Recursive walk that never descends into the usual noise.
export function walk(dir, out = [], skip = new Set(["node_modules", ".git", ".next", "dist", "build", "out", "coverage", ".turbo", ".vercel"])) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out, skip);
    else if (entry.isFile()) out.push(p);
  }
  return out;
}

// Tiny glob → RegExp: ** crosses directories, * does not, ? is one char.
export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
        if (glob[i + 1] === "/") i++;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}
