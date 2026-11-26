// The allowlist of servable files, kept free of `server-only` / fs so tests and the route
// can both import it. `root` is resolved relative to the app directory; prompts and tools
// live in the canonical pipeline/ folder so there is only ever one copy of them.
export const CONTENT_FILES = {
  review: { root: "content", file: "REVIEW-AND-V2.md", title: "Section 7 · Review and v2 amendments", kind: "doc" },

  "v2-00": { root: "../pipeline/prompts", file: "v2-00-guardrails.md", title: "v2-00 · Guardrails + control plane", kind: "prompt" },
  "v2-01": { root: "../pipeline/prompts", file: "v2-01-research-quarantine.md", title: "v2-01 · Research quarantine + quote verify", kind: "prompt" },
  "v2-02": { root: "../pipeline/prompts", file: "v2-02-spec-and-freeze.md", title: "v2-02 · Spec, digest, freeze", kind: "prompt" },
  "v2-03": { root: "../pipeline/prompts", file: "v2-03-design-and-spike.md", title: "v2-03 · Design + rendered spike", kind: "prompt" },
  "v2-04": { root: "../pipeline/prompts", file: "v2-04-architecture.md", title: "v2-04 · Architecture + threat model", kind: "prompt" },
  "v2-05": { root: "../pipeline/prompts", file: "v2-05-test-integrity-and-tripwire.md", title: "v2-05 · Test integrity + slice tripwire", kind: "prompt" },
  "v2-06": { root: "../pipeline/prompts", file: "v2-06-build-slices.md", title: "v2-06 · Build in vertical slices", kind: "prompt" },
  "v2-07": { root: "../pipeline/prompts", file: "v2-07-qa-verification.md", title: "v2-07 · QA + verification sweep", kind: "prompt" },
  "v2-08": { root: "../pipeline/prompts", file: "v2-08-redteam.md", title: "v2-08 · Red team v2", kind: "prompt" },
  "v2-09": { root: "../pipeline/prompts", file: "v2-09-patch-and-validate.md", title: "v2-09 · Patch + post-patch validation", kind: "prompt" },
  "v2-10": { root: "../pipeline/prompts", file: "v2-10-release-readiness.md", title: "v2-10 · Release readiness", kind: "prompt" },
  "v2-11": { root: "../pipeline/prompts", file: "v2-11-deploy-verify.md", title: "v2-11 · Deploy + post-deploy verification", kind: "prompt" },
  "v2-12": { root: "../pipeline/prompts", file: "v2-12-pipeline-eval.md", title: "v2-12 · Pipeline evaluation + calibration", kind: "prompt" },
  "v2-99": { root: "../pipeline/prompts", file: "v2-99-orchestrator.md", title: "v2-99 · Orchestrator (the CLI loop)", kind: "prompt" },

  "trace-check-v2": { root: "../pipeline/tools", file: "trace-check-v2.mjs", title: "trace-check-v2.mjs", kind: "tool" },
  "trace-check-v2-selftest": { root: "../pipeline/tools", file: "trace-check-v2.selftest.mjs", title: "trace-check-v2.selftest.mjs", kind: "tool" },
} as const;

export type ContentSlug = keyof typeof CONTENT_FILES;

export function isContentSlug(s: string): s is ContentSlug {
  return Object.prototype.hasOwnProperty.call(CONTENT_FILES, s);
}
