// The allowlist of servable files, kept free of `server-only` / fs so tests and the route can both import it.
export const CONTENT_FILES = {
  review: { file: "REVIEW-AND-V2.md", title: "Section 7 · Review and v2 amendments", kind: "doc" },
  "v2-00": { file: "prompts/v2-00-guardrails.md", title: "v2-00 · Guardrails + control plane", kind: "prompt" },
  "v2-01": { file: "prompts/v2-01-research-quarantine.md", title: "v2-01 · Research quarantine + quote verify", kind: "prompt" },
  "v2-05": { file: "prompts/v2-05-test-integrity-and-tripwire.md", title: "v2-05 · Test integrity + slice tripwire", kind: "prompt" },
  "v2-08": { file: "prompts/v2-08-redteam.md", title: "v2-08 · Red team v2", kind: "prompt" },
  "v2-11": { file: "prompts/v2-11-deploy-verify.md", title: "v2-11 · Deploy + post-deploy verification", kind: "prompt" },
  "v2-12": { file: "prompts/v2-12-pipeline-eval.md", title: "v2-12 · Pipeline evaluation + calibration", kind: "prompt" },
  "trace-check-v2": { file: "tools/trace-check-v2.mjs", title: "trace-check-v2.mjs", kind: "tool" },
  "trace-check-v2-selftest": { file: "tools/trace-check-v2.selftest.mjs", title: "trace-check-v2.selftest.mjs", kind: "tool" },
} as const;

export type ContentSlug = keyof typeof CONTENT_FILES;

export function isContentSlug(s: string): s is ContentSlug {
  return Object.prototype.hasOwnProperty.call(CONTENT_FILES, s);
}
