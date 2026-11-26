# Second-opinion review — copy everything below the line into Claude

> **How to use this file.** Open the repository `https://github.com/knarayanareddy/sdlc-framework`
> (branch `main`, at or after `420b560`), start a fresh Claude session with repo access, and paste
> everything from `## 0` onward as your message. Nothing else is needed: no attachment, no private
> context.

---

## 0 · Role and task

You are a principal engineer and process architect doing an **adversarial second-opinion review** of a
software-development-lifecycle framework that was just built. The author of that work wrote this
prompt, so treat the author as a witness with an interest in the verdict, not as a source of truth.

Your job has two halves:

- **Part A — audit.** Determine whether the repository actually does what it claims, and report where
  it does not. Every claim you check ends in *verified*, *refuted*, or *not verifiable here*.
- **Part B — roadmap.** Read three industry AI-SDLC playbooks (named in §10), find at least three more
  of comparable substance on your own, judge which of their ideas this build would genuinely benefit
  from, and produce a **step-by-step, phase-by-phase integration plan as a new section of your
  review**.

You are not being asked to be encouraging. A review that says "solid work" and lists style nits is a
failed review. The deliverable is the list of things that are wrong, unproven, or likely to fail in a
real project — followed by a plan that is specific enough to execute next week.

## 1 · What you have, and what you do not

You have: the GitHub repository, its history, and this prompt. That is all. There is no other
documentation, no private backlog, no author available to clarify. **Do not ask for missing context**;
if something is only knowable from outside the repo, mark it `NOT_VERIFIABLE` and say what would
settle it.

Two things in the repo are not the deliverable, so do not review them as if they were:

- `src/` at the repository root — an unrelated Next.js starter scaffold that came with the template.
  Note it as repository debt; do not audit it deeply.
- `comprehensive-development-lifecycle-prompts/` — a real, separate Next.js application ("The Line")
  that presents the framework's material and a review of the older version. It is in scope for
  correctness/security/CI review, but it is a presentation app, not the framework.

The deliverable is `pipeline/`.

## 2 · The objective

The request that produced this work was: *"implement and build everything at pipeline layer level so
we have an executable v2 pipeline."*

The starting point, which you can read for yourself in git history (`e4690b0`), was a repository
containing:

- `pipeline/prompts/` — eleven phase prompts, `00`–`10`, pure prose to be pasted into an agent;
- `pipeline/README.md` — a methodology essay;
- `pipeline/tools/trace-check.mjs` — one small regex tool that checked requirement-to-test tags;
- an earlier review document that found fifteen problems (R-01…R-15) in that design.

The objective was to close those fifteen gaps **as software**: not another prompt that tells an agent
to be careful, but mechanisms that make the claim checkable after the fact. The organising principle
the author chose: **a gate is a command result, not an opinion.** Every gate is executed by the
pipeline itself, its exit code is recorded, and the record is tamper-evident.

Constraints that were set and must be respected in your recommendations:

1. Build at the **pipeline layer** — tools, prompts, gates, orchestrator, schemas, CI. Do not propose
   rewriting the presentation app.
2. The pipeline tools must stay **dependency-free** (Node built-ins only), so the framework has no
   install step of its own. A recommendation that adds a dependency to `pipeline/tools/` needs an
   explicit justification.
3. Fail closed. Anything that cannot be evaluated must be recorded as `NOT_VERIFIED` with the exact
   command a human must run — never silently skipped, never counted as green.

## 3 · What was built (map)

Two commits on top of `e4690b0`:

- `95b746c` — the orchestrator, the gate tools, all fifteen phase prompts, JSON schemas, a worked
  example, and CI.
- `72a73af` — four layers that had only been described in prose: cross-model verifier routing, a
  sandbox, DAST/fuzzing, and planted-bug calibration.

Read these files first, in this order:

