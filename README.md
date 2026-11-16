# SDLC Framework

> **Autonomous Build Pipeline**: Brief → Researched Spec → Built → Tested → Red-Teamed → Patched → Shipped.

A comprehensive prompt and verification framework designed for LLMs, autonomous coding agents, and engineers. It includes phased execution prompts, mechanical gate-check tools, specification templates, and an application starter scaffold.

---

## 🚀 Architecture & Pipeline Flow

```
 BRIEF
   │
   ▼
[01 Intake + Research] ──► evidence ledger, ranked ideas, differentiation thesis
   │  GATE G1: every claim has a URL/date; ≥3 competitors; ≥1 rejected idea with reason
   ▼
[02 Spec] ──► SPEC.md (REQ/SEC/NFR IDs, Given/When/Then, data-flow table, budgets, slices)
   │  GATE G2: trace-check passes structure; reviewer agent can't find an untestable requirement
   ▼
[03 Design + UX]    [04 Architecture + Threat model]   (parallel, both read SPEC)
   │  G3: no-AI-tells review     │  G4: every entry point has abuse cases + controls
   └───────────────┬─────────────┘
                   ▼
[05 Test strategy + scaffolding] ──► failing tests derived from acceptance criteria + walking skeleton
   │  GATE G5: every REQ has ≥1 tagged test (red). Clean-DB journey harness runs.
   ▼
[06 Build in vertical slices]  ◄──────────────┐
   │  per slice: red → green → refactor →      │ max 3 repair loops, then log in blockers.md
   │  full gate run → commit                   │
   ▼                                           │
[07 QA / Verification sweep] (fresh agent) ────┘ defects go back to 06
   │  GATE G7: all flows pass on clean DB; flow-of-information matrix green;
   │           a11y/perf budgets met; mutation score ≥ threshold
   ▼
[08 Red team] Cloudflare 6 phases + ToB spec-compliance / sharp-edges / variant-analysis
   │  (recon → hunt waves → coverage critics → disprove → findings.json → record-verify → report)
   ▼
[09 Patch + post-patch validation] (fresh agent) → re-run 08 on the diff → loop ≤3 rounds
   │  GATE G9: 0 confirmed findings; every fix has a fail-before/pass-after test in tests/security
   ▼
[10 Release readiness + handoff] → final compliance, build, health check, honest limitations report
```

---

## 📁 Repository Structure

- **`pipeline/`**
  - **`prompts/`**: Phased prompts for each stage of development:
    - `00-orchestrator.md`: Master controller prompt to coordinate sub-agents and gate progression.
    - `01-intake-and-research.md`: Market research, evidence ledger, and user intent.
    - `02-spec-authoring.md`: Strict requirement drafting with Given/When/Then criteria.
    - `03-design-ux.md`: Interface design, UX heuristics, WCAG accessibility rules.
    - `04-architecture-threat-model.md`: Data flows, trust boundaries, and threat modeling (STRIDE).
    - `05-test-strategy-and-scaffold.md`: Walking skeleton and red test suite generation.
    - `06-build-slices.md`: Vertical slice implementation loop (red-green-refactor).
    - `07-qa-verification.md`: Independent QA verification sweep and mutation testing.
    - `08-red-team.md`: 6-phase security audit (Cloudflare security audit + Trail of Bits methods).
    - `09-patch-and-validate.md`: Patch application and post-patch validation tests.
    - `10-release-readiness.md`: Pre-flight verification, SBOM, and release checklist.
  - **`templates/`**:
    - `SPEC.template.md`: Schema-validated specification template.
  - **`tools/`**:
    - `trace-check.mjs`: Node.js tool to mechanically check requirement-to-test traceability.
  - **`README.md`**: Detailed operating manual and methodology analysis.
- **`src/`**: Next.js 16 App Router starter with Drizzle ORM and PostgreSQL integration.

---

## 🛠️ Usage

### 1. Mechanical Verification Gate
Validate requirement-to-test traceability mechanically at any time:
```bash
node pipeline/tools/trace-check.mjs docs/02-spec/SPEC.md tests --allow-uncovered
```

### 2. Autonomous Agent Execution
1. Place project brief in `docs/00-intake/brief.md`.
2. Feed `pipeline/prompts/00-orchestrator.md` into an autonomous agent capable of sub-agents (e.g., Antigravity, Claude Code, or Codex).
3. If running manually, execute prompts `01` through `10` sequentially in fresh context windows.

---

## 📜 License
MIT
