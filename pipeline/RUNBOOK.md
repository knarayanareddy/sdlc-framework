# Runbook: executing the v2 pipeline

Everything here is a real command in this repository. No step requires a model until a
prompt tells you to dispatch one.

## 0 · What you need

Node 22+. Nothing else: the pipeline tools have **zero dependencies** and use only Node
built-ins. The product under test brings its own toolchain.

```bash
node --version                      # >= 22
node pipeline/tools/run-selftests.mjs   # every tool passes its own test before you trust it
node pipeline/tools/gate-ledger.mjs demo   # the G0 tamper test
```

## 1 · Start a run in a target repo

```bash
cd /path/to/product
node <this-repo>/pipeline/bin/pipeline.mjs init
node pipeline/bin/pipeline.mjs status
node pipeline/bin/pipeline.mjs next
```

`init` writes:

```
pipeline.config.json              # paths + commands; edit before phase 05
docs/progress.json                # the state file
docs/gate-ledger.jsonl            # genesis entry
docs/00-control/protected-paths.txt
docs/{00-intake,00-control,01-research,02-spec,03-design,04-architecture,
      05-test,06-build,07-qa,08-redteam/run-1,09-patch,11-deploy,12-eval}/
```

If the pipeline lives outside the product, pass `--cwd` on every call or copy
`pipeline/` into the product.

## 2 · Drive the phases

One phase per fresh agent session. The orchestrator refuses to start a phase whose
prerequisites are missing, and refuses to close one whose gates are not recorded.

```bash
node pipeline/bin/pipeline.mjs phase start 01
node pipeline/bin/pipeline.mjs gate G1 --builtin quotes
node pipeline/bin/pipeline.mjs phase done 01
```

| Phase | Gate | Typical command |
|---|---|---|
| 00 guardrails | G0 | `gate G0 --builtin ledger,selftests` |
| 01 research | G1 | `gate G1 --builtin quotes` |
| 02 spec | G2 | `gate G2 --builtin trace:structure` |
| H1 digest | — | `phase done H1` (needs `docs/02-spec/DECISIONS.md`) |
| 03 design | G3 | `gate G3 --evidence docs/03-design/design-brief.md,docs/03-design/tokens.json` |
| 04 architecture | G4 | `gate G4 --evidence docs/04-architecture/threat-model.md,…` |
| FZ freeze | — | `phase done FZ` (hashes `SPEC.md`) |
| 05 tests | G5 | `gate G5 --builtin trace:freeze,trace:check,unit` |
| 06 build | — | per slice: `tripwire.mjs`, then `phase done 06` |
| 07 QA | G7 | `gate G7 --builtin types,lint,unit,build` |
| 08 red team | — | `phase done 08` (entrypoints + coverage + findings) |
| 09 patch | G9 | `gate G9 --builtin findings,coverage` |
| 10 release | G10 | `report`, then `gate G10 --builtin ledger,progress` |
| 11 deploy | G11 | `gate G11 --not-verified --reason … --human-command …` |
| 12 eval | G12 | `gate G12 --builtin metrics` |

## 3 · When something cannot be evaluated

The framework fails closed. Record it and leave a way out:

```bash
node pipeline/bin/pipeline.mjs gate G11 --not-verified \
  --reason "no staging target is available in this environment" \
  --human-command "curl -sI https://staging.example/.well-known/build-id"
```

`validate-progress.mjs` rejects a `NOT_VERIFIED` gate that has no reason or no human
command. That is deliberate: "unverified" must still be actionable.

## 4 · When a defect will not die

Three repair attempts, then a blocker with a fallback:

```bash
node pipeline/bin/pipeline.mjs blocker add --phase 06 \
  --text "the queue test deadlocks under Promise.all x50" \
  --fallback "serialise the writes and record the throughput hit as a limitation"
```

## 5 · Proving the record is honest

```bash
node pipeline/bin/pipeline.mjs verify        # re-runs every recorded gate, named DRIFT if any disagree
node pipeline/bin/pipeline.mjs status        # ledger chain + gate table + missing context manifests
node pipeline/tools/gate-ledger.mjs verify --path docs/gate-ledger.jsonl
```

## 6 · Finishing

```bash
node pipeline/bin/pipeline.mjs estimate --a 6 --b 5 --m 4 --write
node pipeline/bin/pipeline.mjs report
```

`report` writes `docs/FINAL-REPORT.md` from the ledger, including the NOT_VERIFIED list and
the calibration caveat. Fill in the narrative; do not edit the gate table.

## 7 · The worked example

```bash
node pipeline/tools/demo.mjs          # copies examples/mini-app to a temp dir and walks 00 → 12
node pipeline/tools/demo.mjs --keep   # keep the temp dir to read the generated artifacts
```

Expected output ends with `RESULT: PASS — phases 00 → 12 completed, every gate recorded`.

## 8 · Configuration (`pipeline.config.json`)

| Key | Meaning |
|---|---|
| `spec`, `tests`, `baseline` | traceability inputs |
| `entrypoints`, `coverageLedger`, `findings` | red-team artifacts |
| `researchExtracts`, `researchSnapshots`, `quoteLog` | research verification |
| `commands.{types,lint,unit,build,e2e,a11y,mutation,sast,secrets,deps,dast}` | the product's own toolchain; swap freely |
| `tripwire[]` | per-slice check list (default in `tripwire.mjs`) |
| `protectedPaths[]` | `{glob, allowNew, orchestratorOwned, why}` |
| `fetchQuotes` | allow `quote-verify.mjs` to hit the network |

## 9 · Known limits of this implementation

- **`quote-verify` needs network for real URLs.** In a sandbox without egress, use `file:` extracts or accept `page-unreachable`, which is reported separately from a wrong quote.
- **`protected-paths` needs git.** Without a repository it exits 3 (`NOT_VERIFIED`), never 0.
- **Scanners are not bundled.** `tripwire` and the `08` floor run Semgrep, gitleaks, osv-scanner, Stryker, ZAP and Schemathesis if you have them. If you do not, they are `NOT_VERIFIED` with the command a human must run — never silently skipped.
- **`trace-check-v2` is regex, not an AST.** `expect(x).toBeDefined()` everywhere still counts. Mutation testing is the answer, which is why the tripwire runs it.
- **The orchestrator is a state machine, not an agent.** It cannot dispatch sub-agents. Prompt `v2-99` tells the driving model how to do that around the CLI.