| File | Why it matters |
|---|---|
| `pipeline/bin/pipeline.mjs` | the orchestrator: phases, gates, ledger, freeze, estimate, report, verify |
| `pipeline/tools/lib/{common,gates,ledger}.mjs` | shared primitives, the phase/gate table, the hash chain |
| `pipeline/tools/trace-check-v2.mjs` | the traceability gate, including the frozen baseline |
| `pipeline/tools/lib/gates.mjs` | `PHASES` — the fifteen phases and which gates each needs |
| `pipeline/prompts/v2-00…v2-12`, `v2-99` | the prompts an agent actually receives |
| `pipeline/tools/{validate-findings,coverage-gate,entrypoints}.mjs` | the red-team evidence rules |
| `pipeline/tools/{verifier-route,independence}.mjs` | model-family independence |
| `pipeline/tools/{sandbox,fuzz-api,dast,calibrate}.mjs` | the four "layer 2" tools |
| `pipeline/tools/demo.mjs` | the end-to-end proof: an example walked through all fifteen phases |
| `pipeline/examples/mini-app/` | the example itself |
| `pipeline/README.md`, `RUNBOOK.md`, `INTEGRATIONS.md` | the three documents that make claims |
| `REPO-REVIEW.md` | the earlier review, plus §11 mapping each R-nn to its current status |
| `.github/workflows/pipeline.yml` | CI |

Run these four commands first — they are the author's headline claims and they either work or they
do not:

```bash
git clone https://github.com/knarayanareddy/sdlc-framework && cd sdlc-framework
node --version                                  # the tools target Node 22+
node pipeline/tools/run-selftests.mjs           # claim: every tool passes its own test
node pipeline/tools/gate-ledger.mjs demo        # claim: one edited ledger line breaks the chain
node pipeline/tools/demo.mjs                    # claim: phases 00 → 12 run, every gate recorded
```

## 4 · How it was built — the decisions you should attack

Judge the reasoning, not only the code. These are the load-bearing decisions; each is a place where
the design could be wrong in a way tests cannot see.

1. **Hash-chained ledger.** Each gate entry hashes its content plus the previous entry's hash. One
   edited line breaks the chain. `pipeline verify` re-executes every recorded gate and reports drift.
2. **Exit code 3 is a protocol.** A tool that cannot evaluate the work prints
   `NOT_VERIFIED: <reason>` and `human command: <what a human must run>`; the orchestrator records
   `NOT_VERIFIED` with both, rather than a pass or a generic failure.
3. **Two kinds of gate.** Mechanical (a command's exit code) and evidence (judgement gates G3/G4, where
   a named artifact must exist and be substantive). The second is deliberately weaker and says so.
4. **A frozen test baseline.** `trace-check-v2 --baseline` records the set of assertions and test
   cases; `--check-baseline` fails if a file is deleted, an assertion is lost, or a test case
   disappears. The builder cannot weaken a test to make a gate pass.
5. **Evidence tiers for findings.** T1 = an executed regression test, T2 = bounded stress with a
   recorded failure rate, T3 = static proof with two verifiers and a Medium severity ceiling. A
   finding cannot be recorded without one of them.
6. **Coverage is enumerator-driven.** A scanner lists the entry points; every one must appear in the
   coverage ledger as examined (with a hunter id) or excluded (with a written reason). Coverage is not
   self-attested by the red team.
7. **Independence by family, not by prompt.** A verification must be routed to a model whose family
   differs from the builder's; `independence.mjs` reads what the ledger recorded and says PASS, FAIL,
   or NOT_VERIFIED.
8. **Calibration or no zero-finding claim.** Planted bugs, a blind answer file, recall per class. A
   report cannot present "0 confirmed findings" as evidence of a clean codebase unless calibration ran
   for that pipeline version.
9. **Spec-then-freeze.** `SPEC.md` is hashed at phase `FZ`; a later edit fails until a change note is
   written and the freeze is deliberately redone.

## 5 · Claims, each with the command that backs it

Verify or refute each one. A refutation is the most valuable thing you can produce.

| Claim | Command |
|---|---|
| A tool is not trusted until its own test passes | `node pipeline/tools/run-selftests.mjs` |
| Editing one ledger line is detected | `node pipeline/tools/gate-ledger.mjs demo` |
| The pipeline runs end to end and re-verifies without drift | `node pipeline/tools/demo.mjs` |
| A weakened test is caught | `node pipeline/tools/trace-check-v2.mjs <spec> <tests> --check-baseline <baseline.json>` |
| Findings need real evidence | `node pipeline/tools/validate-findings.mjs <findings.json>` |
| Red-team coverage is machine-checked | `node pipeline/tools/coverage-gate.mjs --entrypoints … --ledger …` |
| The fuzzer finds real bugs and stays quiet on strict code | `node --test pipeline/tools/fuzz-api.test.mjs` |
| Recall arithmetic and refusals are correct | `node --test pipeline/tools/calibrate.test.mjs` |
| Independence fails closed | `node --test pipeline/tools/verifier-route.test.mjs` |
| Every prompt the orchestrator names exists and is substantive | `node --test pipeline/tools/prompts.test.mjs` |

