# Second-opinion review #3 — copy everything below the line into a fresh agent session

> **How to use this file.** Point a fresh agent session at
> `https://github.com/knarayanareddy/sdlc-framework`, on **`main` at `b7fc97d` or later**
> (check `cat pipeline/VERSION` → `2.7.0`). Give it the repository and everything from `## 0`
> onward. Nothing else is needed and nothing else will be provided.
>
> This prompt replaces `SECOND-OPINION-PROMPT.md` for this state of the repo. That one reviewed the
> build at `72a73af`; this one reviews what was done about its findings.

---

## 0 · Role and task

You are a principal engineer doing an **adversarial review of a repair job**.

An earlier reviewer produced a list of defects in a software-development-lifecycle framework. The
author then spent six phases (P0–P6) fixing them, and wrote up each phase in
`REVIEW-OF-SECOND-OPINION.md` §11–§16. Those write-ups are the claim under review. They are written
by the author, who has an interest in the verdict — treat them as a **witness statement**, not as
evidence.

Your job is not to list style issues. It is to answer one question, precisely:

> **Did P0–P6 close the defects, or did they relocate the theatre?**

A fix that adds a check which can be bypassed by the next flag over is not a fix. A regression test
that asserts a command exited 0, without establishing that the bypass is gone, is not a test. Both
failures are invisible in a green CI run, and both are what you are looking for.

Secondary question, equally important:

> **What does the author still not know is wrong?**

Every defect you find that is absent from §7 below is worth more than ten confirmations of the ones
that are there.

## 1 · What you have, and what you do not

You have: the GitHub repository, its git history, and this prompt. Nothing else. No author is
available. **Do not ask for context.** If something is only knowable from outside the repo, mark it
`NOT_VERIFIABLE` and name the experiment that would settle it.

Out of scope, and do not spend your budget there:

- `src/` at the repository root — an unrelated Next.js starter scaffold from the template. Repository
  debt, not the deliverable.
- `comprehensive-development-lifecycle-prompts/` — a separate Next.js app that presents the framework.
  In scope only for correctness/security/CI, never as the framework itself.
- Re-litigating the *design choices* (fifteen phases, hash-chained ledger, zero dependencies). One
  earlier review already did that and the author kept them deliberately. Attack whether they are
  **implemented as claimed**; if you think a choice is simply wrong, put it in §6 of your output and
  move on.

The deliverable is `pipeline/`.

## 2 · The objective, restated by the author

The standing rule of this repository is one sentence long: **a gate is a command result, not an
opinion.** Everything else follows from it:

1. The orchestrator runs each gate itself and records the exit code in a hash-chained ledger.
2. Exit code **3 is a protocol**: "I could not evaluate this", printed as `NOT_VERIFIED: <reason>`
   plus `human command: <what a person must run>`. It is never converted into green.
3. Anything that cannot be checked must say so out loud. An unverified claim is treated as a lie.
4. Every bypass that was ever found must become a permanent regression test.

**Judge the repository against its own rule**, not against generic best practice. When you say a
finding is high severity, the argument should be "this violates rule 1/2/3/4", not "industry would
do X".

Constraints that still hold, and that your recommendations must respect:

- **Zero dependencies** in `pipeline/tools/` (Node built-ins only). A proposal that adds one needs an
  explicit justification.
- No rewriting what exists unless a specific, reproduced defect requires it.
- A human must stay at the two human gates (`H1`, `G11`). Do not propose removing them.

## 3 · What changed since the last review

Seven commits on `main`. Read the diffs; do not read the write-ups first.

