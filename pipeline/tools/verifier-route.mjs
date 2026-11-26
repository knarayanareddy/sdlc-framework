#!/usr/bin/env node
// Cross-model verifier routing (R-09/R-16: independence, not just "a second opinion").
//
// Assigns a verification task to a model from a DIFFERENT family than the author, builds the
// envelope the verifier must answer, optionally dispatches it through a command you configure,
// and then validates the verdict against the envelope it claims to answer.
//
//   node pipeline/tools/verifier-route.mjs route --phase 07 --gate G7 --author-model claude-sonnet \
//        --task "spec-to-code compliance" --claims claims.json --files docs/02-spec/SPEC.md --out env.json
//   node pipeline/tools/verifier-route.mjs dispatch --envelope env.json --cmd "node my-verifier.mjs" --out verdict.json
//   node pipeline/tools/verifier-route.mjs check --envelope env.json --verdict verdict.json
//
// Exit codes: 0 verified · 1 rejected/contract broken · 3 NOT_VERIFIED (nothing to dispatch, or no
// independent family available). NOT_VERIFIED prints the exact command a human must run.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { canonical, ensureDir, fail, ok, paint, parseArgs, readJson, sha256, warn, writeJson } from "./lib/common.mjs";
import { candidateFamilies, familyOf, independence, mergeFamilies } from "./lib/families.mjs";

const { flags, positional } = parseArgs();
const [command = "status"] = positional;

const VERDICTS = Object.freeze(["confirmed", "corrected", "refuted", "insufficient"]);
const MAX_FILE_BYTES = 200_000;
// What the verifier is shown is what the envelope hash binds. These caps keep an envelope
// a document rather than an archive, and every omission is stated in the prompt.
const MAX_TOTAL_BYTES = 600_000;
const MAX_DIR_FILES = 60;
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", "out", "coverage", ".venv", "__pycache__", ".turbo"]);
const BINARY = /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tgz|woff2?|ttf|eot|mp4|mov|mp3|wav|wasm|so|node|class)$/i;

const table = mergeFamilies(flags.families, (f) => readJson(f));
const authorModel = flags["author-model"] ?? process.env.PIPELINE_BUILDER_MODEL ?? "";
const prefer = String(flags.prefer ?? "").split(",").filter(Boolean);

function notVerified(reason, humanCommand) {
  console.log(paint.yellow(`NOT_VERIFIED: ${reason}`));
  if (humanCommand) console.log(`human command: ${humanCommand}`);
  process.exit(3);
}

function envelopeHash(env) {
  const { envelopeHash: _drop, ...rest } = env;
  return sha256(canonical(rest));
}

function buildClaims(flags) {
  let claims = [];
  if (flags.claims) {
    const raw = readJson(flags.claims);
    claims = Array.isArray(raw) ? raw : raw.claims ?? [];
  } else if (flags["claim"] && flags["claim"] !== true) {
    claims = String(flags["claim"]).split("|").map((s) => ({ statement: s.trim() }));
  }
  if (!claims.length) claims = [{ statement: flags.task ?? "the work assigned to this phase is correct and complete" }];
  return claims.map((c, i) => ({
    id: c.id ?? `C${i + 1}`,
    statement: String(c.statement).trim(),
    location: c.location ?? null,
  }));
}

// A directory in --files is what a human actually means by "verify the spec". Listing the
// directory name alone produced a file called `docs/02-spec` that does not exist (F-10).
// The lines a reader of the prompt can actually count: a trailing newline does not add one.
function displayLines(text) {
  if (!text) return [];
  const lines = String(text).split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function expandTarget(rel) {
  const abs = path.resolve(process.cwd(), rel);
  if (!fs.existsSync(abs)) return [];
  if (!fs.statSync(abs).isDirectory()) return [rel.replace(/\\/g, "/")];
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (!BINARY.test(entry.name) && out.length < MAX_DIR_FILES) out.push(path.relative(process.cwd(), p).split(path.sep).join("/"));
    }
  };
  walk(abs);
  return out;
}

