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
  // A file the run just wrote is not tracked yet, and `git diff` cannot see it. A scoped run
  // that omitted untracked files checked nothing while saying it had (SECOND-OPINION-3 G-20).
  const untracked = spawnSync("git", ["ls-files", "-o", "--exclude-standard"], { cwd, encoding: "utf8" });
  const list = [res.stdout, untracked.status === 0 ? untracked.stdout : ""]
    .join("\n")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((f) => f.split(path.sep).join("/"));
  return { error: null, files: [...new Set(list)] };
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
    // The two flags intersect. This used to return a prefix predicate as soon as --scope was
    // present, so `--changed-since HEAD --scope pages` ignored the ref while the label claimed
    // both, and `scopeFail` never fired because the result is an array, not a Set.
    files = files === null ? null : files.filter((f) => prefixes.some((p) => under(f, p)));
    parts.push(`under ${prefixes.join(", ")}`);
    const inScope = (file) => {
      const f = String(file ?? "").replace(/\\/g, "/").replace(/^\.\//, "");
      if (!prefixes.some((p) => under(f, p))) return false;
      return files === null || files.includes(f);
    };
    return { label: parts.join(" and "), files: files === null ? null : files, prefixes, matches: inScope };
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
  if (scope.files === null) return false;
  return (scope.files instanceof Set ? scope.files.size : scope.files.length) === 0;
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