| Phase | Commit | One-line claim |
|---|---|---|
| v2 pipeline | `95b746c` | orchestrator, gate tools, 15 prompts, schemas, worked example, CI |
| four layers | `72a73af` | verifier routing, sandbox, DAST/fuzz, planted-bug calibration |
| P0 | `50b57e4` | a gate cannot be talked into passing; phases cannot be reordered; a frozen spec cannot be silently edited |
| P1 | `e2ea965` | "found nothing" cannot mean "clean": zero entry points / empty scope is `NOT_VERIFIED` |
| P2 | `799786c` | the verifier is given the files it cites; independence needs a known builder family |
| P3 | `5fcc34c` | `trace:check` stopped exempting itself; T1/T2/T3 evidence tiers tightened |
| P4 | `831fec9` | `plan-check` at G4 (`--builtin plan`), `plan:slices` at phase 06, `--scope`/`--changed-since` on three tools |
| P5 | `831fec9` | `metrics.json` computed from the ledger, `progress.rounds` actually increments, `FINAL-REPORT.md` regenerated, schemas tested against their validators |
| P6 | `8a58ec8`+`d6fcd8f` | `live-check.mjs`: the four environment-bound items as a checklist with a fail-closed definition of done |

Total: 23 tools, 23 test files, 227 tests, version `2.7.0`.

## 4 · Read these first

| File | Why |
|---|---|
| `pipeline/bin/pipeline.mjs` | the orchestrator: `gate`, `phase`, `verify`, `report`, `live`, ledger records |
| `pipeline/tools/lib/{ledger,gates,common,families,scope,rounds,jsonschema}.mjs` | the primitives the rest is built from |
| `pipeline/tools/plan-check.mjs` | P4's substance gate — the newest and least settled logic |
| `pipeline/tools/metrics-compute.mjs` | P5's "numbers come from evidence" |
| `pipeline/tools/live-check.mjs` | P6's readiness harness |
| `pipeline/tools/{trace-check-v2,validate-findings,coverage-gate,entrypoints}.mjs` | the red-team evidence rules, touched by P1/P3 |
| `pipeline/tools/{verifier-route,independence,sandbox,dast,calibrate}.mjs` | the four "layer 2" tools |
| `pipeline/tools/*.test.mjs` | **read the tests as adversarially as the code** — §8 explains why |
| `pipeline/schemas/`, `schemas.test.mjs` | six schemas and the harness that checks schema/validator agreement |
| `REVIEW-OF-SECOND-OPINION.md` §11–§16 | the author's claims. Read **after** the code, then check them |
| `pipeline/{README,RUNBOOK,INTEGRATIONS,P6-LIVE}.md` | four documents full of commands and numbers |
| `.github/workflows/pipeline.yml` | CI: what is actually run on every push |

First four commands — each is a claim that either holds or does not:

```bash
git clone https://github.com/knarayanareddy/sdlc-framework && cd sdlc-framework
git log --oneline -1 && cat pipeline/VERSION            # expect b7fc97d (or later) and 2.7.0
node pipeline/tools/run-selftests.mjs                   # claim: 23 files, every tool passes its own test
node pipeline/tools/demo.mjs                            # claim: phases 00 → 12, every gate recorded, RESULT: PASS
node pipeline/tools/live-check.mjs probe                # claim: 0/4 on a bare host, exit 3, artifact written
```

## 5 · The decisions P0–P6 added — attack the reasoning

Each line is a load-bearing claim. For each: what would have to be true for it to be false, and can
you make that true?

1. **`plan-check` uses the source, not the prose.** It takes routes from `entrypoints.json`
   (enumerated from source in phase 08) and falls back to the spec's `| METHOD | path |` table. Both
   are text. Is either a ground truth?
2. **Slices must deliver requirements.** `plan:slices` at `phase done 06` requires every
   `REQ/SEC/NFR` id to appear in some `slice-*.md`, and a slice that names no id is a problem.
   Appearance is not delivery. What is the cheapest way to satisfy it dishonestly?
3. **Scope is honest about being partial.** `--scope`/`--changed-since` on `entrypoints`,
   `coverage-gate`, `trace-check-v2` print `SCOPED (…): this run covers part of the project` and the
   trace verdict becomes `PASS (scoped to …; tag hygiene only, not a coverage claim)`. Can a scoped
   run still end up as the only evidence behind a gate?
4. **`metrics.json` is computed, not written.** `metrics-compute.mjs` derives it from the ledger,
   `progress.json`, the spec and the findings; `computed: true` plus a `derivedFrom` map with sha256
   per source. What stops a `computed: true` file from yesterday being quoted tomorrow, after the
   ledger moved on?