## 6 · What is explicitly not done — do not read these as done

The repository claims these are absent. **Verify that the claim of absence is complete**: a gap the
author forgot to disclose is a finding in itself.

- **No live model call has ever been made.** `verifier-route.mjs dispatch` has a transport interface
  and a reference implementation whose request shape is tested with `--dry-run`, but no verdict has
  ever come from a real API.
- **The sandbox has never contained anything.** It was exercised on a Linux host with no container
  runtime and no network namespaces. `sandbox.mjs check` reports what a given host can enforce; the
  hardened compose profile has never been run.
- **No external scanner has been run.** ZAP, nuclei and schemathesis are detected, invoked if present,
  and otherwise reported `NOT_VERIFIED`.
- **Calibration has never been performed.** The maths, refusals and thresholds are tested against
  synthetic data; there is no real measurement.
- **Not attempted at all:** kernel-level isolation, coverage-guided fuzzing, prompt-injection testing,
  and anything that requires a product with an LLM in it.

## 7 · Known bugs, smells, blockers and open disputes

This list is the author's own. It is deliberately uncomfortable to read. Two tasks for you:

- **(a)** For each item, confirm it is real, reproduce it if you can, and say how bad it is.
- **(b)** Find what is missing from it. An undisclosed defect outranks every item below.

**Correctness and portability**

- `B-01` Most tools locate themselves with `path.dirname(new URL(import.meta.url).pathname)` instead of
  `fileURLToPath`. This works on Linux and breaks on Windows paths containing spaces or `%` escapes.
- `B-02` `schemathesis` is declared with `format: "junit"` in `pipeline/tools/dast.mjs`, but no JUnit
  parser exists. Its output would be reported as unrecognised, so that scanner can never produce a
  lead. Confirm.
- `B-03` `dast.mjs run` looks for artifacts relative to the current directory and hardcodes `.zap/`,
  while `--out` names a different directory. The two disagree under a non-default `--out`.
- `B-04` `calibrate.mjs` writes two meaningless fields into `calibration.json` (`example`, and
  `byRule.potted`). Dead data in a machine-read artifact.
- `B-05` `pipeline/schemas/*.json` are documentation: nothing validates against them at runtime, and
  the hand-written validators can drift from the schemas. Check whether they already disagree.

**Security of the tools themselves** (nobody has audited this; assume it is bad)

- `B-06` `common.mjs` runs commands with `shell: true`, built partly from values in
  `pipeline.config.json` (`commands.*`, `fuzzBase`, paths). A hostile or careless config is arbitrary
  command execution. Is that acceptable for a tool that reviews untrusted code, and where is the trust
  boundary documented?
- `B-07` `sandbox.mjs` copies a tree and scrubs the environment, but is process-level isolation on a
  host without namespaces. It prints what it could not enforce; check that it cannot *claim* a control
  it did not apply.
- `B-08` `verifier-route.mjs` dispatches the envelope through a shell command from an environment
  variable. Same question as `B-06`.

**Epistemic weaknesses** (the interesting ones)

- `B-09` `trace-check-v2` is regex-based, not an AST. `expect(x).toBeDefined()` counts as a real
  assertion. Mutation testing is the intended backstop, but the tripwire only runs it when Stryker is
  installed.
- `B-10` `independence.mjs` trusts a declared `builderFamily`. A dishonest operator can lie about it;
  the ledger makes the lie auditable, not impossible. Is that the right ceiling?
- `B-11` `calibrate.mjs` matches a planted bug to a finding by class alias, file and line ±25. A
  correct catch described with different vocabulary, or found by reading the diff, may be scored a
  miss. How much does this distort recall?
- `B-12` The calibration thresholds (recall ≥ 0.7 overall, no class at zero) are asserted, not derived.
  Attack them.
- `B-13` `pipeline gate` extracts the NOT_VERIFIED reason by regex from the tool's output. A tool that
  formats its output differently silently degrades to a generic reason.
