# SDLC Framework

> **Autonomous Build Pipeline**: Brief → Researched Spec → Built → Tested → Red-Teamed → Patched → Shipped.

A comprehensive prompt and verification framework designed for LLMs, autonomous coding agents, and engineers.

**v1 is a manual. v2 is an executable pipeline**: an orchestrator that runs each gate itself, records the exit code in a hash-chained ledger, and refuses to advance a phase whose prerequisites are missing. Twenty-three zero-dependency tools — twenty have a test that names them, and the remaining three (`demo`, `expect-files`, `run-selftests`) are exercised by the demo and by CI — plus a worked example that walks every phase, and a live-environment harness that turns the four things a repo cannot do alone into a checklist with one command per item.

Three things worth knowing before you trust a green run:

- **A gate is a command result, not an opinion** — including when the command is one the caller chose. `pipeline gate --cmd` is refused unless a human commits that exact command to `docs/00-control/allowed-commands.json`; the file is read from git, never from a path the caller names (2.7.1 — the 2.7.0 `--allow-commands` flag let the same command line supply both the command and its approval). At 2.1.0 `gate G7 --cmd true` recorded a pass.
- **Only G3 is an evidence gate** — every other gate has to run a command. At 2.7.0 `--evidence <any file ≥64 B>` recorded `passed/exit 0` for nine gates, G11 among them, and `verify` then reported "no drift" (2.7.1).
- **G11 is closed by a named human** — `gate G11 --attested-by <name>` with `PIPELINE_HUMAN=1`; the name is written into the hash chain. A convention, not a boundary: the builder shares the shell, so the attestation makes a bypass explicit rather than impossible.
- **The ledger catches accidental edits, not a hostile agent.** It is an unkeyed hash chain inside a directory the build agent can write to. Deleting the tail lines and recomputing the links defeats it. What narrows that gap: the chain is cross-checked against `docs/progress.json` (so a truncated tail leaves gates progress still claims), every entry records a hash of the source tree the gate ran against, and setting `PIPELINE_LEDGER_KEY` outside the agent's environment seals each entry with an HMAC.
- **The spec freeze is enforced.** `docs/02-spec/SPEC.sha256` is re-checked by `verify`, by `trace-check` and by `phase done`; re-freezing requires a change note in `docs/02-spec/CHANGES.md`.

```bash
node pipeline/tools/run-selftests.mjs      # every tool passes its own test
node pipeline/tools/demo.mjs               # walk phases 00 → 12 on a worked example
node pipeline/bin/pipeline.mjs --help      # init | gate | verify | phase | freeze | estimate | report
```

One thing this repository will not do: claim a gate it did not run. A gate is a command
result, not an opinion.

---

## 🚀 Architecture & Pipeline Flow

```
 BRIEF
   │
   ▼
[01 Intake + Research] ──► evidence ledger, ranked ideas, differentiation thesis
   │  G1: verified quotes only; ≥5 competitors; ≥10 quotes; ≥3 rejected ideas with reasons
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

- **`pipeline/`** — the framework and the v2 tooling
  - **`bin/pipeline.mjs`**: the orchestrator CLI — state machine, gate runner, hash-chained ledger, report
  - **`tools/`**: twenty-three zero-dependency tools across 23 `*.test.mjs` files (`demo`, `expect-files` and `run-selftests` are covered by the demo and CI rather than by a test of their own):
    `trace-check-v2`, `gate-ledger`, `entrypoints`, `coverage-gate`, `quote-verify`,
    `validate-findings`, `validate-progress`, `protected-paths`, `tripwire`, `estimate`,
    `sandbox`, `dast`, `fuzz-api`, `verifier-route`, `independence`, `calibrate`, `families`,
    `leads`, `bug-classes`, `plan-check`, `metrics-compute`, `live-check`, plus
    `expect-files`, `run-selftests` and the end-to-end `demo`
  - **`schemas/`**: JSON schemas for `progress.json`, `findings.json`, `coverage-ledger.json`,
    `verdicts.json`, `metrics.json`, plus `schemas.test.mjs`, which runs the same document
    through each schema and its validator and fails when the two disagree
  - **`examples/mini-app/`**: a three-requirement worked example the demo runs end to end
  - **`RUNBOOK.md`**: every command needed to run a real project
  - **`P6-LIVE.md`**: the four things only you can finish (verifier credential, container
    runtime, `nuclei` + `schemathesis`, a blind calibration round) — one command per item, and
    what "done" looks like. `node pipeline/bin/pipeline.mjs live` prints where you stand.
  - **`prompts/`**: one prompt per phase
    - `v2-00 … v2-12`, `v2-99` — the amended, executable set (supersedes v1)
    - `00-orchestrator.md` … `10-release-readiness.md` — the original v1 set, kept for reference
  - **`templates/SPEC.template.md`**: the 14-section specification schema
  - **`README.md`**: the operating manual and methodology analysis
- **`src/`**: Next.js 16 App Router starter with Drizzle ORM and PostgreSQL integration.
- **`comprehensive-development-lifecycle-prompts/`**: an independent review of v1 (R-01…R-15) and **The Line**, a Next.js app that presents the review, the two pipelines side by side, and a Postgres-backed gate board. Run it from its own directory (`npm ci && npm run dev`). It serves the canonical `pipeline/prompts` and `pipeline/tools` files rather than keeping copies.

## 🛠️ Usage

### 1. Mechanical verification gate
Validate requirement-to-test traceability mechanically at any time:
```bash
node pipeline/tools/trace-check-v2.mjs docs/02-spec/SPEC.md tests --allow-uncovered
node pipeline/tools/trace-check-v2.mjs docs/02-spec/SPEC.md tests --allow-uncovered --check-baseline docs/05-test/baseline.json
```
The second form fails on a deleted file, a lost assertion, a lost test case or a new skip.

### 2. Autonomous agent execution (v2)
1. `node pipeline/bin/pipeline.mjs init` inside the target repo, then edit `pipeline.config.json`.
2. Feed `pipeline/prompts/v2-99-orchestrator.md` into an agent that can spawn sub-agents.
3. `pipeline next` tells you the next phase, its prompt and its gate command. `pipeline verify` re-runs every recorded gate and names any drift.

### 3. Worked example
```bash
node pipeline/tools/demo.mjs     # copies examples/mini-app to a temp dir and walks 00 → 12
```
Expected: `RESULT: PASS — phases 00 → 12 completed, every gate recorded`.

### 4. CI
`.github/workflows/pipeline.yml` runs the tool self-tests, the ledger tamper test, the demo, and the review app against a real Postgres service.

---

## 📜 License
MIT — see [LICENSE](./LICENSE).