5. **The round counter is real.** `phase done 08/09` reads the findings file's `mode` and derives
   `progress.rounds`; `validate-progress` fails when `rounds` disagrees with `roundLog`. The stop
   rule is "at most 3 FULL rounds". Who decides a round's `mode`, and what happens if it is labelled
   `DIFF`?
6. **The report cannot be stale.** `FINAL-REPORT.md` is rewritten when phases 10, 11 and 12 complete,
   and it states whether the metrics it quotes are computed, hand-written or absent. Is there any
   sequence of commands that leaves it describing an older ledger?
7. **Schemas and validators now agree.** `schemas.test.mjs` runs one document through a ~90-line
   JSON-Schema subset and through the real validator, and fails when the verdicts differ; one rule
   (`rounds` = counts of `roundLog`) is declared inexpressible instead of hidden. Are the schemas
   enforced anywhere at **runtime**, or is this agreement a test-only property?
8. **Readiness is not a file.** `live-check` asks the environment (`docker info`, `nuclei -version`,
   family resolution, `calibrate.mjs status` for *this* version) and adds **no gate**, because a gate
   over a readiness directory would pass on a directory. Does `probe` alone ever say `READY` for
   something that cannot actually run?
9. **Fail-closed has no exceptions.** Exit 3 everywhere it applies; `--allow-uncovered` only for
   `trace:structure`/`trace:freeze` and it says so in the verdict; a scope selecting no files is exit
   3. Find the place where a `NOT_VERIFIED` becomes something better.

## 6 · Claims, each with the command that backs it

Verify or refute. A refutation is the most valuable output you can produce.

| Claim | Command |
|---|---|
| Every tool passes its own test | `node pipeline/tools/run-selftests.mjs` |
| The example walks all phases and every gate is recorded | `node pipeline/tools/demo.mjs` |
| Editing one ledger line is detected | `node pipeline/tools/gate-ledger.mjs demo` |
| The plan cannot contradict the spec or the code | `node pipeline/tools/plan-check.mjs --require threat,authz,slices` in `pipeline/examples/mini-app` |
| Metrics are derived from named sources | `node pipeline/tools/metrics-compute.mjs --out /tmp/m.json` then read `derivedFrom` |
| A hand-written metrics file cannot pass G12 | build a project, write `docs/12-eval/metrics.json` by hand, run `gate G12 --builtin metrics` |
| Schemas and validators agree | `node --test pipeline/tools/schemas.test.mjs` |
| A scoped run cannot pretend to be a coverage claim | `node pipeline/tools/trace-check-v2.mjs docs/02-spec/SPEC.md tests --scope src/lib` |
| Live readiness is asked, not assumed | `node pipeline/tools/live-check.mjs verify --run` |
| The report says where its numbers came from | `node pipeline/bin/pipeline.mjs report` then read the metrics/calibration lines |

## 7 · The author's own defect list — the uncomfortable part

Two tasks: **(a)** confirm each, reproduce it where you can, and judge severity; **(b)** find what is
missing. **An undisclosed defect outranks everything below.** Do not spend more than ~30 minutes
confirming this list; the value is in (b).

**Known and unfixed at 2.7.0** (the author found these while writing this prompt)

- `B-21` **`phase done --force` writes a clean pass.** When `phase done` has blocking problems it
  exits 1 — unless `--force`, in which case it writes
  `{gate: "P<id>", status: "passed", exitCode: 0}` with no record of the bypass and no record of
  which checks failed. A forced completion is indistinguishable from an honest one in the ledger.
- `B-22` **G4 can still be satisfied by `--evidence`.** P4 made `--builtin plan` the suggestion for
  G4, but `gate G4 --evidence threat-model.md,authz-matrix.md` still passes when both files are
  ≥ 64 bytes (`substantialFile()` is a byte count). The P0-era bypass is still open on the gate P4
  was written for.
- `B-23` **`plan-check` matches substrings, not rows.** The authz check is
  `matrix.includes("GET /api/items")`, so a matrix that lists only `GET /api/items/:id` passes the
  check for `GET /api/items`. The same holds for `threat` (any mention of `SEC-001`) and `slices`
  (the sentence "REQ-001 was dropped from scope in this slice" counts as delivery).