function readFileExcerpt(rel, budget) {
  const abs = path.resolve(process.cwd(), rel);
  if (!fs.existsSync(abs)) return null;
  const whole = fs.readFileSync(abs, "utf8");
  let text = whole.length > MAX_FILE_BYTES ? whole.slice(0, MAX_FILE_BYTES) : whole;
  const truncated = text.length < whole.length;
  // The per-file cap alone still let ten 200 KB files through; the budget is what makes the
  // envelope reviewable. An omitted file is named as omitted, never silently dropped.
  let omitted = null;
  if (budget.left <= 0) {
    omitted = "envelope byte budget";
    text = "";
  } else if (text.length > budget.left) {
    text = text.slice(0, budget.left);
    omitted = "envelope byte budget";
  }
  budget.left -= text.length;
  return {
    path: rel.replace(/\\/g, "/"),
    sha256: sha256(whole),
    bytes: whole.length,
    lines: displayLines(whole).length,
    truncated,
    ...(omitted ? { omitted } : {}),
    text,
  };
}

function cmdRoute() {
  const phaseId = String(flags.phase ?? "");
  const gate = String(flags.gate ?? "");
  const task = String(flags.task ?? `${gate || phaseId} verification`);

  if (!authorModel) {
    notVerified("no --author-model given, so independence cannot be established", "re-run with --author-model <the model that did the work>");
  }

  const candidates = candidateFamilies(authorModel, { table, prefer });
  const verifierModel = flags["verifier-model"] ? String(flags["verifier-model"]) : null;

  if (verifierModel) {
    const ind = independence(authorModel, verifierModel, table);
    if (!ind.independent) {
      console.error(paint.red(`error: refused — ${ind.why}`));
      process.exit(1);
    }
  }

  if (!candidates.length) {
    notVerified(
      `no independent family available for author "${authorModel}" — add another family to verifierFamilies`,
      `node pipeline/tools/verifier-route.mjs route --author-model ${authorModel} --verifier-model <a model from another family> …`,
    );
  }

  const chosenFamily = verifierModel ? familyOf(verifierModel, table) : String(flags.family ?? candidates[0]);
  if (!chosenFamily || chosenFamily === familyOf(authorModel, table)) {
    notVerified(`family "${chosenFamily}" is not independent of the author`, null);
  }

  const wanted = String(flags.files ?? "")
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean);
  const targets = [...new Set(wanted.flatMap(expandTarget))];
  if (wanted.length && !targets.length) {
    console.error(paint.red(`error: none of the files to verify exist: ${wanted.join(", ")}`));
    process.exit(1);
  }
  const budget = { left: MAX_TOTAL_BYTES };
  const files = targets.map((f) => readFileExcerpt(f, budget));
  const missing = files.filter((f) => f === null);
  if (missing.length) {
    console.error(paint.red(`error: ${missing.length} of the files to verify do not exist`));
    process.exit(1);
  }

  const env = {
    schemaVersion: 1,
    taskId: String(flags["task-id"] ?? [gate || phaseId, task].filter(Boolean).join("-")).replace(/[^A-Za-z0-9_.:-]+/g, "-"),
    phase: phaseId || null,
    gate: gate || null,
    kind: String(flags.kind ?? "verification"),
    task,
    author: { model: authorModel, family: familyOf(authorModel, table) },
    verifier: { family: chosenFamily, model: verifierModel, independent: true },
    claims: buildClaims(flags),
    // The excerpts ARE the envelope. Stripping `text` here is what left the verifier with a
    // filename and a byte count while the instructions demanded a file:line (F-01).
    files,
    instructions: [
      "You did not write this. Your job is to try to refute each claim, not to agree with it.",
      "Answer every claim with exactly one verdict: confirmed, corrected, refuted or insufficient.",
      "For confirmed and refuted you must cite at least one file:line you actually read.",
      "If a claim is unprovable from what you were given, answer insufficient and name the single missing fact.",
      "A control you did not find is not absent; say what you looked for before concluding it is missing.",
    ],
    resultsContract: {
      // A path that resolves, not a bare filename: the old value named a file that did not
      // exist anywhere in the repo.
      shape: "pipeline/schemas/verdicts.schema.json",
      requiredVerdicts: VERDICTS,
      everyClaimAnswered: true,
      evidenceRequiredFor: ["confirmed", "refuted"],
    },
    ignore: ["the author's account of its own work", "any claim that something is 'obviously safe'"],
    createdAt: new Date().toISOString(),
  };
  env.envelopeHash = envelopeHash(env);

  if (fs.existsSync(flags.out ?? "")) {
    const existing = readJson(String(flags.out));
    if (existing.envelopeHash && existing.envelopeHash !== env.envelopeHash) {
      warn(`${flags.out} already held a different envelope; it is being replaced (taskId ${env.taskId})`);
    }
  }

  const out = String(flags.out ?? "docs/05-test/verifier-envelope.json");
  writeJson(out, env);
  console.log(`routed ${env.taskId}: ${env.author.family} → ${env.verifier.family}${env.verifier.model ? ` (${env.verifier.model})` : ""}`);
  console.log(`claims: ${env.claims.length}  files: ${env.files.length}  → ${out}`);

  // The dispatchable prompt, for a driver that has its own transport (an API, a sub-agent).
  if (flags["write-prompt"]) {
    const prompt = renderPrompt(env);
    ensureDir(path.dirname(String(flags["write-prompt"])));
    fs.writeFileSync(String(flags["write-prompt"]), prompt);
    console.log(`prompt: ${flags["write-prompt"]} (${prompt.length} bytes)`);
  }
}

