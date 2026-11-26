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

function readFileExcerpt(rel) {
  const abs = path.resolve(process.cwd(), rel);
  if (!fs.existsSync(abs)) return null;
  let text = fs.readFileSync(abs, "utf8");
  const truncated = text.length > MAX_FILE_BYTES;
  if (truncated) text = text.slice(0, MAX_FILE_BYTES);
  return { path: rel.replace(/\\/g, "/"), sha256: sha256(text), bytes: text.length, truncated, text };
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

  const files = String(flags.files ?? "")
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean)
    .map(readFileExcerpt);

  const missing = files.filter((f) => f === null);
  if (missing.length) {
    console.error(paint.red(`error: ${missing.length} of the files to verify do not exist`));
    process.exit(1);
  }

  const env = {
    schemaVersion: 1,
    taskId: String(flags["task-id"] ?? `${gate || phaseId}-${task}`).replace(/[^A-Za-z0-9_.:-]+/g, "-"),
    phase: phaseId || null,
    gate: gate || null,
    kind: String(flags.kind ?? "verification"),
    task,
    author: { model: authorModel, family: familyOf(authorModel, table) },
    verifier: { family: chosenFamily, model: verifierModel, independent: true },
    claims: buildClaims(flags),
    files: files.map(({ text: _t, ...rest }) => rest),
    instructions: [
      "You did not write this. Your job is to try to refute each claim, not to agree with it.",
      "Answer every claim with exactly one verdict: confirmed, corrected, refuted or insufficient.",
      "For confirmed and refuted you must cite at least one file:line you actually read.",
      "If a claim is unprovable from what you were given, answer insufficient and name the single missing fact.",
      "A control you did not find is not absent; say what you looked for before concluding it is missing.",
    ],
    resultsContract: {
      shape: "verdicts.schema.json",
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

function renderPrompt(env) {
  const head = [
    `# Verification task ${env.taskId}`,
    `You are a ${env.verifier.family} model verifying work produced by a ${env.author.family} model.`,
    `Task: ${env.task}`,
    "",
    "## Rules",
    ...env.instructions.map((i) => `- ${i}`),
    "",
    "## Claims",
    ...env.claims.map((c) => `- ${c.id}: ${c.statement}${c.location ? ` (claimed at ${c.location})` : ""}`),
    "",
    "## Files",
    ...env.files.map((f) => `- ${f.path} (${f.bytes} bytes${f.truncated ? ", truncated" : ""})`),
    "",
    "## Reply",
    "Return JSON only, matching verdicts.schema.json, with envelopeHash " + env.envelopeHash + ".",
  ];
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

function checkVerdict(env, verdict, label) {
  const problems = [];
  if (verdict.envelopeHash !== env.envelopeHash) problems.push(`envelopeHash mismatch — this verdict answers a different envelope`);
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
  ok(`verdict accepted — ${tally}`);
  for (const a of answers.filter((x) => x.verdict !== "confirmed")) {
    console.log(`  ${a.id} ${paint.yellow(a.verdict)}${a.evidence ? ` ${a.evidence.join(", ")}` : ""}${a.note ? ` — ${a.note}` : ""}`);
  }
  // A refuted claim is a valid outcome, not an error: it means the verifier did its job.
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
