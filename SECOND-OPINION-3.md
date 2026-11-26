# SECOND-OPINION-3 — Did P0–P6 close the defects, or relocate the theatre?

Target: `knarayanareddy/sdlc-framework` @ `b7fc97d`, `pipeline/VERSION` = `2.7.0`.
Reviewer environment: Node v20.20.2, Linux, uid 1001, no docker, no `unshare -n`, no scanners, no network to any model.

---

## 1 · Verdict

**P0–P6 relocated the theatre. They did not close it.** The rule is "a gate is a command result, not an opinion", and on 2.7.0 the orchestrator will still record a green gate on the strength of an opinion the caller typed. This holds for nine of the twelve gates, the human gate `G11` among them, and `pipeline verify` then certifies the result as "no drift".

The single strongest piece of evidence is one loop, run on a fresh project:

```
$ head -c 100 /dev/zero | tr '\0' a > docs/x/junk.md
$ for g in G3 G4 G5 G7 G8 G9 G10 G11 G12; do pipeline gate $g --evidence docs/x/junk.md; done
gate G3 … G12 --evidence junk => exit 0      (nine times)
$ pipeline verify
  G3 … G12  recorded=passed now=pass match (evidence present)
no drift across 9 re-run gate(s)             exit 0
```

The author's §7 `B-22` says G4 can still be satisfied by `--evidence`. That is the smallest instance of the defect. The defect is the `--evidence` branch itself (`bin/pipeline.mjs:703`). It is not restricted to the gates that are meant to be judgement gates, and nothing re-checks it.

A second hole sits next to it. `--allow-commands <file>` (`bin/pipeline.mjs:262`) lets the caller choose which file counts as the human allowlist. P0's headline fix, "an agent-supplied `--cmd` is refused unless a human allowlisted it", therefore stops only a caller who doesn't read the flags.

The first command in the task also fails on a stock clone. In `/tmp`, `run-selftests.mjs` reports **226/227** and `demo.mjs` ends `RESULT: FAIL`. Under `$HOME` both pass. The cause is a real hole, not flakiness (G-10): `quote-verify` treats all of `os.tmpdir()` as a trusted place to read "pages" from, so a builder-written file counts as a fetched source.

What is real, and should not be thrown away:

- The hash chain detects an edited line (`gate-ledger.mjs demo` → PASS).
- Tail truncation is caught against `progress.json`.
- Exit 3 is propagated correctly by `gate`.
- `plan-check`, the scope flags and `live-check probe` do fail closed on the *absent-input* cases they were written for.
- The calibration refusals (DIFF round, tracked answer file) work.

Every one of those protects against **accident or a naive edit**. Each integrity anchor that matters against a motivated builder is a file in the builder's own working tree: `progress.json` (its `command` and `baseCommit` fields), `pipeline.config.json`, the allowlist, `calibration.json`, `baseline.json`. The tools read those files as if they were trusted. Until trust anchors are read from the base commit (`git show <base>:path`) or from outside the tree, each new check is something the next flag, or the next `rm`, walks around.

---

## 2 · Scorecard

| Area | Grade | One line |
|---|---|---|
| Orchestrator | **BROKEN** | `--evidence` greens any gate (G-01); caller-chosen allowlist (G-02); unrecorded `--force` (G-04); human gates not enforced (G-22). |
| Ledger | **WEAK** | Edit and truncation detection work (`gate-ledger.mjs demo`; `ledger.mjs:172-181`). The cross-check compares `status` only, and `verify` runs the command from mutable `progress.json` (G-03). |
| Traceability | **BROKEN** | A test file with only commented-out assertions gives 5/5 coverage (G-07). Deleting `baseline.json` makes `gate G5` re-freeze the weakened tests and pass (G-08). |
| Red-team evidence rules | **WEAK** | `validate-findings` and `coverage-gate` were not audited line by line. The round counter is structurally capped at 2 (G-13). |
| Verifier independence | **BROKEN** | The report's "outside anthropic" line comes from a typed `--model` (G-05). `verifier-route check` accepts a hand-forged verdict (G-06). |
| Sandbox | **WEAK** | `run` is honest about what it applied. `verify` is a text lint, and `--require-all` doesn't require network denial (G-18). |
| DAST / fuzz | **BROKEN** | The `dast` builtin is a different, non-existent npm package. A stale artifact counts as "ran". `--target` is shell-injectable (G-16, G-17). `fuzz-api` not audited. |
| Calibration | **WEAK** | The scoring arithmetic and refusals are sound. `status` trusts a hand-written `calibration.json`, and paths collide across a monorepo (G-14). |
| Plan / substance gates | **BROKEN** | An empty `entrypoints.json` passes as "0/0 routes covered" (G-12). Substring matching (B-23). Prose delivers slices. |
| Metrics / reporting | **WEAK** | Computed from the ledger without verifying the ledger. G12 passes on any content (G-15). The report's independence line is unearned (G-05). |
| Live harness | **WEAK** | `probe` prints `READY` from env-var strings and empty stubs (G-19). Otherwise honest: 0/4 on a bare host, exit 3. |
| Schemas | **WEAK** | Agreement is test-only. No schema is enforced at runtime (§4 row 7). |
| Prompts | **WEAK** | Tool names resolve (all flags in `v2-*` resolve). `v2-06` still describes a phase with no REQ-citing exit check. `v2-08` says `run-N` where every builtin reads `run-1`. |
| Docs | **WEAK** | `P6-LIVE.md:119` fails as written. `P6-LIVE.md:120` can never pass (G-16). Version and count drift (G-23). |
| CI | **WEAK** | The traceability step uses `--allow-uncovered`. It never runs `verify` or `live-check`. It only runs on Node 22 from `/home/runner/work`, which hides G-10 (G-24). |
| Portability | **BROKEN** | The first command fails on a checkout under `os.tmpdir()` (G-11). |
| Security of the tools | **WEAK** | `shell: true` is by design (B-35). The shell-injectable `--target` and the tmpdir trust are not documented. |

---

## 3 · Verification log

Environment: clone at `/tmp/sdlc-framework`, plus a copy at `$HOME/w/sdlc-framework` (not under tmpdir). Scratch projects under `$HOME/w/*`.