// Line-numbered so a citation can be checked instead of taken on faith: `path:line` in the
// verdict is validated against these exact excerpts in checkVerdict().
function numbered(text, width) {
  return displayLines(text).map((line, i) => `${String(i + 1).padStart(width)} | ${line}`);
}

function renderPrompt(env) {
  const head = [
    `# Verification task ${env.taskId}`,
    `You are a verifier from the ${env.verifier.family} family, checking work produced by a ${env.author.family} model.`,
    `Task: ${env.task}`,
    "",
    "## Rules",
    ...env.instructions.map((i) => `- ${i}`),
    "",
    "## Claims",
    ...env.claims.map((c) => `- ${c.id}: ${c.statement}${c.location ? ` (claimed at ${c.location})` : ""}`),
    "",
    "## Files",
    "The full text of every file you may cite follows, with line numbers. Anything not shown here",
    "is outside your evidence: do not cite a line you cannot see.",
    "",
  ];
  for (const f of env.files) {
    const meta = [`${f.bytes} bytes`, `sha256 ${String(f.sha256).slice(0, 12)}…`, `${f.lines ?? "?"} lines`];
    if (f.truncated) meta.push("truncated");
    if (f.omitted) meta.push(`NOT SHOWN: ${f.omitted}`);
    head.push(`### ${f.path} (${meta.join(", ")})`, "");
    if (!f.text) {
      head.push("_No content: this file was outside the envelope's byte budget. Do not cite it._", "");
      continue;
    }
    const width = String(displayLines(f.text).length).length;
    head.push("```text", ...numbered(f.text, width), "```", "");
  }
  head.push(
    "## Reply",
    "Return JSON only, matching verdicts.schema.json, with envelopeHash " + env.envelopeHash + ".",
    "Every `evidence` entry must be `<path>:<line>` from the excerpts above.",
  );
  return head.join("\n") + "\n";
}