- `B-14` Evidence gates (G3 design, G4 architecture) are "the file exists, is substantive, and a
  reviewer read it". Everything mechanical about design quality is unchecked.

**Architecture and scope**

- `B-15` The orchestrator is a state machine, not an agent: it cannot dispatch sub-agents, so the
  prompt `v2-99` asks a driving model to do it. Is that a sound split, or a hole where a model can
  quietly skip a phase?
- `B-16` `pipeline/bin/pipeline.mjs` has no unit tests. Its only end-to-end exercise is `demo.mjs` on a
  three-requirement example with seven tests. What breaks when a real project has 200 tests and 14
  phases of artifacts?
- `B-17` The presentation app resolves files with `path.resolve(cwd, "..", "pipeline", …)`, i.e. outside
  its own directory. Deployed on its own (a Vercel project rooted at that subdirectory) it would fail
  at build. Verify and state the severity.
- `B-18` `protected-paths` downgrades orchestrator-owned files (`docs/progress.json`, the ledger) to
  warnings, because the orchestrator itself writes them between commits. Is the remaining enforcement
  enough?
- `B-19` CI uses `actions/checkout@v4` and `actions/setup-node@v4`, which GitHub now runs with
  deprecation warnings.

**Documentation drift** — the highest-risk area, because prose rots silently

- `B-20` `README.md`, `RUNBOOK.md`, `INTEGRATIONS.md` and the prompts are all prose containing
  commands. Only `prompts.test.mjs` checks that a prompt names a tool that exists. **Execute every
  command in those three documents and report every one that fails, is stale, or does not do what its
  sentence says.** Treat a wrong command in a document as a high-severity defect: the whole framework
  is built on "an unverified claim is a lie".

**Open disputes where the author may simply be wrong**

- `D-01` Is a hash-chained ledger genuinely tamper-evident, or security theatre against an agent that
  has write access to the same directory?
- `D-02` Fifteen phases with eleven gates (G0–G12, with G6 and G8 absent by design): is this the minimum viable control set, or ritual? Which
  phases would you delete outright, and what would break?
- `D-03` The zero-dependency constraint buys an install-free tool and costs an ecosystem. At what point
  does that trade stop being worth it?
- `D-04` Does any of this survive contact with a real repository that already has 400k lines and no
  spec?

## 8 · How to review

1. **Read the code before the documents.** Then read the documents and check whether they describe the
   code you just read.
2. **Run things.** Prefer a command's output to a reading of its source. Where execution is impossible
   here, say so and cite the code path instead.
3. **Try to break it, not to use it.** Pass a bad config, a truncated ledger, a findings file with a
   confirmed finding and no test, a coverage ledger with a missing unit, a spec that changed after the
   freeze, a calibration answer that is tracked by git, a verdict that answers a different envelope.
   Report which of these the pipeline catches and which it waves through.
4. **Separate "unproven" from "wrong".** They have different severities and different fixes.
5. **Never claim a clean bill of health.** "I did not find a problem in X" is a statement about your
   effort, not about X.

## 9 · Required output

Produce one document, `SECOND-OPINION.md`, in the repository or as an artifact you hand back. It must
contain, in this order:

1. **Verdict** — one paragraph, no hedging, on whether the repository achieves "an executable v2
   pipeline" and where it falls short.
2. **Scorecard** — one row per area (orchestrator, traceability, red-team evidence rules, independence,
   sandbox, DAST/fuzzing, calibration, prompts, docs, CI, portability, security of the tools) with
   `PASS / WEAK / BROKEN` and a one-line justification that cites a file or a command.
3. **Verification log** — every command you ran, its outcome, and everything you could not run with
   the reason. This section is what makes the rest credible.
4. **Findings** — `F-01`, `F-02`, … Each: severity (critical/high/medium/low), `file:line`, a
   reproduction (command or request), expected vs actual, and the smallest fix. Include defects you
   found that are absent from §7 and say explicitly that they were undisclosed.
5. **Disagreements** — where you think the design is wrong even though the code works. Argue it.
6. **§7 gap report** — for each `B-` and `D-` item: confirmed / overstated / wrong / missed.
7. **NEW SECTION — `§R · Roadmap: what to take from the AI-native SDLC playbooks`** (see §10 and §11
   for exactly what it must contain).
8. **Appendix** — anything you could not evaluate, and the single experiment that would settle it.

