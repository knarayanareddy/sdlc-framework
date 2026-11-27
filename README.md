# SDLC Framework

> **Autonomous Build Pipeline**: Brief → Researched Spec → Built → Tested → Red-Teamed → Patched → Shipped.

A comprehensive prompt and verification framework designed for LLMs, autonomous coding agents, and engineers.

**v1 is a manual. v2 is an executable pipeline**: an orchestrator that runs each gate itself, records the exit code in a hash-chained ledger, and refuses to advance a phase whose prerequisites are missing. Twenty-three zero-dependency tools — twenty have a test that names them, and the remaining three (`demo`, `expect-files`, `run-selftests`) are exercised by the demo and by CI — plus a worked example that walks every phase, and a live-environment harness that turns the four things a repo cannot do alone into a checklist with one command per item.

Three things worth knowing before you trust a green run:

- **A gate is a command result, not an opinion** — including when the command is one the caller chose. `pipeline gate --cmd` is refused unless a human commits that exact command to `docs/00-control/allowed-commands.json`; the file is read from git, never from a path the caller names (2.7.1 — the 2.7.0 `--allow-commands` flag let the same command line supply both the command and its approval). At 2.1.0 `gate G7 --cmd true` recorded a pass.
- **Only G3 is an evidence gate** — every other gate has to run a command. At 2.7.0 `--evidence <any file ≥64 B>` recorded `passed/exit 0` for nine gates, G11 among them, and `verify` then reported "no drift" (2.7.1).
- **A forced phase is not a clean one** — `--force` writes `status: forced` and the checks it overrode into the hash chain, and the report grows a **Forced** section. `pipeline verify` re-runs the command the *ledger* recorded, so editing `progress.json` shows up as drift (2.7.2).
- **Independence needs a dispatched verdict** — `--model gpt-5` alone is reported as *declared, not evidenced*. Only a verdict that `verifier-route dispatch` produced (it writes a `.attest` beside it) and that `gate … --verdict` recorded puts `verdictSha256` in the ledger and earns the stronger sentence (2.7.2).
- **Only an assertion inside a test case covers a requirement** — comments and string literals are stripped before counting, and an assertion outside any `test(`/`it(` body does not count. A file whose only "assertions" were `// expect(1).toBe(2)` used to cover five requirements and pass G5 (2.8.0).
- **A baseline is not re-created after the fact** — once phase 05 is done, a missing `docs/05-test/baseline.json` is an error, not an invitation to freeze whatever the tests now say. `rm baseline.json` used to turn gutted tests into a pass (2.8.0).
- **Protected paths fail closed** — zero rules is `NOT_VERIFIED`, and the rules are read from the base commit, so editing `pipeline.config.json` does not disarm the check. It now runs at the end of phases 00, 06, 09 and 10, not only at the start (2.8.0).
- **A `file:` source may only come from `docs/01-research/`** — the temp dir used to count, so any `/tmp` file was a citable "page" (and the suite failed on a clone that lived under `/tmp`) (2.8.0).
- **Fail-closed means an empty input is not a clean one** — an empty `entrypoints` list no longer means "0/0 routes covered", zero tripwire checks and zero protected rules are `NOT_VERIFIED`, `metrics.json` refuses a ledger that does not verify, and `live-check probe` caps at `PARTIAL` (only `verify --run` says `READY`) (2.8.1).
- **The `dast` builtin is the repo's own harness** — the old default was an npm package that returns 404, so `gate G8 --builtin dast` could never run; stale scanner artifacts no longer count as output, and `--target` must be a plain URL (2.8.1).
- **A compose file is checked, not linted** — `cap_add`, `seccomp:unconfined`, `pid: host`, `devices:` and writable binds fail `sandbox.mjs verify`, and `run --require-all` treats an unapplied control as a refusal (2.8.1).
- **A round is a run directory** — `phase done 08 --run docs/08-redteam/run-2` records a second round, so the stop-at-3-FULL-rounds rule is reachable (2.8.1).
- **The enumerator sees the framework you used** — Express/Fastify/Hono handlers registered in code, `pages/api/**`, and a route under `app/api/build/` (a directory called `build` is output only when it holds no routes). Code that matches no route convention is `NOT_VERIFIED`, not "0 entry points, nothing to cover" (2.9.0).
- **A FULL round needs coverage evidence** — `mode: FULL` in `findings.json` now has to survive `coverage-gate`, and a round that cannot show it is recorded as `DIFF` with the reason in the ledger (2.9.0).
- **Calibration is bound to what it scored** — `calibration.json` records the sha256 of its plan, blind answer and findings plus a fingerprint of the red-team prompts; `calibrate status` recomputes all four, so editing a plant or a prompt invalidates the number, while a pipeline version bump alone does not (2.9.0).
- **The record says where it started and what it read** — the genesis entry pins `baseCommit`, and every gate pins the digest of each input it was judged on. `verify` re-hashes them: rewriting `findings.json` after the last gate that read it is drift, not history (2.9.0).
- **G10 will not certify an unsealed ledger** — the final gate refuses to pass unless every entry carries an HMAC, which means `PIPELINE_LEDGER_KEY` was set where the build agent cannot read it. The demo plays the human and holds the key (2.9.0).
- **Evidence has to read like evidence** — `--evidence` runs a substance check (a heading, readable prose, no placeholders, parseable JSON) and records it as a re-runnable command; slice logs must also name a requirement (2.9.0).
- **The report cannot be stale** — any gate recorded after `FINAL-REPORT.md` exists regenerates it, instead of the report describing the ledger from before that gate (2.9.0).
- **`pipeline verify --check` is read-only** — it re-runs only the recorded commands that cannot write files, and says which ones it left alone; the plain `verify` still re-runs everything (2.9.0).
- **A catch counts even in other words** — calibration scores a finding at the planted line as a hit whatever class it named, and the report prints how many were matched that way (2.9.0).
- **`live-check --run` exercises the transport you configured** (not the reference example), a run with zero `REQ-`/`SEC-`/`NFR-` ids is `NOT_VERIFIED` rather than "no requirements", and CI runs `live-check probe` so the tool's own environment assumptions are exercised (2.9.0).
- **Coverage is per test case, not per file** — a file tagged `@req REQ-001 REQ-002` used to count as covering both from a single assertion. Now a requirement is covered by the test case that names it (in its title or an `@req` line inside it); a file that only tags itself needs one asserting case per tagged requirement (2.9.1).
- **`manual` is not a builtin** — `--builtin manual,unit` used to drop `manual` without a word, so the mechanical half certified a judgement gate. It is now an error that says how to record a human judgement instead (2.9.1).
- **Protected paths are checked strictly at release** — `verify` and `phase done 12` run `protected-paths --strict`, where the orchestrator-owned state files are not waved through as warnings: an appended ledger that verifies and a `progress.json` the chain cross-checks pass; a rewritten ledger or a hand-edited gate does not. The files `pipeline init` creates itself are recorded by digest, so creating a project does not look like a violation and editing them afterwards still does (2.9.1).
- **What runs your commands** — every gate command, `commands.*` in `pipeline.config.json`, `--cmd` (only after a human allowlists the exact string), and `PIPELINE_VERIFIER_CMD` are executed through a shell. The trust boundary is that config file and the environment: whoever can edit either runs code as you. The allowlist stops the *agent* from choosing its own command; it is not a sandbox, and the ledger records what ran, not what it was allowed to do (2.9.1).
- **G11 is closed by a named human** — `gate G11 --attested-by <name>` with `PIPELINE_HUMAN=1`; the name is written into the hash chain. A convention, not a boundary: the builder shares the shell, so the attestation makes a bypass explicit rather than impossible.
- **The ledger catches accidental edits, not a hostile agent.** It is an unkeyed hash chain inside a directory the build agent can write to. Deleting the tail lines and recomputing the links defeats it. What narrows that gap: the chain is cross-checked against `docs/progress.json` (so a truncated tail leaves gates progress still claims), every entry records a hash of the source tree the gate ran against, and setting `PIPELINE_LEDGER_KEY` outside the agent's environment seals each entry with an HMAC — G10 will not certify the ledger without it (2.9.0).
- **The spec freeze is enforced.** `docs/02-spec/SPEC.sha256` is re-checked by `verify`, by `trace-check` and by `phase done`; re-freezing requires a change note in `docs/02-spec/CHANGES.md`.

```bash
node pipeline/tools/run-selftests.mjs      # every tool passes its own test
node pipeline/tools/demo.mjs               # walk phases 00 → 12 on a worked example
node pipeline/bin/pipeline.mjs --help      # init | gate | verify [--check] | phase | freeze | estimate | report
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