function cmdDispatch() {
  const envPath = String(flags.envelope ?? "docs/05-test/verifier-envelope.json");
  if (!fs.existsSync(envPath)) {
    notVerified(`no envelope at ${envPath}`, `node pipeline/tools/verifier-route.mjs route --author-model <model> … --out ${envPath}`);
  }
  const env = readJson(envPath);
  const cmd = flags.cmd ? String(flags.cmd) : process.env.PIPELINE_VERIFIER_CMD;
  if (!cmd) {
    notVerified(
      "no verifier transport configured — the envelope is ready, nothing can send it",
      `PIPELINE_VERIFIER_CMD="node my-verifier.mjs" node pipeline/tools/verifier-route.mjs dispatch --envelope ${envPath} --out verdicts.json`,
    );
  }

  const prompt = renderPrompt(env);
  const res = spawnSync(cmd, {
    shell: true,
    input: JSON.stringify({ prompt, envelope: env }),
    encoding: "utf8",
    timeout: Number(flags.timeout ?? 600_000),
    maxBuffer: 32 * 1024 * 1024,
  });

  const out = String(flags.out ?? "docs/05-test/verifier-verdicts.json");
  if (res.status !== 0) {
    ensureDir(path.dirname(out));
    fs.writeFileSync(`${out}.stderr`, res.stderr ?? "");
    notVerified(`verifier transport exited ${res.status}`, `see ${out}.stderr`);
  }

  let verdict;
  try {
    verdict = JSON.parse(res.stdout);
  } catch {
    ensureDir(path.dirname(out));
    fs.writeFileSync(`${out}.stderr`, `${res.stdout ?? ""}${res.stderr ?? ""}`);
    fail(`verifier transport did not return JSON on stdout (captured in ${out}.stderr)`);
  }
  verdict.dispatchedAt = verdict.dispatchedAt ?? new Date().toISOString();
  writeJson(out, verdict);
  console.log(`verdict written to ${out}`);
  checkVerdict(env, verdict, out);
}

