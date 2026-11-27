#!/usr/bin/env node
// Protected-path check (v2-00 §3, closes half of R-02).
// A builder may add new tests; it may not edit, delete or weaken existing ones, and
// it may not touch the gate tools, the state file, the ledger or the control plane.
//
//   node pipeline/tools/protected-paths.mjs [--ref HEAD] [--config pipeline.config.json] [--json]
//
// Exit codes: 0 clean · 1 violation · 3 couldn't evaluate (no git) → record NOT_VERIFIED.
import fs from "node:fs";
import { parseArgs, readJson, run, globToRegExp, paint, sha256 } from "./lib/common.mjs";
import { verifyLedger } from "./lib/ledger.mjs";

const { flags } = parseArgs();
const configPath = flags.config ?? "pipeline.config.json";
const config = fs.existsSync(configPath) ? readJson(configPath) : {};

// The diff base is the commit recorded when the project was initialised, not HEAD.
// Comparing against HEAD let a builder commit its edits and present a clean tree
// (`changed files: 0 RESULT: PASS`) — see REVIEW-OF-SECOND-OPINION.md, F-14.
const progressPath = flags.progress ?? "docs/progress.json";
const progress = fs.existsSync(progressPath) ? readJson(progressPath) : {};
const baseCommit = flags.ref ?? progress.baseCommit ?? null;
const ref = baseCommit ?? "HEAD";
const asJson = Boolean(flags.json);
const strict = Boolean(flags.strict);

// `orchestratorOwned` paths are written by the orchestrator itself between commits, so a
// git diff cannot tell its writes from a builder's. They are reported as warnings unless
// --strict. Their integrity is enforced by the hash-chained ledger and validate-progress,
// which a builder cannot fake without breaking the chain.
const DEFAULT_PROTECTED = [
  { glob: "tests/**", allowNew: true, why: "tests are append-only after the red baseline" },
  { glob: "pipeline/tools/**", allowNew: true, why: "the gate tool must not be edited by the agent it gates" },
  { glob: "pipeline/bin/**", allowNew: false, why: "the orchestrator must not be edited by the agent it orchestrates" },
  { glob: "pipeline.config.json", allowNew: false, why: "the config maps every gate to the command it runs" },
  { glob: "docs/02-spec/SPEC.sha256", allowNew: true, why: "the frozen spec hash; only `pipeline freeze` may write it, and a change needs a human to look" },
  { glob: "docs/05-test/baseline.json", allowNew: true, why: "the frozen test baseline: weakening it must be visible to a human" },
  { glob: "docs/progress.json", allowNew: true, orchestratorOwned: true, why: "state file, written only by the orchestrator" },
  { glob: "docs/gate-ledger.jsonl", allowNew: true, orchestratorOwned: true, why: "append-only, hash-chained" },
  { glob: "docs/00-control/**", allowNew: true, why: "guardrails are set before the run and are not revised mid-run" },
  { glob: "pipeline/prompts/**", allowNew: true, why: "prompts are versioned; changes need an eval entry (v2-12)" },
];

// The rules are a trust input: `{"protectedPaths": []}` used to mean "nothing is protected,
// RESULT: PASS", and the config sits in the tree the builder edits (SECOND-OPINION-3 G-09).
// Read them from the base commit when git can produce it, and fail closed on an empty list.
function rulesFromBase() {
  const base = flags.ref ?? progress.baseCommit ?? null;
  if (!base) return { rules: null, from: null };
  const shown = run(`git show ${base}:${configPath}`);
  if (shown.code !== 0) return { rules: null, from: null };
  try {
    const doc = JSON.parse(shown.stdout);
    if (Array.isArray(doc.protectedPaths)) return { rules: doc.protectedPaths, from: base };
  } catch {
    /* fall through to the working tree, with a warning */
  }
  return { rules: null, from: null };
}

const fromBase = rulesFromBase();
const protectedPaths = fromBase.rules ?? config.protectedPaths ?? DEFAULT_PROTECTED;
if (!fromBase.rules && config.protectedPaths) {
  console.log(
    paint.yellow(
      `warn: protectedPaths came from the working tree, not from ${progress.baseCommit ?? "a base commit"} — a config edit is invisible to this check; commit it and re-run`,
    ),
  );
}

if (!Array.isArray(protectedPaths) || protectedPaths.length === 0) {
  console.log(paint.yellow("no protected paths are configured"));
  console.log("RESULT: NOT_VERIFIED — a check with zero rules cannot tell a clean tree from a hollowed one");
  console.log(`human command: node pipeline/tools/protected-paths.mjs --config ${configPath}   # after restoring the rules`);
  process.exit(3);
}

const top = run("git rev-parse --show-toplevel");
if (top.code !== 0) {
  console.log(paint.yellow("could not evaluate: not a git repository (or git unavailable)"));
  console.log("RESULT: NOT_VERIFIED — a human must run: node pipeline/tools/protected-paths.mjs");
  process.exit(3);
}