## 10 · The external research mandate

Read these three, in this order of importance:

1. **The AI-native SDLC playbook** — <https://claude.com/resources/articles/the-ai-native-sdlc-playbook>
   (six stages: Plan, Design, Build, Test, Deploy, Maintain; plays per stage; the "every stage commits
   an artifact the next stage reads" pattern — `intent.md`, `spec.md`, `plan.md`, the diff and its
   tests, the PR and its findings, the incident record; hooks as approval gates; continuous evals
   instead of stage-boundary QA gates; layered agentic review with human review reserved for regulated
   or critical code; the commit chain as the audit trail.)
2. **The AI SDLC transformation playbook** — <https://www.atlassian.com/blog/ai-at-work/ai-sdlc-transformation-playbook>
   (the seven pillars; context graph and measurement as platform investments; workflow shifts across
   planning, design, development, review, maintenance; AI review first with shared standards;
   systems of record as what agents read.)
3. **This thread by Itamar Mar** — <https://x.com/itamar_mar/status/2118356299612303305>
   (if it cannot be fetched, say so and extract what you can from any mirror or quote of it; do not
   invent its contents).

Then **find at least three more** resources of comparable substance yourself. Search for, among other
things: spec-driven development tooling (GitHub Spec Kit, AWS Kiro), agent governance and approvals,
AI code review practice, evaluation-driven development, DORA/SPACE/DevEx measurement of AI-assisted
delivery, supply-chain integrity for agent-produced code, and published failure reports of agentic
SDLC rollouts. Prefer primary sources and things with evidence over vendor marketing. Cite each with a
link and a one-line "what it actually claims".

## 11 · The rubric for adopting anything

For each candidate feature from the research, fill one row:

| Feature | Source | Gap in this repo it would close (or `none`) | Benefit 1–5 | Cost / new surface | Verdict |
|---|---|---|---|---|---|

Rules for the verdict column:

- **Adopt** only if it closes a *named* gap in this repository and can be expressed as something the
  pipeline can **gate or verify**. If it cannot be checked mechanically or recorded as a named
  human judgement, it is a wish, not a feature.
- **Reject** loudly where the playbook assumes a context this repository does not have (a Jira/MCP
  context graph, an organisational system of record, a paid observability stack) — but propose the
  cheap local analogue if one exists.
- Anything that would add a dependency to `pipeline/tools/` needs an explicit justification under the
  constraint in §2.
- Do not propose renaming or restructuring what exists unless a specific, demonstrable defect requires
  it. The pipeline is meant to be incremented, not rewritten.

## 12 · The roadmap section, precisely

`§R` must be executable by someone who has only this section, and must consist of **phases**, not
themes. For each phase `R0, R1, R2, …`:

- **Objective** — one sentence.
- **Why now** — the finding or research feature it implements, with its identifier (`F-nn`, `B-nn`, or
  a source).
- **Design sketch** — the mechanism in 3–6 sentences: what is a command, what is recorded, what fails.
  Name the data it writes.
- **Files touched** — exact paths, new and modified.
- **Commands** — the real shell commands, in order, including the gate invocation
  (`node pipeline/bin/pipeline.mjs gate G… --builtin …`).
- **Proof** — the test or CI step that demonstrates it works, phrased as a command with an expected
  outcome. No phase without a proof.
- **Prompt changes** — which of `pipeline/prompts/v2-*` must change, and the diff in intent.
- **Definition of done** — machine-checkable. If it is a judgement call, say so explicitly.
- **Rollback / risk** — what to revert, and what could silently break.
- **Effort** — S / M / L with a reason, not a number of days.

Order the phases so that each one is independently shippable and leaves the pipeline green. Put
anything that cannot be verified in this repository's own frame (no credentials, no container runtime)
in a final phase labelled as requiring an environment the author must provide, and say exactly what
that environment needs.

Close `§R` with:

- **A sequencing table** — phase, dependency, gate it strengthens, and whether it changes
  `pipeline/VERSION` (the pipeline's own rule is that changing the red-team prompts invalidates
  calibration; your plan must respect that).
- **A "do not do" list** — the tempting ideas from the playbooks that would make this worse, and why.
- **A one-page summary** for someone deciding whether to fund the work.

Begin with §0 of the output, not with a preamble about how you approached the review.
