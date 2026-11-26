// Model families, for the one thing that actually matters about model choice:
// a verifier must not share a family with the author it is checking.
//
// This is a pattern table, not a claim about any provider. Add your own models with
// `--families <file>` (a JSON object of { family: [substring, …] }) or the
// `verifierFamilies` key in pipeline.config.json. An unknown model is
// family "unknown", which is never independent — fail closed.

export const DEFAULT_FAMILIES = Object.freeze({
  anthropic: ["claude", "sonnet", "opus", "haiku"],
  openai: ["gpt", "o1", "o3", "o4", "chatgpt", "codex"],
  google: ["gemini", "palm", "bard"],
  meta: ["llama"],
  qwen: ["qwen", "tongyi"],
  mistral: ["mistral", "mixtral", "codestral"],
  deepseek: ["deepseek"],
  xai: ["grok"],
  cohere: ["command-r", "cohere"],
  moonshot: ["kimi", "moonshot"],
  zhipu: ["glm", "chatglm"],
  local: ["ollama:", "llamacpp:", "local:"],
});

const normalise = (model) => String(model ?? "").trim().toLowerCase();

export function familyOf(model, table = DEFAULT_FAMILIES) {
  const m = normalise(model);
  if (!m) return "unknown";
  for (const [family, patterns] of Object.entries(table)) {
    for (const p of patterns) {
      if (m.includes(String(p).toLowerCase())) return family;
    }
  }
  return "unknown";
}

// Independent = both known, and different. Same-family and unknown both fail closed.
export function independence(authorModel, verifierModel, table = DEFAULT_FAMILIES) {
  const author = familyOf(authorModel, table);
  const verifier = familyOf(verifierModel, table);
  if (author === "unknown") return { independent: false, author, verifier, why: `author model "${authorModel ?? ""}" has no known family; declare it in verifierFamilies` };
  if (verifier === "unknown") return { independent: false, author, verifier, why: `verifier model "${verifierModel ?? ""}" has no known family` };
  if (author === verifier) return { independent: false, author, verifier, why: `both are "${author}"; a verifier from the same family is not independent` };
  return { independent: true, author, verifier, why: `${verifier} verifies ${author}` };
}

// The families available to route to, given the author's, most-preferred first.
export function candidateFamilies(authorModel, { table = DEFAULT_FAMILIES, prefer = [] } = {}) {
  const author = familyOf(authorModel, table);
  const all = Object.keys(table).filter((f) => f !== author && f !== "local");
  const ordered = [...prefer.filter((f) => all.includes(f)), ...all.filter((f) => !prefer.includes(f))];
  return ordered;
}

export function mergeFamilies(file, readJsonImpl) {
  if (!file) return DEFAULT_FAMILIES;
  const user = readJsonImpl(file);
  const out = { ...DEFAULT_FAMILIES };
  for (const [family, patterns] of Object.entries(user)) {
    if (family === "$comment") continue;
    out[family] = Array.isArray(patterns) ? patterns.map(String) : [String(patterns)];
  }
  return out;
}