- `B-24` **`live-check verify --run` exercises the reference transport**, not the transport the user
  configured in `PIPELINE_VERIFIER_CMD`. Its "transport --dry-run: request built" evidence can be
  about a command that is not the one that will run.
- `B-25` **`live-check probe` says `READY scanners` from `command -v`.** Any executable named
  `nuclei` satisfies it; the binary is only exercised with `--version` under `verify --run`. Decide
  whether a probe that never executes is allowed to print `READY`.
- `B-26` **`metrics.json` freshness is unverified.** `derivedFrom` records the sha256 of each source
  at computation time, but nothing re-checks those hashes later, so `computed: true` + stale is
  indistinguishable from fresh unless a reader inspects `at` by hand.
- `B-27` **The report is stale after any post-12 gate.** Regeneration happens on `phase done 10/11/12`
  only; re-recording a gate afterwards (which is the normal way to close a `NOT_VERIFIED`) leaves
  `FINAL-REPORT.md` describing the previous ledger.
- `B-28` **`metrics-compute` counts requirements with a heading regex** (`^### (REQ|SEC|NFR)-\d+`). A
  spec that uses `##` or a table yields `requirements: 0`, which reads as "the spec has no
  requirements", not as "the counter failed".
- `B-29` **`manual` inside a `--builtin` list is silently dropped.** An unknown name fails loudly
  (checked: `--builtin lnt` exits with "unknown builtin"), but `builtin("manual")` returns `null` and
  the loop does `continue`. So `gate G7 --builtin manual,unit` certifies G7 from `unit` alone, and the
  "this gate is a human judgement" intent disappears without a word.

**Carried over from the earlier reviews, still open by design or omission**

- `B-30` `trace-check-v2` counts coverage **per file**: one assertion in a file tagged
  `@req REQ-001 REQ-002` covers both.
- `B-31` `independence.mjs` trusts the declared `builderFamily`; the ledger makes a lie auditable,
  not impossible.
- `B-32` `calibrate.mjs` scores by class alias + file + line ±25, so a correct catch described in
  different vocabulary can be scored a miss.
- `B-33` Evidence gates other than G4 (G3 design, and `release`/`slices` artifact checks) remain
  "the file exists and is ≥ 64 bytes".
- `B-34` `protected-paths` downgrades orchestrator-owned paths (`docs/progress.json`, the ledger) to
  warnings unless `--strict`; nothing forces `--strict` at release.
- `B-35` `common.mjs` runs commands with `shell: true`, partly from `pipeline.config.json` values —
  arbitrary execution by design. Is the trust boundary documented where a user would read it?
- `B-36` CI runs the tests and the demo, but never `live-check probe` — so the tool's own environment
  assumptions are only covered by its unit tests.

**Where to spend your remaining time** (the author has not audited these deeply)

- Flag interactions in `pipeline gate` and `pipeline phase`: `--force`, `--evidence`, `--cmd`, `--not-verified`,
  `--builtin`, and `parseArgs`'s quirk that `--flag --other` becomes boolean `true`. Enumerate the
  flag combinations that produce a green row, then rank them by how little work the caller did.
- `verify`'s drift comparison: what counts as "match" for each gate type, and whether it can report
  `match` for a gate whose evidence has since become false.
- `protected-paths --strict` and the base-commit logic, on a repo where the agent commits.
- `sandbox.mjs`: check that it cannot *claim* a control it did not apply, including under
  `--require-all`.
- `dast.mjs` parsers against real tool output shapes; `fuzz-api.mjs` false-negative behaviour.
- `calibrate.mjs` arithmetic under adversarial answer files.
- The 14 prompts in `pipeline/prompts/v2-*`: do they still describe the tools that now exist, after
  six phases of changes? Only `prompts.test.mjs` checks that a named tool exists.
- Documentation drift: **execute every command in `README.md`, `pipeline/RUNBOOK.md`,
  `pipeline/INTEGRATIONS.md`, `pipeline/P6-LIVE.md`** and report every one that fails, is stale, or
  does not do what its sentence says. These four documents changed a lot in P4–P6.

## 8 · How to review

