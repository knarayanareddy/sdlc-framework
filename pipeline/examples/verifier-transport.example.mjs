#!/usr/bin/env node
// Reference transport for `verifier-route.mjs dispatch`.
//
// The pipeline never talks to a model API itself: it hands an envelope to a command that you
// own, and reads a verdict back. This file is that command, using the common
// `{model, messages[]}` request shape. Point it at whatever endpoint you have.
//
//   export PIPELINE_VERIFIER_URL="https://api.example.com/v1/chat/completions"
//   export PIPELINE_VERIFIER_KEY="…"
//   export PIPELINE_VERIFIER_MODEL="gpt-5"
//   PIPELINE_VERIFIER_CMD="node pipeline/examples/verifier-transport.example.mjs" \
//     node pipeline/tools/verifier-route.mjs dispatch --envelope env.json --out verdicts.json
//
//   node pipeline/examples/verifier-transport.example.mjs --dry-run   # print the request, no network
//
// Contract: stdin is {prompt, envelope}; stdout must be the verdict JSON only.
// Everything human goes to stderr. Exit 3 means "I could not run" and is recorded NOT_VERIFIED.
import process from "node:process";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");

const url = process.env.PIPELINE_VERIFIER_URL ?? "";
const key = process.env.PIPELINE_VERIFIER_KEY ?? "";
const model = process.env.PIPELINE_VERIFIER_MODEL ?? "";

function notVerified(reason, command) {
  console.error(`NOT_VERIFIED: ${reason}`);
  if (command) console.error(`human command: ${command}`);
  process.exit(3);
}

const input = await new Promise((resolve) => {
  let buf = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (c) => (buf += c));
  process.stdin.on("end", () => resolve(buf));
});

let payload;
try {
  payload = JSON.parse(input);
} catch {
  notVerified("stdin was not the JSON envelope that verifier-route.mjs sends", "re-run through: pipeline gate G7 … (it pipes the envelope)");
}

const { prompt, envelope } = payload ?? {};
if (!prompt || !envelope?.envelopeHash) notVerified("the envelope is missing or unsealed", "route it again: node pipeline/tools/verifier-route.mjs route --author-model <model>");

const body = {
  model: model || envelope.verifier?.model || "REPLACE_ME",
  messages: [
    {
      role: "system",
      content:
        "You are an independent verifier. Answer only with JSON matching the requested contract. " +
        "Do not agree out of politeness; try to refute each claim.",
    },
    { role: "user", content: prompt },
  ],
  temperature: 0,
  response_format: { type: "json_object" },
};

const request = {
  url,
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: key ? "Bearer <redacted>" : "(no PIPELINE_VERIFIER_KEY set)",
  },
  body,
};

if (dryRun) {
  // Redact the prompt so the dry run is safe to paste into an issue.
  const preview = { ...request, body: { ...body, messages: body.messages.map((m) => ({ role: m.role, content: `<${m.content.length} chars>` })) } };
  process.stdout.write(`${JSON.stringify({ dryRun: true, missing: [!url && "PIPELINE_VERIFIER_URL", !key && "PIPELINE_VERIFIER_KEY", !model && "PIPELINE_VERIFIER_MODEL"].filter(Boolean), request: preview }, null, 2)}\n`);
  process.exit(0);
}

if (!url || !key) {
  notVerified(
    `transport is not configured (${[!url && "PIPELINE_VERIFIER_URL", !key && "PIPELINE_VERIFIER_KEY"].filter(Boolean).join(", ")} missing)`,
    `export PIPELINE_VERIFIER_URL=… PIPELINE_VERIFIER_KEY=… PIPELINE_VERIFIER_MODEL=… && re-run the dispatch`,
  );
}

let res;
try {
  res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(Number(process.env.PIPELINE_VERIFIER_TIMEOUT ?? 300_000)),
  });
} catch (err) {
  notVerified(`the verifier endpoint could not be reached: ${err.message}`, `curl -sI ${url}`);
}

if (!res.ok) {
  const text = (await res.text().catch(() => "")).slice(0, 500);
  notVerified(`the verifier endpoint answered ${res.status}`, `curl -s -X POST ${url} -H 'authorization: Bearer $PIPELINE_VERIFIER_KEY' -d @body.json  (${text.replace(/\s+/g, " ").slice(0, 200)})`);
}

let json;
try {
  json = await res.json();
} catch {
  notVerified("the endpoint did not return JSON", "check the response_format support of your model");
}

// Common shapes: {choices:[{message:{content}}]} · {content:[{text}]} · {output_text}
const content =
  json.choices?.[0]?.message?.content ??
  (Array.isArray(json.content) ? json.content.map((c) => c.text ?? "").join("") : json.content) ??
  json.output_text ??
  "";

let verdict;
try {
  verdict = JSON.parse(String(content).replace(/^```(?:json)?/m, "").replace(/```\s*$/m, "").trim());
} catch {
  console.error(`raw model output was not JSON:\n${String(content).slice(0, 1000)}`);
  notVerified("the verifier did not return a parseable verdict", "tighten the system prompt or raise the model's JSON-mode support");
}

verdict = { ...verdict, envelopeHash: verdict.envelopeHash ?? envelope.envelopeHash, model: verdict.model ?? body.model, family: verdict.family ?? envelope.verifier?.family };
process.stdout.write(`${JSON.stringify(verdict)}\n`);
