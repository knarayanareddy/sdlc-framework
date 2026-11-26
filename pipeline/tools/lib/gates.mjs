// One source of truth for gate ids, phase order and phase prerequisites.
// Both the orchestrator and the validators import this, so the state machine
// cannot drift from the documents.

// G6 and G8 are deliberately absent: the framework numbers gates by the phase
// that owns them and 06/08 are rolling (per-slice tripwire, hunter coverage),
// enforced by phase `done` checks instead of a single gate run.
export const GATE_IDS = Object.freeze([
  "G0", "G1", "G2", "G3", "G4", "G5", "G7", "G9", "G10", "G11", "G12",
]);

export const STATUSES = Object.freeze(["passed", "failed", "NOT_VERIFIED"]);

// gates:        gate(s) this phase must record before it can be marked done
// requiresGates: gates that must be passed or NOT_VERIFIED before it starts
// requiresPhases: phases that must be done before it starts
// doneChecks:   builtin commands the orchestrator runs itself on `phase done`
export const PHASES = Object.freeze([
  { id: "00", title: "Guardrails + control plane", prompt: "v2-00-guardrails.md", gates: ["G0"], requiresGates: [], requiresPhases: [], doneChecks: ["ledger", "protected"] },
  { id: "01", title: "Research with quarantine", prompt: "v2-01-research-quarantine.md", gates: ["G1"], requiresGates: [], requiresPhases: ["00"], doneChecks: ["quotes"] },
  { id: "02", title: "Spec authoring", prompt: "v2-02-spec-and-freeze.md", gates: ["G2"], requiresGates: [], requiresPhases: ["01"], doneChecks: ["trace:structure"] },
  { id: "H1", title: "Decision digest (non-blocking)", prompt: "v2-02-spec-and-freeze.md", gates: [], requiresGates: ["G2"], requiresPhases: [], doneChecks: ["digest"] },
  { id: "03", title: "Design + UX + spike", prompt: "v2-03-design-and-spike.md", gates: ["G3"], requiresGates: ["G2"], requiresPhases: ["02"], doneChecks: [] },
  { id: "04", title: "Architecture + threat model", prompt: "v2-04-architecture.md", gates: ["G4"], requiresGates: ["G2"], requiresPhases: ["02"], doneChecks: [] },
  { id: "FZ", title: "Spec freeze", prompt: "v2-02-spec-and-freeze.md", gates: [], requiresGates: ["G3", "G4"], requiresPhases: [], doneChecks: ["freeze"] },
  { id: "05", title: "Test strategy + baseline", prompt: "v2-05-test-integrity-and-tripwire.md", gates: ["G5"], requiresGates: [], requiresPhases: ["03", "04"], doneChecks: ["trace:check"] },
  { id: "06", title: "Build in vertical slices", prompt: "v2-06-build-slices.md", gates: [], requiresGates: ["G5"], requiresPhases: ["05"], doneChecks: ["slices"] },
  { id: "07", title: "QA + verification sweep", prompt: "v2-07-qa-verification.md", gates: ["G7"], requiresGates: [], requiresPhases: ["06"], doneChecks: [] },
  { id: "08", title: "Red team", prompt: "v2-08-redteam.md", gates: [], requiresGates: ["G7"], requiresPhases: ["07"], doneChecks: ["entrypoints", "coverage", "findings"] },
  { id: "09", title: "Patch + post-patch validation", prompt: "v2-09-patch-and-validate.md", gates: ["G9"], requiresGates: [], requiresPhases: ["07"], doneChecks: ["findings", "coverage"] },
  { id: "10", title: "Release readiness", prompt: "v2-10-release-readiness.md", gates: ["G10"], requiresGates: ["G9"], requiresPhases: ["09"], doneChecks: ["release"] },
  { id: "11", title: "Deploy + post-deploy verification", prompt: "v2-11-deploy-verify.md", gates: ["G11"], requiresGates: ["G10"], requiresPhases: ["10"], doneChecks: [] },
  { id: "12", title: "Pipeline evaluation + calibration", prompt: "v2-12-pipeline-eval.md", gates: ["G12"], requiresGates: ["G11"], requiresPhases: ["11"], doneChecks: ["metrics"] },
]);

export const PHASE_IDS = Object.freeze(PHASES.map((p) => p.id));

export const phase = (id) => PHASES.find((p) => p.id === String(id));

export const nextPhase = (id) => {
  const i = PHASE_IDS.indexOf(String(id));
  return i >= 0 && i + 1 < PHASE_IDS.length ? PHASE_IDS[i + 1] : null;
};

// Default builtin set suggested for each gate, used by `pipeline next`.
export const GATE_SUGGESTIONS = Object.freeze({
  G0: ["ledger", "protected"],
  G1: ["quotes"],
  G2: ["trace:structure"],
  G3: ["manual"],
  G4: ["manual"],
  G5: ["trace:freeze", "trace:check", "unit"],
  G7: ["types", "lint", "unit", "build"],
  G9: ["findings", "coverage"],
  G10: ["types", "build", "ledger", "progress"],
  G11: ["e2e"],
  G12: ["metrics"],
  H1: ["digest"],
});