// `path:line` or `path:12-20`, resolved against the excerpts the verifier was actually shown.
// A citation to a file that was never in the envelope is the memory-citation failure this
// phase exists to stop (F-11): it cannot be distinguished from a plausible invention.
function citationProblem(entry, env) {
  const raw = typeof entry === "string" ? entry : entry?.file ? `${entry.file}${entry.line ? `:${entry.line}` : ""}` : "";
  const m = String(raw).trim().match(/^(?:\.\/)?(.+?):L?(\d+)(?:\s*[-–]\s*(\d+))?$/);
  if (!m) return `evidence "${raw}" is not <path>:<line>`;
  const [, file, fromRaw, toRaw] = m;
  const shown = env.files.find((f) => String(f.path).replace(/^\.\//, "") === file);
  if (!shown) return `evidence cites "${file}", which was not in the envelope — that citation came from memory`;
  if (shown.omitted) return `evidence cites "${file}", whose content was not shown (${shown.omitted})`;
  const lineCount = displayLines(shown.text).length;
  const from = Number(fromRaw);
  const to = Number(toRaw ?? fromRaw);
  if (from < 1 || to < from) return `evidence "${raw}" has an impossible line range`;
  if (from > lineCount || to > lineCount) return `evidence cites ${file}:${from}${to !== from ? `-${to}` : ""}, but only ${lineCount} line(s) were shown`;
  return null;
}

function checkVerdict(env, verdict, label) {
  const problems = [];
  if (verdict.envelopeHash !== env.envelopeHash) problems.push(`envelopeHash mismatch — this verdict answers a different envelope`);
  if (!verdict.model && !verdict.family) {
    // Without either, nothing ties the verdict to a model, so "independent" is unjudgeable
    // and the gate would pass on the strength of an anonymous answer (F-16).
    problems.push("the verdict names neither a model nor a family, so independence cannot be judged");
  }
  if (verdict.schemaVersion !== undefined && verdict.schemaVersion !== 1) problems.push(`schemaVersion must be 1 (found ${JSON.stringify(verdict.schemaVersion)})`);
  if (verdict.model) {
    const ind = independence(env.author.model, verdict.model, table);
    if (!ind.independent) problems.push(`not independent: ${ind.why}`);
  } else if (verdict.family) {
    const ind = independence(env.author.model, `declared family ${verdict.family}`, table);
    if (verdict.family === env.author.family) problems.push(`not independent: the verdict declares the author's own family "${verdict.family}"`);
    else if (ind.verifier === "unknown" && !Object.keys(table).includes(String(verdict.family))) problems.push(`unknown family "${verdict.family}"`);
  }
  if (!VERDICTS.includes(verdict.verdict) && !Array.isArray(verdict.claims)) {
    problems.push(`verdict must be one of ${VERDICTS.join("|")} or carry per-claim answers`);
  }
  const answers = Array.isArray(verdict.claims) ? verdict.claims : [];
  const byId = new Map(answers.map((a) => [a.id, a]));
  for (const claim of env.claims) {
    const a = byId.get(claim.id);
    if (!a) {
      problems.push(`claim ${claim.id} was not answered`);
      continue;
    }
    if (!VERDICTS.includes(a.verdict)) problems.push(`claim ${claim.id}: invalid verdict "${a.verdict}"`);
    if (["confirmed", "refuted"].includes(a.verdict) && !(Array.isArray(a.evidence) && a.evidence.length)) {
      problems.push(`claim ${claim.id}: "${a.verdict}" needs evidence (file:line)`);
    }
    if (Array.isArray(a.evidence)) {
      for (const entry of a.evidence) {
        const problem = citationProblem(entry, env);
        if (problem) problems.push(`claim ${claim.id}: ${problem}`);
      }
    }
    if (a.verdict === "insufficient" && !String(a.missing ?? "").trim()) problems.push(`claim ${claim.id}: "insufficient" must name the missing fact`);
  }
  for (const a of answers) {
    if (!env.claims.some((c) => c.id === a.id)) problems.push(`claim ${a.id} is not part of the envelope`);
  }

  if (problems.length) {
    console.error(paint.red(`verifier contract violated (${label ?? "verdict"}):`));
    for (const p of problems) console.error(paint.red(`  - ${p}`));
    process.exit(1);
  }

  const tally = VERDICTS.map((v) => `${v}: ${answers.filter((a) => a.verdict === v).length}`).join("  ");
  const blocking = answers.filter((a) => ["refuted", "insufficient"].includes(a.verdict));
  for (const a of answers.filter((x) => x.verdict !== "confirmed")) {
    console.log(`  ${a.id} ${paint.yellow(a.verdict)}${a.evidence ? ` ${a.evidence.join(", ")}` : ""}${a.note ? ` — ${a.note}` : ""}`);
  }
  if (blocking.length && !flags["allow-refuted"]) {
    // A refuted claim is the verifier doing its job — and it is also a gate that must not go
    // green. Exit 1 so `pipeline gate` records a failure; a human decides what happens next.
    console.error(paint.red(`RESULT: ${blocking.length} claim(s) were not confirmed — this verification does not pass`));
    for (const a of blocking) console.error(paint.red(`  - ${a.id} ${a.verdict}${a.note ? `: ${a.note}` : ""}`));
    console.error(`to record this as a finding rather than a gate failure: add --allow-refuted`);
    process.exit(1);
  }
  ok(`verdict accepted — ${tally}`);
  process.exit(0);
}

function cmdCheck() {
  const envPath = String(flags.envelope ?? "docs/05-test/verifier-envelope.json");
  const verdictPath = String(flags.verdict ?? "docs/05-test/verifier-verdicts.json");
  for (const [label, p] of [["envelope", envPath], ["verdict", verdictPath]]) {
    if (!fs.existsSync(p)) notVerified(`no ${label} at ${p}`, null);
  }
  const env = readJson(envPath);
  const verdict = readJson(verdictPath);
  const recomputed = envelopeHash(env);
  if (recomputed !== env.envelopeHash) {
    fail("envelope was edited after routing (hash mismatch) — route it again");
  }
  checkVerdict(env, verdict, verdictPath);
}

function cmdStatus() {
  console.log(`families known: ${Object.keys(table).join(" ")}`);
  console.log(`author model:   ${authorModel || "(not set; pass --author-model or PIPELINE_BUILDER_MODEL)"}`);
  if (authorModel) {
    console.log(`author family:  ${familyOf(authorModel, table)}`);
    const candidates = candidateFamilies(authorModel, { table, prefer });
    console.log(`routable to:    ${candidates.length ? candidates.join(" ") : "(none — only one family is known)"}`);
  }
  console.log(`transport:      ${process.env.PIPELINE_VERIFIER_CMD ? "PIPELINE_VERIFIER_CMD is set" : "not configured (dispatch will be NOT_VERIFIED)"}`);
  console.log(`verdict values: ${VERDICTS.join(" | ")}`);
}

const commands = { route: cmdRoute, dispatch: cmdDispatch, check: cmdCheck, status: cmdStatus, help: cmdStatus };
if (!commands[command]) fail(`unknown command "${command}". Known: ${Object.keys(commands).join(", ")}`);
commands[command]();