| # | Command / experiment | Outcome |
|---|---|---|
| 1 | `git log --oneline -1; cat pipeline/VERSION` | `b7fc97d`, `2.7.0` ✔ |
| 2 | `node pipeline/tools/run-selftests.mjs` in `/tmp` clone | **FAIL: 226/227**. `quote-verify.test.mjs:148` "a file: source outside the research dir and the temp dir is refused". Got `not-found`, not the refusal. |
| 3 | same, from `$HOME/w` copy | `2/2 test groups pass`, `RESULT: PASS` ✔ |
| 4 | `node pipeline/tools/demo.mjs` in `/tmp` clone | **`RESULT: FAIL`** at `gate G0 --builtin ledger,selftests` (same cause as #2) |
| 5 | `demo.mjs` from `$HOME/w` copy | PASS, phases 00→12, 28 ledger entries, `verify` "12 gate(s) cross-checked", every re-run gate shown matches, report says "every judged gate (G7, G9) was verified by a model outside anthropic" (see G-05) |
| 6 | `live-check.mjs probe` | `0/4`, exit 3, `docs/13-live/live-readiness.json` written ✔ (it writes into the cwd; I deleted it from the clone) |
| 7 | `gate-ledger.mjs demo` | `RESULT: PASS - a single edited line breaks the chain` ✔ |
| 8 | `gate G3…G12 --evidence <100-byte file>`, then `verify` | **9/9 exit 0; `verify`: "no drift"** (G-01) |
| 9 | `gate G7 --cmd true --allow-commands /tmp/al.json` (file contains sha256 of `true`) | **PASSED**. Without the flag: NOT_VERIFIED exit 3. (G-02) |
| 10 | `gate G7 --builtin manual,unit` | Passed on `unit` alone (B-29 reproduced) |
| 11 | edit `progress.gates.G7.command` to `true`, then `verify` | `ledger: chain intact` · `G7 match (exit 0)` · `no drift` (G-03) |
| 12 | `phase start 12 --force`; `phase done 12 --force` on an empty project | Ledger row `P12 passed exit 0`. No gates recorded. `FINAL-REPORT.md`: 12× "not evaluated" and "NOT_VERIFIED: 0". `validate-progress`: PASS (G-04) |
| 13 | `plan-check` with a matrix naming `GET /api/items/:id` only | `GET /api/items` passes (B-23 reproduced). Slice log "REQ-001 was dropped from scope…" delivers 3/3 ids |
| 14 | `plan-check` with `entrypoints.json = {"entrypoints":[]}` | `authz 0/0 routes covered` → **PASS** (G-12). Deleting the file → FAIL on the spec table |
| 15 | `rounds.mjs` fed FULL for 08, 09, 08, 09, 08, 08 | `full` stays **2** (G-13) |
| 16 | `metrics-compute` after editing a ledger line, and after appending `garbage` | exit 0, "computed from a named file". The garbage line is dropped silently (G-15) |
| 17 | `trace-check-v2` on a test file with only `// expect(1).toBe(2)` and an empty `test()` | **5/5 covered, PASS** (G-07) |
| 18 | one `assert.ok(1)` in a file tagged with all 5 ids | 5/5 covered (B-30 reproduced) |
| 19 | `trace-check-v2 … --scope tests` | `PASS (scoped…; tag hygiene only…)`, **exit 0** (G-20) |
| 20 | `entrypoints.mjs` on an Express + `pages/api` + `app/api/build/route.ts` fixture | Only `env:*` and the one non-`build` route are found. No Express routes, no `pages/api`, and `app/api/build` is skipped (G-12) |
| 21 | `entrypoints … --changed-since HEAD --scope pages` | Ignores `--changed-since`, returns an unchanged file's entry, label says otherwise, exit 0 (G-20) |
| 22 | new untracked `route.ts` + `--changed-since HEAD` | "selected no files" exit 3, or silently omitted if any tracked file changed (G-20) |
| 23 | `sandbox.mjs run --cmd "echo hi" --require-all` | **Ran, exit 0**, "4 control(s) applied", network not denied (G-18) |
| 24 | `sandbox.mjs verify` on a compose file with `cap_add: SYS_ADMIN`, `seccomp=unconfined`, `pid: host`, `/:/host` bind, `/dev/mem` | **`RESULT: PASS`** (G-18) |
| 25 | hand-written `calibration/calibration.json {"calibrated":true,…}` → `calibrate status` | `calibrated for 2.7.0 — recall 100.0%`, exit 0 (G-14) |
| 26 | `calibrate score` with planted bugs in `packages/a/src/…` and findings in `packages/b/src/…` | `RESULT: CALIBRATED` (G-14) |
| 27 | `live-check probe` with exit-0 stub `docker`/`nuclei`/`schemathesis` and three env vars | `READY verifier`, `READY sandbox`, `READY scanners` (G-19) |
| 28 | `verifier-route route …` then hand-written verdict with `model: gpt-5` | **`verdict accepted — confirmed: 1`**, exit 0 (G-06) |
| 29 | `protected-paths` with `{"protectedPaths":[]}` committed | `protected rules: 0`, **PASS** after tests were gutted (G-09) |
| 30 | `protected-paths` after resetting `progress.baseCommit` to HEAD | committed test edits invisible, PASS (G-09) |
| 31 | `dast.mjs run` with a stale `nuclei.jsonl` and a stub `nuclei` that exits 1 with no output | `ran nuclei 1 lead(s)` · `RESULT: RAN` exit 0 (G-17) |
| 32 | `dast.mjs run --target 'http://127.0.0.1:9; echo INJECTED > pwned.txt'` | `pwned.txt` created (G-17) |
| 33 | `npm view @zaproxy/zap-cli` | **E404**. The default `dast` builtin cannot run (G-16) |
| 34 | `tripwire.mjs` with `{"tripwire":[]}` | `checks: 0` · `RESULT: PASS` (G-21) |
| 35 | `quote-verify` with `file:/tmp/builder-wrote-this.txt` | `verified: 1`, `RESULT: PASS` (G-10) |
| 36 | G5: honest pass → gut the tests → `gate G5`; then `rm docs/05-test/baseline.json` → `gate G5` again | First run FAILS (good). Second run **PASSED** (G-08) |
| 37 | `node /tmp/doccheck.mjs` (my script: every `node pipeline/…` line in README, RUNBOOK, INTEGRATIONS, P6-LIVE and all `v2-*` prompts → tool exists and flag has a handler) | One failure: `P6-LIVE.md:119` `dast.mjs leads --file` (real flag `--from`; ran it: `error: no scanner output at ""`, exit 1) |
| 38 | `grep jsonschema` over non-test sources | `lib/jsonschema.mjs` is imported only by tests (§4 row 7) |
| 39 | `ls tools/*.mjs` (non-test) / `*.test.mjs` / `*.selftest.mjs` | 22 / 23 / 1. The "23 tools" in the task is 22. |

**Could not run, and why**

- **`live-check verify --run` (B-24).** No docker, nuclei or model. I did not read that code path, so B-24 is neither confirmed nor refuted.
- **Any real model transport, container, scanner or calibration.** None available. Everything about their real behaviour is `NOT_VERIFIABLE` (Appendix).
- **Node 22 / GitHub Actions.** I ran Node 20.20.2. CI is not observable from here.
- **`B-27`, `B-28`, `B-31`, `B-32`, `B-33`, `B-35`.** Accepted from the code paths and the author's description. I did not independently reproduce them.
- **`fuzz-api.mjs` false-negative behaviour, `validate-findings` evidence tiers, `coverage-gate` internals.** Not audited. "I found nothing" for these is a statement about my effort.

---

## 4 · Did the fix fix it?

| # | Claim | The test meant to prove it | Verdict | What decides it |
|---|---|---|---|---|
| 1 | `plan-check` uses the source, not the prose | `plan-check.test.mjs` | **moved** | `plan-check.mjs:60-62` returns `[]` for an empty list, and `:108` is `fromEntries ?? exposedFromSpec`. `[]` is not nullish, so an empty or stale `entrypoints.json` replaces the spec table and the check passes 0/0 (#14). The enumerator knows Next.js app-router only (#20). Its output is an agent-writable JSON file. The ground truth is now a regex over one framework. |
| 2 | Slices must deliver requirements | `plan-check.test.mjs` | **not closed** | `plan-check.mjs` counts an id appearing anywhere in a slice file. "REQ-001 was dropped from scope" delivers it (#13). Disclosed as B-23. |
| 3 | Scope is honest about being partial | `entrypoints/coverage-gate/trace-check-v2` tests | **partially closed** | Single flags print `SCOPED` and a scope that selects nothing exits 3. A combined `--changed-since X --scope Y` ignores `X` (`scope.mjs:43` returns a prefix predicate) and `scopeFail` can't fire on an array (`.size` is undefined). A scoped trace run exits **0** (#19), so the exit code can't tell the orchestrator it is partial. `git diff` omits untracked files (#22). |
| 4 | `metrics.json` is computed, not written | `pipeline.test.mjs` "gate G12 computes metrics…" | **partially closed** | `--builtin metrics` does overwrite a hand-written file. But `gate G12 --evidence docs/12-eval/metrics.json` passes with it (G-01). `metrics-compute.mjs` never calls `verifyLedger`, so it computes "from a named file" off a tampered ledger and silently drops corrupt lines (#16). `computed: true` is self-asserted; `writeReport` (`pipeline.mjs:~445`) checks only `m.computed === true && m.derivedFrom`, never re-hashes (B-26). |
| 5 | The round counter is real | `rounds.test.mjs`, `validate-progress.test.mjs` | **not closed** | `rounds.mjs:8` limits rounds to phases 08 and 09, and `:25` replaces the same phase's entry. `rounds.full` can never exceed 2 (#15), so the "at most 3 FULL rounds" stop rule can never fire. `mode` is whatever the red team writes in `findings.json`. The prompt says `run-N`, but every builtin reads `run-1`. |
| 6 | The report cannot be stale | `pipeline.test.mjs` "phase 12 rewrites FINAL-REPORT.md…" | **not closed** | `writeReport()` is called at `pipeline.mjs:931` (phases 10/11/12 only) and `:983` (explicit). Any later gate leaves it stale (B-27). The report also makes unearned claims: its independence line comes from a typed flag (G-05), and "Not verified: None recorded" is printed when all 12 gates are unevaluated (#12). |
| 7 | Schemas and validators now agree | `schemas.test.mjs` | **not closed** (test-only) | `lib/jsonschema.mjs` is imported only by tests (#38). No tool validates its input or output against `pipeline/schemas/*.json` at runtime. The agreement is a property of CI, not of a run. |
| 8 | Readiness is asked, not assumed | `live-check.test.mjs` | **partially closed** | `docker info` and `--version` are asked under `verify --run`. `probe` alone prints `READY` for three of four items from env-var strings and exit-0 stubs (#27). The verifier item runs nothing at all. |
| 9 | Fail-closed has no exceptions | per-tool tests | **not closed** | Where a `NOT_VERIFIED` becomes something better: `phase done` accepts a `NOT_VERIFIED` gate and finishes exit 0 (demo ends `RESULT: PASS` with G11 NOT_VERIFIED). `--force` turns any failed check into `P<id> passed`. `tripwire: []`, `protectedPaths: []`, an empty `entrypoints` list and an empty-but-parseable `calibration.json` all turn "checked nothing" into green (G-09, G-12, G-14, G-21). |

---

## 5 · Findings

Each finding is marked **DISCLOSED** (in §7 of the task) or **UNDISCLOSED**. "Test" is the regression test that would have caught it. Every reproduction passed against the existing suite, so no existing test asserts the contrary.

### G-01 · critical · UNDISCLOSED (B-22 is the smallest instance) — `--evidence` is a green button for every gate, including G11
`bin/pipeline.mjs:703-712`. The branch `cmds.length === 0 && evidence` runs for any `<gate>`. It checks only `substantialFile()` (≥64 bytes) and records `status: passed, exitCode: 0`. `verify` re-checks the same size test (`:819`) and prints `match`. `validate-progress` accepts "command or evidence files".
**Repro:** §3 #8. 9/9 gates green on 100 bytes of `a`, then `no drift across 9 re-run gate(s)`.
**Expected:** `--evidence` is valid only for the gates declared as judgement gates (G3), and never for G8/G9/G11/G12.
**Actual:** G5, G7, G8, G9, G10, G11 and G12 can be green with no command run.
**Smallest fix:** add `const EVIDENCE_GATES = new Set(["G3"])` to `gates.mjs`. In the `--evidence` branch, `fail(...)` with exit 1 for any other gate. In `validate-progress`, reject `commandSource: "evidence"` outside that set.
**Test:** `for each gate not in EVIDENCE_GATES: gate <g> --evidence README.md` → non-zero, and `progress.gates[g]` absent or not `passed`. `pipeline.test.mjs:160-161` currently asserts the opposite for G4.

### G-02 · critical · UNDISCLOSED — the caller picks the allowlist
`bin/pipeline.mjs:262`: `abs(flags["allow-commands"] ?? ALLOWLIST)`. The "human allowlist" is a file chosen by the same flag line that supplies `--cmd`.
**Repro:** §3 #9. Hash `true` into `/tmp/al.json`, run `gate G7 --cmd true --allow-commands /tmp/al.json` → `G7 PASSED`.
**Expected:** `--cmd` is refused unless the *committed* `docs/00-control/allowed-commands.json` has its hash.
**Actual:** self-certification with one extra flag. README line 11 states the opposite.
**Smallest fix:** delete the `--allow-commands` flag. Read the allowlist with `git show <progress.baseCommit>:docs/00-control/allowed-commands.json`, falling back to refusal when there is no git repo.
**Test:** `gate G7 --cmd true --allow-commands <file containing its hash>` → exit 3 and `commandSource: "refused-agent-command"`. No current test mentions `allow-commands`.

### G-03 · high · UNDISCLOSED — `verify` re-runs whatever `progress.json` says
`pipeline.mjs:815` runs `g.command` from `progress.json`. `ledger.mjs:172-181` cross-checks `status` only, not `command`.
**Repro:** §3 #11. Replacing `G7.command` with `true` yields `match (exit 0)`. The ledger still says `echo ran-unit-only`.
**Expected:** `verify` re-runs the command that was *recorded in the ledger*, and a `progress.json`/ledger command mismatch is a ledger failure.
**Smallest fix:** in `verifyLedger`, compare `g.command` and `commandSource` with `last.get(gate)`. In `verify`, take the command from the ledger entry.
**Test:** edit `progress.gates.G7.command` → `pipeline verify` exits 1 with "progress.json says … the ledger says …".

### G-04 · high · B-21 DISCLOSED; the wider effect UNDISCLOSED — `--force` leaves no trace, on both `start` and `done`
`pipeline.mjs:860` (`phase start --force`) and `:903` (`phase done --force`). `start --force` writes no ledger row at all. `done --force` writes `P<id> passed, exitCode 0` and drops the problem list.
**Repro:** §3 #12. On an empty project: `phase start 12 --force && phase done 12 --force` writes a ledger row `P12 passed`. The report then shows 12× "not evaluated" and "Not verified: None recorded". `validate-progress` says PASS.
**Expected:** a forced completion is `status: "forced"` and lists the failed checks. `start --force` is ledgered. The report and `validate-progress` refuse to show a forced phase as clean. The message promises "record why in docs/blockers.md", but nothing checks that it happened.
**Smallest fix:** add `forced: true, overridden: [...problems]` to the ledger entry and the phase record (add the two fields to `LEDGER_FIELDS`). Report them in a "Forced" section. Make `validate-progress` fail on forced phases at G10.
**Test:** `phase done X --force` with a failing check → ledger last entry has `forced: true` and the problem text; report contains "Forced".

### G-05 · high · UNDISCLOSED (B-31 covers only `builderFamily`) — "verified by a model outside anthropic" is a typed flag
`pipeline.mjs:422-430` builds the independence line from `modelFamily`, which `recordGate` copies from `--model`. `demo.mjs:96,104` runs `gate G7 --builtin unit --model gpt-5` and `gate G9 … --model gemini-2.5-pro`. No model is called. The demo's header says "Nothing is faked about the gates", and its final report states: "every judged gate (G7, G9) was verified by a model outside anthropic".
**Expected:** a verifier claim in the report is backed by an accepted `verifier-route check` result bound to the gate (envelope hash in the ledger row), or it says "declared, unproven".
**Smallest fix:** record `verdictSha256` from `verifier-route` in the ledger entry (new field). `writeReport` and `independence.mjs` count only rows that carry it. Otherwise print `declared by flag, not evidenced`.
**Test:** `gate G9 --builtin unit --model gpt-5` followed by `report` must NOT contain "was verified by a model outside".

### G-06 · high · UNDISCLOSED — `verifier-route check` accepts a forged verdict
`verifier-route.mjs:328-395`. It validates shape, hash echo and citation line-ranges. It never establishes that a model produced the file. The builder routes the envelope (it holds the hash) and writes the verdict.
**Repro:** §3 #28.
**Expected:** `dispatch` is the only producer of an accepted verdict, and `dispatch` stamps `dispatchedAt`, the transport command and a response digest into the ledger. `check` on a file `dispatch` did not write is NOT_VERIFIED.
**Smallest fix:** make `dispatch` write `<out>.attest` (sha256 of verdict + envelopeHash + transport command + time) and have `check` require it, with the digest copied into the ledger row (the same field as G-05). State plainly that the attestation proves the transport ran, not which model answered.
**Test:** hand-written verdict without `.attest` → exit 3.

### G-07 · high · UNDISCLOSED — assertions are counted inside comments and strings
`trace-check-v2.mjs:102,122`. `ASSERT` is a regex over the whole file text. Only literal tautologies are subtracted.
**Repro:** §3 #17. A file whose body is `// @req REQ-001 … NFR-001`, `// expect(1).toBe(2)`, `/* assert(true) */`, and `test('nothing', () => {})` → `requirements: 5 covered: 5 PASS`. `trace:check` (G5) gates on exactly this.
**Expected:** a requirement is covered only by an assertion in executable code of a test case.
**Smallest fix:** strip `//…` and `/*…*/` comments and string literals before counting (a 15-line scanner, no dependency). Attribute asserts to the enclosing `test(`/`it(` block, so tags attach to cases that contain one (this also narrows B-30).
**Test:** the §3 #17 fixture must exit 1 with "contains 0 real assertions".

### G-08 · high · UNDISCLOSED — deleting `baseline.json` re-freezes the weakened tests
`pipeline.mjs:~706` (G5 path): "baseline missing: freezing it first". That runs `trace:freeze`, which writes the baseline from the *current* tests.
**Repro:** §3 #36. Gut the tests: `gate G5` FAILS (good). `rm docs/05-test/baseline.json`, re-run: **PASSED**, command recorded as `trace-check-v2 … --allow-uncovered --baseline …`.
**Expected:** once phase 05 is done, a missing baseline is an error, not a prompt to create one.
**Smallest fix:** freeze only while `progress.phases["05"]?.status !== "done"`. Otherwise fail with "baseline missing after phase 05".
**Test:** after `phase done 05`, `rm baseline.json; gate G5 --builtin trace:check` → exit 1.

### G-09 · high · B-34 DISCLOSED (the `--strict` part); the rest UNDISCLOSED — protected-paths is a phase-00 check, and its own trust inputs are agent-writable
- `gates.mjs`: `protected` appears only in phase 00's `doneChecks`. No later phase or suggested gate runs it, and `tripwire` is in no phase at all. The comment at `gates.mjs:5` says 06's tripwire "is enforced by the phase `done` checks". It is not.
- `protected-paths.mjs:43`: `config.protectedPaths ?? DEFAULT_PROTECTED`. The config is itself agent-writable. `{"protectedPaths": []}` gives `protected rules: 0` → **PASS**, even though `tests/` and `pipeline.config.json` changed (§3 #29).
- `protected-paths.mjs:21`: the diff base is `progress.baseCommit`, a field in the agent-writable `progress.json`. Resetting it to HEAD hides every earlier committed edit (§3 #30), and the `progress.json` change is a warning without `--strict`.
- `docs/00-control/protected-paths.txt` is written by `init` (`pipeline.mjs:569`) and read by nothing.

**Expected:** a tool that checks "no protected path changed" fails closed when it has zero rules, and takes its rules and base from a source the builder can't edit.
**Smallest fix:** zero rules → exit 3. Read rules and base from the base commit blob. Add `protected` to the doneChecks of 06, 09 and 10 and to G10's suggestion, with `--strict`.
**Test:** the three repros above each exit non-zero. `phase done 10` runs `protected --strict`.

### G-10 · high · UNDISCLOSED — `quote-verify` trusts `os.tmpdir()` as a source of "pages"
`quote-verify.mjs:50`: `allowed = [docs/01-research, os.tmpdir()]`. The comment above says it exists because "the builder could otherwise write the page it quotes and vouch for itself". The builder can write `/tmp/x`.
**Repro:** §3 #35. `file:/tmp/builder-wrote-this.txt` → `verified: 1 … snapshot … (fetched)`, `RESULT: PASS`.
**Expected:** `file:` sources are limited to the snapshot directory; the tool's own self-tests use a fixture directory inside the repo.
**Smallest fix:** drop `os.tmpdir()` from `allowed`. Point `quote-verify.test.mjs` at `tools/fixtures/`.
**Test:** `file:/tmp/<anything>` → `page-unreachable`, exit 1.

### G-11 · high · UNDISCLOSED — the first command of the task fails on a checkout under the temp dir
Same root cause as G-10. `quote-verify.test.mjs:148` assumes the repo is *not* under `os.tmpdir()`. A clone in `/tmp` gives 226/227 and `demo.mjs` fails at G0 because `run-selftests.mjs` is its first gate (§3 #2, #4). CI checks out under `/home/runner/work`, so green CI never sees this.
**Smallest fix:** as G-10. Also let `demo.mjs` fail with its own diagnosis ("self-tests failed: <file>") instead of replaying 20 lines of TAP output.
**Test:** run the suite from a clone under `os.tmpdir()` in CI (one extra job step with `git clone … "$RUNNER_TEMP/x"`).

### G-12 · high · B-23 DISCLOSED (substring); the rest UNDISCLOSED — plan-check's "source" is a Next.js regex, and an empty list beats the spec
- `plan-check.mjs:60-62,108`: an empty entrypoints list (or a stale file) replaces the spec's API table. `0/0 routes covered` → PASS (§3 #14). P1's own principle ("zero entry points is NOT_VERIFIED") is applied in `entrypoints.mjs` and missed here.
- `entrypoints.mjs:61-120`: it recognises Next app-router `route.*`, `page.*`, middleware and `"use server"`. It does not see Express/Fastify/Hono (`app.get(...)`), `pages/api/*`, or non-Node backends. `process.env.X` is counted as an entry point, so an Express app never reaches the "0 entry points" refusal (§3 #20).
- `common.mjs:walk` skips directories named `build`, `out`, `dist`, `coverage` at any depth, so `app/api/build/route.ts` (route `/api/build`) is never enumerated.
- `entrypoints.mjs` excludes any top-level directory named `pipeline` from the app.
- `plan-check.mjs:117`: `matrix.includes(label)` (B-23): `GET /api/items` passes on `GET /api/items/:id`.

**Smallest fix:** treat an empty list as `NOT_VERIFIED`. Union the entrypoints routes with the spec table instead of `??`. Match matrix rows by parsing `| METHOD | path |` cells. Add Express/`pages/api` patterns, or print the frameworks recognised and exit 3 when none matched. Give `walk` a `skip` override for route directories (only skip the names when they contain no `route.*`).
**Test:** the four fixtures from §3 #13, #14, #20.

### G-13 · high · UNDISCLOSED — the "round counter" cannot count past 2, so the stop rule is unreachable
`rounds.mjs:8` (`ROUND_PHASES = ["08","09"]`) and `:25` (replace same phase). `validate-progress.mjs` fails at `rounds.full > 3`, a state the orchestrator can no longer produce. `rounds.test.mjs:59` is titled "a fourth FULL round is visible to validate-progress, so the stop rule can fire", but it hand-edits `roundLog`. Its own comment says "Two more FULL rounds would need more phases, so simulate". The prompt says rounds write to `run-N`; every builtin reads `run-1`.
**Repro:** §3 #15.
**Expected:** each red-team round is an entry. The stop rule at 3 FULL rounds can fire. `mode` is checked against evidence (a FULL round must cover every entrypoint in its `coverage-ledger`, which `coverage-gate` already computes).
**Smallest fix:** key `roundLog` by `{phase, runDir}` (or an appended sequence number), take the run directory from a `--run` flag recorded in progress, and set `mode` to FULL only when `coverage-gate` passes with no scope.
**Test:** three sequential `phase done 08` calls with distinct run dirs and FULL findings → `rounds.full === 3`, and a fourth is refused.

### G-14 · high · UNDISCLOSED — calibration status is a file, and path normalisation collides in monorepos
`calibrate.mjs:272-290` (`status`): reads `calibration.json` and compares only `pipelineVersion`. It is not bound to the plan, answer or findings that supposedly produced it. G12's `--builtin calibrate` is this command. `calibrate.mjs:92` (`normalisePath`) strips everything before the first `src/ | app/ | lib/ | tests/`, so `packages/a/src/h.ts` equals `packages/b/src/h.ts`.
**Repro:** §3 #25 (hand-written file → "calibrated … 100%") and #26 (wrong-package findings → CALIBRATED).
**Smallest fix:** have `score` write `planSha256`, `answerSha256`, `findingsSha256`, and have `status` recompute and compare them (the files are still on disk). Make `normalisePath` strip only a leading `./` and the repo root.
**Test:** edit `calibration.json` by hand → `status` exits 3.
Note: P6-LIVE's "calibration flips G12" is only as strong as this file.

### G-15 · high · B-26/B-28 DISCLOSED; the rest UNDISCLOSED — G12 passes on any content, and the numbers come from an unverified ledger
- `pipeline.mjs:~170` (`metrics` builtin) = `metrics-compute.mjs`, which exits 0 whenever the inputs exist. G12 is "Pipeline evaluation + calibration", and it passes with no calibration, a NOT_VERIFIED G11 and zero verified gates (the demo does exactly this).
- `metrics-compute.mjs:36-45` parses the ledger line by line and drops anything that doesn't parse (`.filter(Boolean)`). It never calls `verifyLedger`. The header's claim that the ledger "cannot be faked ... because `gate-ledger verify` already checks its chain" is untrue of this tool (§3 #16).

**Smallest fix:** call `verifyLedger` first and exit 1 on a broken chain. Exit 3 when `calibration.run === false` or a gate in `notVerifiedList` is a required gate. `requirements: 0` is NOT_VERIFIED (B-28).
**Test:** a ledger with an edited line or an appended garbage line → `metrics-compute` exits non-zero.

### G-16 · high · UNDISCLOSED — the `dast` builtin is not `dast.mjs`, and P6 says it is
`pipeline.mjs:87,154`: `dast` → `commands.dast` = `npx @zaproxy/zap-cli quick-scan --self-contained`. That package returns **E404** on npm (§3 #33), and the command has no target. `P6-LIVE.md:120` and `live-check.mjs` both state "flips: `G8 --builtin dast`". `GATE_SUGGESTIONS.G8` doesn't include it either. `dast.mjs run` is wired into no gate.
**Expected:** installing scanners can change a gate's outcome, as stated.
**Smallest fix:** make `dast` resolve to `dast.mjs run --target … --require-all-tools`, with exit 3 unless every installed tool produced a fresh artifact. Add it to G8's suggestion.
**Test:** `gate G8 --builtin dast` with no scanners → exit 3 with a human command. With a stub `nuclei` that emits a fresh JSONL → exit 0.

### G-17 · medium · UNDISCLOSED — `dast.mjs run` counts stale files as "ran", and `--target` goes to a shell
- `dast.mjs:208` includes `tool.artifact` relative to the cwd as a candidate and never checks freshness. A stale `nuclei.jsonl` plus a `nuclei` that exits 1 → `ran nuclei 1 lead(s)`, `RESULT: RAN`, exit 0 (§3 #31).
- One tool of three producing output is `RESULT: RAN` exit 0 (§3 #31 shows 1/3).
- `dast.mjs:199`: `${target}` is interpolated unquoted into a `shell: true` command (§3 #32).

**Smallest fix:** `rmSync` the artifact before each run, or require `mtime >= start`. Exit 3 unless all *available* tools ran. Validate `--target` as a URL and pass argv instead of a shell string.
**Test:** the three fixtures above.

### G-18 · high · UNDISCLOSED — the sandbox gate lints text, and `--require-all` doesn't require all
- `sandbox.mjs:329-345` (`verify`, which is `G0 --builtin sandbox`): required lines are matched file-wide with `^\s*key:` regexes. `cap_add: SYS_ADMIN`, `seccomp=unconfined`, `pid: host`, a `/:/host` bind and `devices: /dev/mem` all pass (§3 #24). Bind mounts are writable by default, and only an explicit `:rw` is forbidden.
- `sandbox.mjs:179`: `--require-all` refuses only when a control is `"NOT_VERIFIED"`. Without `--deny-network` the control is `false`, not NOT_VERIFIED, so the command runs with network and exits 0, "4 control(s) applied" (§3 #23). `--cwd` (isolation off) does the same.

**Smallest fix:** parse per service and reject `cap_add`, `security_opt` values other than `no-new-privileges`, `pid|ipc|userns_mode: host`, `devices`, and any volume without `:ro`. Under `--require-all`, treat `false` as a refusal for network, memory and workdir isolation.
**Test:** the §3 #24 file → exit 1. `run --require-all` without `--deny-network` → exit 3.

### G-19 · medium · B-25 DISCLOSED (scanners); verifier and sandbox UNDISCLOSED — `probe` says `READY` from strings and stubs
`live-check.mjs:~87-125`: the verifier item is READY when three strings are non-empty and in different families, and the transport command is never executed. The sandbox item is READY on a `docker` whose `info` prints a version. Scanners are READY on `command -v` (§3 #27). All three are cheap to satisfy without anything real behind them.
**Smallest fix:** `probe` caps at `PARTIAL` for anything it hasn't executed. `READY` is reserved for `verify --run` results.
**Test:** stubs from §3 #27 → no `READY` line from `probe`.

### G-20 · medium · UNDISCLOSED — scope flag defects
`scope.mjs:43` returns a prefix predicate when `--scope` is present, even if `--changed-since` was also given, but the label claims both (§3 #21). `scopeFail` checks `.size`, which is undefined on the array produced by the combined branch, so an empty combined scope isn't refused. `changedSince` uses `git diff --name-only`, which omits untracked files (§3 #22). A scoped `trace-check-v2` exits 0 (#19), so the orchestrator would record it as `passed`.
**Smallest fix:** intersect the two sets. Use `Array.length`. Add `git ls-files -o --exclude-standard`. Exit 3 for scoped coverage claims, and keep exit 0 only for an explicit `--hygiene-only`.
**Test:** `--changed-since HEAD --scope pages` with the only changed file under `src` → exit 3.

### G-21 · medium · UNDISCLOSED — more "checked nothing, so clean"
`tripwire.mjs:33`: `{"tripwire": []}` → `checks: 0 … RESULT: PASS` (§3 #34). The default `trace` check hard-codes `node pipeline/tools/trace-check-v2.mjs`, which only works when the pipeline lives at `./pipeline` in the project (it doesn't in `demo.mjs`).
**Smallest fix:** zero checks → exit 3. Resolve the tool relative to `import.meta.url`.
**Test:** empty config → exit 3.

### G-22 · medium · UNDISCLOSED — the human gates are not enforced anywhere
The constraint is "a human must stay at `H1` and `G11`". `gate G11 --evidence <file>` passes (§3 #8). `gate G11 --builtin e2e` passes if the agent-run command exits 0. `phase done 11` and `phase done 12` accept a `NOT_VERIFIED` G11, and the demo ends `RESULT: PASS`. `phase H1` has no gate at all; it needs a non-empty `DECISIONS.md`.
**Smallest fix:** a `HUMAN_GATES = {G11}` set. `gate G11` records `NOT_VERIFIED` unless `--attested-by <name>` and the environment variable `PIPELINE_HUMAN=1` are present, and the final phase exits 3 while any gate is NOT_VERIFIED. This is a convention, not a security boundary, because the builder shares the shell. It can make a bypass explicit and ledgered.
**Test:** `gate G11 --evidence README.md` → exit 3.

### G-23 · low · UNDISCLOSED — documentation drift
- `P6-LIVE.md:119`: `dast.mjs leads --file` fails (`--from`).
- `P6-LIVE.md:120`: `gate G8 --builtin dast` can't pass (G-16).
- `INTEGRATIONS.md:311` shows `NOT_VERIFIED … for pipeline 2.6.0`.
- "23 tools" is 22 in `pipeline/tools/` (23 test files and 1 selftest are correct).
- `ARTIFACTS.slices` (`pipeline.mjs:226`) hard-codes `docs/06-build/slice-*.md` while `plan:slices` uses `cfg.slicesGlob`, so a configured glob checks two different sets.
- `v2-06-build-slices.md` still says the exit check is "at least one slice log", although `phase done 06` now also needs every REQ/SEC/NFR id cited.
- `v2-08-redteam.md` says `run-N`; builtins read `run-1`.

**Test:** a `docs.test.mjs` that runs the extraction in `/tmp/doccheck.mjs` (tool exists, flag has a handler) over all four documents.

### G-24 · low · UNDISCLOSED (B-36 is the `live-check` part) — what CI runs
`pipeline.yml`: traceability on the example uses `--allow-uncovered`, the flag the repo says is never a coverage claim. Nothing runs `pipeline verify`, `live-check probe`, a mutation of the ledger via the CLI, or the suite from a path under tmpdir. The calibrate step ends with `|| true`. Only Node 22 is tested; the README gives no minimum.
**Test:** a step that runs `pipeline verify` on the demo project and fails on drift, plus `node --test` under Node 20.

### Disclosed findings I reproduced

| ID | Result |
|---|---|
| B-21 | Reproduced and widened (G-04). |
| B-22 | Reproduced and broadened to nine gates (G-01). |
| B-23 | Reproduced: `GET /api/items` passes on `/:id`; the slice sentence "REQ-001 was dropped from scope" delivers it; `SEC-001` mentioned in a "not modelled" sentence satisfies the threat check. |
| B-26 | Confirmed by grep: nothing re-hashes `derivedFrom`. |
| B-29 | Reproduced: `--builtin manual,unit` records `unit` only (`pipeline.mjs:690`). |
| B-30 | Reproduced (one `assert.ok(1)` covers five ids). |
| B-34 | Reproduced and extended (G-09). |
| B-35 | The trust boundary also covers `--target` (G-17) and `--cwd`/`--config` on the orchestrator. |
| B-24, B-27, B-28, B-31, B-32, B-33 | Not independently reproduced. B-31's verifier-side twin is G-05. |

---

## 6 · Test-theatre report

The method: each repro above passes against a green suite, so for each one **no current test asserts the opposite**.

| Test | What it claims | What it actually does | What a real test asserts |
|---|---|---|---|
| `pipeline.test.mjs:160-161` | tail truncation is caught | Uses `gate G3/G4 --evidence README.md → status 0` as *setup*. The bypass is the fixture. | `--evidence` on a non-judgement gate exits non-zero (G-01). |
| `pipeline.test.mjs` "gate G12 computes metrics…" | a hand-written metrics file can't pass G12 | Tests only `--builtin metrics` against a `computed:false` file. The `--evidence` route to the same file isn't tried. | `gate G12 --evidence docs/12-eval/metrics.json` fails. |
| *(absent)* | — | `grep` for `allow-commands`, `--force`, `manual,` in `pipeline.test.mjs` finds nothing. The three most direct "talk the gate into passing" routes have no test. | one test each (G-02, G-04, B-29). |
| `rounds.test.mjs:59` "…so the stop rule can fire" | the stop rule works | Builds a state the orchestrator can't produce (hand-pushes `roundLog`; the comment admits "simulate"). Proves `validate-progress` rejects it, not that a fourth round is reachable. Neighbouring test `:34` asserts the cap (replace, don't count). | Drive `phase done 08` three times with distinct run dirs and assert `rounds.full === 3` (G-13). |
| `quote-verify.test.mjs:148` | file: sources outside research/tmp are refused | Passes only if the repo isn't under `os.tmpdir()`. Fails on a `/tmp` clone (§3 #2). The comment states the builder-writes-the-page threat, then the allowlist admits `/tmp`. | `file:/tmp/<fixture>` is refused. |
| `schemas.test.mjs` | "schemas and validators agree" | True and honest, but test-only: nothing outside the test calls `lib/jsonschema.mjs`. The agreement can't fail a user's run. | A tool that validates its own input against its schema, with a test that feeds a violating file. |
| `live-check.test.mjs` | `PATH` stubs prove the probe fails closed | Right call for the negative cases (dead daemon, no binary). It never asserts that a *succeeding* stub is not `READY`, so exit-0 stubs yield `READY` (§3 #27). | Stubs that exit 0 with empty output → `PARTIAL`, never `READY`. |
| CI "traceability on the example spec" | traceability holds | Runs with `--allow-uncovered`, so it asserts structure only, and the example's 5 ids are covered anyway. | Same step without the flag, plus the comments-only fixture (G-07). |
| *(structural)* | "every bypass becomes a permanent regression test" | Rule 4 is satisfied for bypasses the author found. None of G-01…G-22 has a test, and each passes the suite. | See each finding's **Test** line. |

---

## 7 · Disagreements (design, not code)

1. **The root cause is where trust lives, not any single check.** The builder and the orchestrator share a working tree, a uid and a shell. `progress.json` (`command`, `baseCommit`, `rounds`), `pipeline.config.json` (`protectedPaths`, `commands`, `tripwire`), the allowlist, `baseline.json` and `calibration.json` are all inputs a check trusts and the builder can write. G-02, G-03, G-08, G-09 and G-14 are one defect repeated. A zero-dependency fix exists: read every trust anchor from `git show <baseCommit>:<path>`, where `baseCommit` is itself recorded in the ledger's genesis row. The ledger HMAC is the only out-of-tree secret, and nothing requires it at release (`--require-hmac` is opt-in). Make it mandatory in G10 or say the ledger is advisory.
2. **A pipeline that finishes with NOT_VERIFIED gates should not exit 0.** Rule 2 says "never converted into green", yet the final phase and the demo end `RESULT: PASS` with G11 NOT_VERIFIED, and `phase done` accepts it. Report it, but also exit 3 from `phase done 12` while any gate is NOT_VERIFIED.
3. **Calibration keyed to the exact `VERSION` string is a bigger hammer than the stated rule.** The repo's rule is that changing red-team prompts invalidates calibration. `calibrate.mjs:status` and `metrics-compute` compare the exact version string, so any bump, including a tools-only patch, makes it stale. Either hash `prompts/v2-08*`, `v2-09*` and `lib/bug-classes.mjs` into the calibration record, or accept that every fix below invalidates it. Since calibration has never been performed, this is currently moot.
4. **`verify` re-running builtins that write files** (`metrics`, `entrypoints`, `quotes`) means a re-run refreshes artifacts instead of testing them. `verify` should run in a read-only mode (`--check`) and compare.

---

## 8 · The next three fixes

Version rule applied: tools-only changes don't touch red-team prompts, so by the repo's rule calibration stays valid. As implemented (disagreement 3) it will read `stale` after any bump.

**1 · Close the two ways of self-certifying a gate (G-01, G-02, G-22). → `2.7.1`.**
- Repro: §3 #8 and #9.
- Fix: add `EVIDENCE_GATES = {G3}` in `gates.mjs`, and fail the `--evidence` branch for any other gate. Delete `--allow-commands` and read the allowlist from `git show <baseCommit>:docs/00-control/allowed-commands.json`. Add a `HUMAN_GATES = {G11}` rule requiring `--attested-by`. `validate-progress` rejects `commandSource: evidence` outside `EVIDENCE_GATES`. That is about 8 lines in `pipeline.mjs` and 3 in `gates.mjs` and `validate-progress.mjs`.
- Regression tests: one test per non-judgement gate for `--evidence` (non-zero); one for `--cmd … --allow-commands` (exit 3, `refused-agent-command`); one for `gate G11 --evidence`.
- Bump: patch, `2.7.1`. No prompt change; update `pipeline.test.mjs:160-161` to use G3 only.

**2 · Make forced and verified states mean what they say (G-03, G-04, G-05). → `2.7.2`.**
- Repro: §3 #11, #12; `demo.mjs` report line.
- Fix: `verifyLedger` also compares `command` and `commandSource` between `progress.gates` and the last ledger row. `verify` takes the command from the ledger row. `--force` on `phase start|done` writes `forced: true, overridden: [...]` into the ledger and phase record and a "Forced" section into the report. The independence line counts only rows with a `verdictSha256` from `verifier-route dispatch`, else prints "declared, not evidenced". Update `demo.mjs` so it no longer claims "nothing is faked".
- Regression tests: tamper `progress.gates.G7.command` → `verify` exits 1; `phase done X --force` → ledger has `forced:true` and the report has "Forced"; `gate … --model gpt-5` → report doesn't contain "was verified by a model outside".
- Bump: `2.7.2`. New ledger fields change `LEDGER_FIELDS`, so add a one-line migration note. Existing ledgers still verify, because `hashEntry` covers whatever fields are present.

**3 · Make "covered", "frozen" and "protected" hold against the builder (G-07, G-08, G-09). → `2.8.0`.**
- Repro: §3 #17, #36, #29, #30.
- Fix: strip comments and strings before counting assertions in `trace-check-v2`, and attribute them to the enclosing `test(` block. Allow baseline creation only before phase 05 is `done`. `protected-paths`: exit 3 on zero rules, read the rules and base from the base commit, and add `protected --strict` to the doneChecks of 06, 09 and 10.
- Regression tests: the comments-only fixture → exit 1; `rm baseline.json` after 05 → exit 1; `protectedPaths: []` → exit 3; reset `baseCommit` → exit 1.
- Bump: minor, `2.8.0`. This changes how a requirement is counted as covered, which changes what the red team's own `tests/security/*.test` can satisfy. If `v2-08` or `v2-09` prompts are edited to match, calibration is invalidated by the repo's own rule, and re-calibration (never done) becomes a precondition.

---

## 9 · Appendix — what I could not evaluate, and the experiment that would settle it

| Item | Experiment |
|---|---|
| Whether any real model verdict satisfies `verifier-route check` end to end (B-24 included) | Run `dispatch` against one real endpoint with `PIPELINE_VERIFIER_CMD` set to the user's transport, then `live-check verify --run`. Compare the command run with the command configured. |
| Whether `sandbox.mjs profile` output actually confines a process | On a host with docker: `docker compose -f … run --rm sandbox sh -c 'id; cat /proc/1/status; wget -qO- http://1.1.1.1; touch /work/x'`. Expect non-root, `NoNewPrivs: 1`, no network, read-only. |
| Whether `fromNuclei`/`fromZap`/`fromJunit` match real tool output | Run nuclei, ZAP baseline and schemathesis against a seeded vulnerable app. Diff the parsed leads against each tool's native report. Check specifically whether nuclei writes `-o` when it finds nothing. |
| `fuzz-api.mjs` false negatives | Point it at a server that returns 200 + valid JSON for every malformed input, and at one that returns a plausible error shape for all of them. Count violations raised. |
| Real recall of the red team | One planted-bug run per P6-LIVE §4, in a thrown-away branch, with answer file ignored. Nothing here measures it. |
| `validate-findings` evidence tiers and `coverage-gate` | Feed T1/T2/T3 findings whose quote is a prose paragraph, and a coverage ledger that lists every entrypoint as `examined` with identical one-line notes. |
| Node 22 / GitHub Actions behaviour | Read the Actions log for `b7fc97d`. Add the `$RUNNER_TEMP` clone step from G-11. |
| `B-27`, `B-28`, `B-31`, `B-32`, `B-33` | Each is a one-command repro on the documented fixture. I accepted the author's description. |
| `comprehensive-development-lifecycle-prompts/` | Out of scope per §1, so not reviewed. |
