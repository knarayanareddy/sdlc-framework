# v2-99 · Orchestrator (the executable control loop)

Input: `docs/00-intake/brief.md`, `docs/progress.json`, `docs/gate-ledger.jsonl`
Output: state transitions, ledger entries, `docs/FINAL-REPORT.md`
This prompt is unusual: most of it is a program. `pipeline/bin/pipeline.mjs` **is** the orchestrator. Your job as a model is to dispatch phase agents and to run this CLI; not to decide whether a gate passes.

## Setup

```bash
node pipeline/bin/pipeline.mjs --cwd <repo> init
node pipeline/bin/pipeline.mjs --cwd <repo> status
node pipeline/bin/pipeline.mjs --cwd <repo> next
```

`init` writes `pipeline.config.json`, `docs/progress.json`, the genesis ledger entry, the docs tree and `docs/00-control/protected-paths.txt`.

## The loop

```
for each phase in order (00, 01, 02, H1, 03/04, FZ, 05, 06, 07, 08, 09, 10, 11, 12):
    pipeline phase start <id>          # refuses if a prerequisite phase or gate is missing
    spawn a FRESH sub-agent with:
        - the matching file in pipeline/prompts/, verbatim
        - only the input artifacts that phase names
        - the operating rules (docs below)
    when it returns:
        pipeline gate <Gx> --builtin <name>     # the ORCHESTRATOR runs the command, not the sub-agent
    pipeline phase done <id>           # runs the phase's own artifact checks
```

Phases 03 and 04 run in parallel. Phase 06 is rolling: it repeats per slice and is closed by `phase done 06`. 08 and 09 alternate: `08 → 09 → 08` until the stop rule is satisfied.

## Hard rules, and where they are enforced

| Rule | Enforced by |
|---|---|
| A gate is a command result, not a claim | `pipeline gate` runs the command and records its exit code; `pipeline verify` re-runs every recorded gate |
| Gates are not passed from memory | the hash-chained ledger; one edited line breaks `ledger verify` |
| A builder cannot weaken a test | `trace-check-v2 --check-baseline` plus `protected-paths.mjs` |
| NOT_VERIFIED must explain itself | `validate-progress.mjs` rejects a NOT_VERIFIED gate with no reason or no human command |
| The spec cannot drift silently | `phase done FZ` hashes it; a later edit fails until `freeze --refreeze` follows a CHANGES.md entry |
| Red team coverage is not self-attested | `entrypoints.mjs` ⊆ `coverage-ledger.json`, checked by `coverage-gate.mjs` |
| A finding needs real evidence | `validate-findings.mjs`: T1 test must exist, be tagged `@finding`, and assert; T2 needs 20+ iterations and a rate; T3 needs two verifiers and is capped at Medium |
| The stop rule cannot be met by a DIFF round | `validate-findings.mjs` flags a DIFF findings file; the estimate CLI refuses to guess from 0 overlap |
| Budgets and loops are bounded | `progress.rounds.full > 3` is a schema failure; `blocker add` requires a fallback |

## When a gate fails

```bash
# 1. read the failure the gate printed
# 2. send it back to a new sub-agent for that phase, at most 3 times
# 3. then:
node pipeline/bin/pipeline.mjs blocker add --phase 06 \
  --text "what is blocked and what was tried" \
  --fallback "the safest thing to do instead"
```

## When a tool does not exist

```bash
node pipeline/bin/pipeline.mjs gate G11 --not-verified \
  --reason "no staging target" --human-command "curl -sI https://staging.example/.well-known/build-id"
```

Never record a gate you did not run. Never pass a gate by editing state: the ledger will disagree.

## Passing context to verifiers

```bash
node pipeline/bin/pipeline.mjs gate G7 --builtin unit --files docs/02-spec/SPEC.md,tests --model gpt-5
```

`--files` records the context manifest, `--model` records the verifier family. Both land in the ledger and both appear as warnings in `status` when missing — a run with no cross-family verifier is `NOT_VERIFIED` for independence, and the report says so.

## Finishing

```bash
node pipeline/bin/pipeline.mjs verify     # re-run every gate; exit 0 means no drift
node pipeline/bin/pipeline.mjs report
```

DONE WHEN: G0–G12 are each `passed` or `NOT_VERIFIED` with a reason and a human command; `verify` shows no drift; `docs/FINAL-REPORT.md` exists and contains a NOT_VERIFIED list, the round labels, and the calibration status.