1. **Read the code before the write-ups**, then check whether §11–§16 describe the code you read.
2. **Run things.** Prefer output to source-reading. Where execution is impossible here (no key, no
   docker, no scanners — see §9), cite the code path and say `NOT_VERIFIABLE`.
3. **Read every test as an attacker.** For each test that claims to close a bypass, ask: *what would
   have to be true for this test to pass while the bypass is still open?* Examples of the failure
   mode you are hunting: a test that asserts only an exit code; a test whose fixture makes the
   dangerous branch unreachable; a test that stubs out the very component whose behaviour is the
   claim (`live-check.test.mjs` replaces `PATH` with stubs — is that the right call, and does it hide
   anything?); a test that would still pass if the fix were reverted.
4. **Reproduce before you assert.** A finding needs a command and its output, or a `file:line` and a
   precise argument for why the code cannot do what it says.
5. **Separate "unproven" from "wrong".** They have different severities.
6. **Never claim a clean bill of health.** "I found nothing in X" is a statement about your effort.
7. **Try the honest-user path too, not only the attacker path**: run the pipeline the way
   `pipeline/RUNBOOK.md` says to and report where it is confusing, slow, or produces a state the
   next command cannot consume. A framework nobody can drive is also broken.

## 9 · What is explicitly not done — verify that this list is complete

A missing disclosure is itself a finding.

- **No live model call has ever been made.** The verifier transport's request shape is tested with
  `--dry-run`; no verdict has come from a real endpoint. `independence.mjs` is therefore
  `NOT_VERIFIED` on any real run.
- **No container has ever run.** `sandbox.mjs` reports what a host can enforce; the generated compose
  profile has been validated as YAML/text, never executed.
- **No external scanner has ever run here.** ZAP, nuclei and schemathesis are detected; their
  parsers are tested against fixtures the author wrote.
- **Calibration has never been performed.** The arithmetic, refusals and thresholds are tested
  against synthetic data; there is no measured recall.
- **Not attempted:** kernel-level isolation, coverage-guided fuzzing, prompt-injection testing of an
  LLM product, anything requiring a product with a browser.
- `docs/13-live/live-readiness.json` is generated per project by `live-check`; nothing in the repo
  ships a real one.

## 10 · Required output

One document, `SECOND-OPINION-3.md`. In this order:

1. **Verdict** — one paragraph, no hedging: did P0–P6 close the defects or relocate the theatre?
   Name the single strongest piece of evidence for your answer.
2. **Scorecard** — one row per area (orchestrator, ledger, traceability, red-team evidence rules,
   verifier independence, sandbox, DAST/fuzz, calibration, plan/substance gates, metrics/reporting,
   live harness, schemas, prompts, docs, CI, portability, security of the tools) with
   `PASS / WEAK / BROKEN` and a one-line justification citing a file or a command.
3. **Verification log** — every command you ran, its outcome, and everything you could not run and
   why. This section is what makes the rest credible.
4. **Did the fix fix it?** — one row per P0–P6 claim (nine rows, from §5): claim → the test that is
   supposed to prove it → your verdict (`closed`, `partially closed`, `not closed`, `moved`) → the
   command or `file:line` that decides it. **This table is the heart of the review.**
5. **Findings** — `G-01`, `G-02`, … Each: severity (critical/high/medium/low), `file:line`, a
   reproduction (command and output, or a precise code argument), expected vs actual, the smallest
   fix, **and the regression test that would have caught it**. State explicitly for each whether it
   was disclosed in §7 or is undisclosed.
6. **Test-theatre report** — the tests that do not test what they claim, and what a real test would
   assert instead. This is the section the author most wants and least expects.
7. **Disagreements** — where the design is wrong even though the code works. Argue it. Keep it short.
8. **The next three fixes** — not a roadmap. Three defects, ordered, each with: the reproduction, the
   fix in ≤ 10 lines of description, the regression test, and which `VERSION` bump it forces under
   the repo's own rule (changing red-team prompts invalidates calibration).
9. **Appendix** — everything you could not evaluate, and the single experiment that would settle each.

Begin at §1 of the output. Do not open with a summary of how you approached the review, and do not
close with encouragement.