const lsTree = run(`git ls-tree -r --name-only ${ref}`);
const resolvedRef = lsTree.code === 0 ? ref : "HEAD";
if (lsTree.code !== 0) {
  console.log(paint.yellow(`warn: cannot diff against ${ref} (unknown commit?); falling back to HEAD, so committed edits are invisible`));
}
const inRef = new Set(
  (lsTree.code === 0 ? lsTree : run("git ls-tree -r --name-only HEAD"))
    .stdout.split("\n")
    .map((s) => s.trim())
    .filter(Boolean),
);

// Committed changes since the ref, plus working-tree changes (staged, unstaged, untracked).
const changed = new Set();
for (const line of run(`git diff --name-only ${resolvedRef}`).stdout.split("\n")) if (line.trim()) changed.add(line.trim());
for (const line of run("git status --porcelain").stdout.split("\n")) {
  if (!line.trim()) continue;
  const file = line.slice(3).trim().replace(/^"|"$/g, "");
  if (file.includes(" -> ")) {
    const [from, to] = file.split(" -> ");
    changed.add(from.trim());
    changed.add(to.trim());
  } else changed.add(file);
}

// Under --strict the orchestrator-owned files are not waved through: the check asks the ledger
// whether they are what the orchestrator wrote. An appended, verifying chain and a progress file
// the chain cross-checks are fine; a rewritten ledger or a progress file that disagrees with it
// is a violation (B-34: nothing forced --strict at release).
const ledgerPath = flags.ledger ?? "docs/gate-ledger.jsonl";
function orchestratorIntact() {
  if (!fs.existsSync(ledgerPath)) return `no ledger at ${ledgerPath}`;
  const progressDoc = fs.existsSync(progressPath) ? readJson(progressPath) : null;
  const res = verifyLedger(ledgerPath, { progress: progressDoc, cwd: process.cwd() });
  if (!res.ok) return `the ledger does not verify: ${res.error}`;
  const before = run(`git show ${resolvedRef}:${ledgerPath}`);
  if (before.code === 0) {
    const now = fs.readFileSync(ledgerPath, "utf8");
    if (!now.startsWith(before.stdout)) return "the ledger is not append-only since the base commit";
  }
  return null;
}

const violations = [];
const warnings = [];
const ownedChecks = [];
for (const file of [...changed].sort()) {
  for (const rule of protectedPaths) {
    const re = globToRegExp(rule.glob);
    if (!re.test(file)) continue;
    const isNew = !inRef.has(file);
    // At release, an orchestrator-owned file is judged by the ledger whatever its age: a ledger
    // written from scratch is not "new, therefore fine".
    if (rule.orchestratorOwned && strict) {
      const why = orchestratorIntact();
      const entry = { file, glob: rule.glob, why: rule.why, kind: isNew ? "new-file-in-frozen-area" : "modified-or-deleted" };
      if (why) violations.push({ ...entry, why: `${rule.why}; ${why}` });
      else ownedChecks.push(entry);
      break;
    }
    if (rule.allowNew && isNew) continue;
    // A file `pipeline init` wrote after the base commit is new by construction. Accept it only
    // while its digest is the one init recorded, so editing it afterwards is still a violation.
    const boot = isNew && progress.bootstrap ? progress.bootstrap[file] : null;
    if (boot) {
      let now = null;
      try {
        now = sha256(fs.readFileSync(file, "utf8"));
      } catch {
        now = null;
      }
      if (now === boot) continue;
      violations.push({ file, glob: rule.glob, why: `${rule.why}; it was written by pipeline init and has changed since` , kind: "modified-or-deleted" });
      break;
    }
    const entry = { file, glob: rule.glob, why: rule.why, kind: isNew ? "new-file-in-frozen-area" : "modified-or-deleted" };
    if (rule.orchestratorOwned) {
      warnings.push(entry);
      break;
    }
    violations.push(entry);
    break;
  }
}

const result = {
  ok: violations.length === 0,
  ref: resolvedRef,
  baseCommit: progress.baseCommit ?? null,
  diffBase: baseCommit ? "init-commit" : "HEAD (no baseCommit recorded: run `pipeline init` or pass --ref)",
  changed: changed.size,
  rules: protectedPaths.length,
  violations,
  warnings,
  orchestratorChecked: ownedChecks.map((c) => c.file),
};

if (asJson) console.log(JSON.stringify(result, null, 2));
else {
  console.log(`ref: ${resolvedRef}${baseCommit ? " (init commit)" : ""}  changed files: ${changed.size}  protected rules: ${protectedPaths.length}`);
  if (!baseCommit) console.log(paint.yellow("warn: no baseCommit in docs/progress.json, so edits that were committed cannot be seen. Re-run `pipeline init --force` or pass --ref <sha>."));
  for (const w of warnings) console.log(paint.yellow(`warn ${w.file} — ${w.kind} (${w.glob}): orchestrator-owned; not judged here. \`verify\` and \`phase done 12\` run this check with --strict`));
  for (const c of ownedChecks) console.log(`ok   ${c.file} — orchestrator-owned (${c.kind}), and the ledger verifies`);
  for (const v of violations) console.log(`PROBLEM ${v.file} — ${v.kind} (${v.glob}): ${v.why}`);
  console.log(violations.length ? "RESULT: FAIL" : "RESULT: PASS");
}
process.exit(violations.length ? 1 : 0);
