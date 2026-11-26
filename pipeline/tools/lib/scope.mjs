// Brownfield scoping (REVIEW-OF-SECOND-OPINION.md §7 P4).
//
// On a brownfield change, "enumerate every route" and "cover every entry point" are the wrong
// questions: the honest ones are about the files that changed. These helpers make a scoped run
// explicit — every tool that accepts them prints what it was scoped to and says in --json that
// the run is scoped, so a scoped green is never mistaken for a whole-project one.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export function changedSince(ref, cwd = process.cwd()) {
  // Includes the working tree: a run before the commit still has to see its own edits.
  const res = spawnSync("git", ["diff", "--name-only", String(ref), "--"], { cwd, encoding: "utf8" });
  if (res.status !== 0) return { error: (res.stderr ?? "").trim() || `git diff against ${ref} failed`, files: [] };
  return { error: null, files: res.stdout.split("\n").map((s) => s.trim()).filter(Boolean).map((f) => f.split(path.sep).join("/")) };
}

const under = (file, prefix) => {
  const f = String(file ?? "").replace(/\\/g, "/").replace(/^\.\//, "");
  const p = String(prefix).replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  return f === p || f.startsWith(`${p}/`);
};

/**
 * Resolve a scope from parsed --scope / --changed-since flags.
 * Returns null when the run is not scoped, so callers can print "whole project" honestly.
 */
export function resolveScope({ scope, changedSince: ref, cwd = process.cwd() } = {}) {
  if (!scope && !ref) return null;
  const parts = [];
  let files = null;
  if (ref) {
    const diff = changedSince(ref, cwd);
    if (diff.error) return { error: `--changed-since ${ref}: ${diff.error}` };
    files = diff.files;
    parts.push(`changed since ${ref} (${files.length} file${files.length === 1 ? "" : "s"})`);
  }
  if (scope) {
    const prefixes = String(scope).split(",").map((s) => s.trim()).filter(Boolean);
    files = files === null ? null : files.filter((f) => prefixes.some((p) => under(f, p)));
    parts.push(`under ${prefixes.join(", ")}`);
    // A pure --scope run has no file list to intersect with, so it is a predicate.
    return { label: parts.join(" and "), files, prefixes, matches: (file) => prefixes.some((p) => under(file, p)) };
  }
  const set = new Set(files);
  return { label: parts.join(" and "), files: set, prefixes: [], matches: (file) => set.has(String(file ?? "").replace(/\\/g, "/").replace(/^\.\//, "")) };
}

export function printScope(scope) {
  if (!scope) return;
  console.log(`SCOPED (${scope.label}): this run covers part of the project, not all of it`);
}

export function scopeFail(scope) {
  // A scope that selects nothing is not "everything is fine": it means the question was not
  // asked of anything.
  return scope.files !== null && scope.files.size === 0;
}

export function assertScopeResolved(scope, human) {
  if (scope?.error) {
    console.log(`NOT_VERIFIED: ${scope.error}`);
    if (human) console.log(`human command: ${human}`);
    process.exit(3);
  }
  if (scope && scopeFail(scope)) {
    console.log(`NOT_VERIFIED: the scope selected no files (${scope.label})`);
    if (human) console.log(`human command: ${human}`);
    process.exit(3);
  }
}

export function readMaybe(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
}
