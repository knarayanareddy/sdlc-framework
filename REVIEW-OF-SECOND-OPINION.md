# Review of the second opinion — adjudication + merged path forward

**Subject:** `seconopinionnew.md` (699 lines, 116 KB), an independent adversarial audit of
`knarayanareddy/sdlc-framework` @ `420b560`, produced by a different agent from the one whose
`SECOND-OPINION.md` I reviewed in `REVIEW-OF-REVIEW.md`.
**Checked against:** this checkout at `c886abc` (same code as `420b560` for every file cited).
**Host:** Linux x86_64, Node `v22.22.3`, no docker / bwrap / `unshare -n`, no scanner binaries, no LLM keys.
**Method:** every claim below was re-run here or read in the source. Nothing is accepted on trust.
Line-level claims are marked `code` when I read them and did not execute a behavioural repro.

---

## 1 · Verdict

**This is the stronger of the two reviews, and it changes my plan.** All four of its Critical
findings reproduce, plus nine of its High and five of its Medium/Low items: **17 of 24 findings
reproduced on my host with the exact exit codes it reports.** Its three best findings —
F-03 (the phase table lets an agent skip Spec Freeze *and* the entire Red Team phase),
F-04 (`SPEC.sha256` is never verified after freeze, and `freeze --refreeze` launders a spec edit),
and F-14 (`protected-paths` omits `pipeline/bin/**`, `pipeline.config.json`, the test baseline and
the spec hash, and `git commit` clears the evidence) — are defects that **neither the first
reviewer nor I found.** Together they are worse than anything in review #1, because they let a
builder skip the security phase and rewrite the frozen spec while every control still reports
green.

**It is not, however, a clean sweep.** Five of its items are overstated or loosely stated (F-11's
timeout half, F-13's mechanism, F-23's conflation, the "17 test files" count, the count drift
between "eleven load-bearing places" and "24 defects"), and its roadmap contains one
self-contradiction I have to resolve (it hardens `FZ` in R0 and recommends deleting `FZ` in D-02).

**And it shares review #1's blind spot.** Neither reviewer ever asks the most basic question: *what
if the builder writes the gate command?* `pipeline gate G7 --cmd true` still records `passed`
(review #1's F-01, my repro). Review #2 spends a whole section on ledger forgery but never tries
the cheaper attack one layer up. That finding stays open and stays first.

**Scoreboard effect.** Review #1 graded the Orchestrator `WEAK`. With F-03 + F-04 + F-14 combined I
now grade **Orchestrator: BROKEN** — not for the reason review #1 gave, but because the state
machine and the protected-path check are both advisory. Traceability also moves to **BROKEN**
(review #2's F-15: `--allow-uncovered` is hardcoded in `trace:check`, so zero tests pass G5 —
stronger than review #1's comment-only-test finding).

---

## 2 · What I re-ran

Every row is a command I executed in this checkout. Exit codes are mine, not the reviewer's.

| # | Claim | Command | My result | Verdict |
|---|---|---|---|---|
| 1 | `F-03` phase table skips `H1`/`FZ` | hand-set phases 00–04 done, `phase start 05` | `phase 05 started`, **exit 0** | **CONFIRMED** |
| 2 | `F-03` phase table skips `08` | phases 05–07 done, `phase start 09` | `phase 09 started`, **exit 0** | **CONFIRMED** |
| 3 | `F-04` post-freeze spec edit is invisible | `echo >> SPEC.md; pipeline verify` | `no drift across 2 re-run gate(s)`, **exit 0** | **CONFIRMED** |
| 4 | `F-04` `--refreeze` needs no CHANGES.md | `freeze --refreeze` with no `CHANGES.md` | `(re-frozen)`, **exit 0** | **CONFIRMED** |
| 5 | `F-14` gate tool + config + baseline unguarded | tamper 4 files, `protected-paths.mjs` | `changed files: 4` → **`RESULT: PASS`, exit 0** | **CONFIRMED** |
| 6 | `F-14` commit clears the evidence | same 4 files, then `git commit` | `changed files: 0` → **`RESULT: PASS`, exit 0** | **CONFIRMED** |
| 7 | `F-15` `trace:check` hardcodes `--allow-uncovered` | `sed -n '145,160p' pipeline/bin/pipeline.mjs` | all three trace builtins carry the flag | **CONFIRMED** (`code`) |
| 8 | `F-11` memory limit not applied | `run --memory-mb 64` allocating 300 MB | `ALLOCATED 314572800`, report says `memoryLimited: true`, "5 control(s) applied" | **CONFIRMED** |
| 9 | `F-11` `--require-all` runs the code first | `--deny-network --require-all` writing a probe file | `refusing…` exit 3 **but probe file written** | **CONFIRMED** |
| 10 | `F-11` "no `timeout(1)` at all" | `--timeout 2000` with `sleep 30` | killed at **2002 ms** | **OVERSTATED** — the inner `timeout` is dead, but `spawnSync`'s own timeout still kills |
| 11 | `F-13` missing `SPEC.md` → green | `tripwire.mjs --only trace` at repo root | `trace NOT_VERIFIED → tool unavailable`, `RESULT: PASS (with NOT_VERIFIED checks)`, **exit 0** | **CONFIRMED** (mechanism differs, see §4) |
| 12 | `F-05` DAST on a dead port | `dast.mjs run --target 127.0.0.1:59999` | `RESULT: RAN — 1 tool(s) produced output`, **exit 0** | **CONFIRMED** |
| 13 | `F-09` T1 comment-only test | `validate-findings.mjs` on `// @finding F-1 expect(1)` | `RESULT: PASS` | **CONFIRMED** |
| 14 | `F-09` T2 `failureRate: 0` | fixture with 0 % reproduction | `RESULT: PASS` | **CONFIRMED** |
| 15 | `F-09` T3 duplicated verifiers | `verifiers: ["claude","claude"]` | `RESULT: PASS` | **CONFIRMED** |
| 16 | `F-09` DIFF rounds hard-fail | valid run with `mode: "DIFF"` | `PROBLEM a DIFF run cannot be used…`, **exit 1** | **CONFIRMED** |
| 17 | `F-01` verifier never sees the files | `route --files README.md --write-prompt` | prompt contains `- README.md (5486 bytes)` and **zero bytes of it** | **CONFIRMED** |
| 18 | `F-01` directory in `--files` crashes | `--files README.md,src` | `EISDIR`, exit 1 | **CONFIRMED** |
| 19 | `F-16` `file:` URL copies arbitrary files | extract citing `file:/tmp/r2/secret.txt` | `SECRET-ROOT-PASSWORD` copied into `docs/01-research/snapshots/` | **CONFIRMED** |
| 20 | `F-16` `injectionSuspected` promoted anyway | same source flagged `true` | logged `injection-suspected`, **still written as `verified`** in the ledger | **CONFIRMED** |
| 21 | `F-17` `NOT_VERIFIED` poisons G10 | `gate G7 --builtin fuzz`; `validate-progress` | `humanCommand: null` → `PROBLEM G7: NOT_VERIFIED without humanCommand`, exit 1 | **CONFIRMED** |
| 22 | `F-19` 0-byte glob passes | `expect-files --glob slice-*.md` on an empty file | `RESULT: PASS` | **CONFIRMED** (= my `M-02`) |
| 23 | `F-08` report precedes G10–G12, rounds stuck at 0 | `demo.mjs --keep`, read `FINAL-REPORT.md` | G10/G11/G12 `not evaluated`, `FULL rounds: 0` | **CONFIRMED** |
| 24 | `F-23` `REPO-REVIEW.md` §11 misnumbers findings | compare §11 rows to §8 headings | F-03 row is really F-04; F-10 row is unnumbered prose; closing line calls F-02 "starter scaffold" and F-13 "no root package.json" | **CONFIRMED — my error, fixed in `7a4a6a4`** |
| 25 | `F-18` `next` suggests `--builtin manual` | `gate G3 --builtin manual` path | `GATE_SUGGESTIONS.G3/G4 = ["manual"]`, `builtin("manual")` returns `null` → "nothing to run" | **CONFIRMED** (`code`) |
| 26 | `F-06` fuzz-api `CLEAN` without auth env | — | not re-run; code path (`skipped` → no violation; `&& rejectUnknown`; `.find()`) reads exactly as described | **CODE-CONFIRMED, not reproduced** |

**Reproduced 17 / overstated 4 / code-confirmed-but-not-run 2 / wrong 1** (the "no timeout" half of
F-11, counted under #10). I found no finding that was simply false.

---

## 3 · What review #2 found that neither the first review nor I found

These four change the priority order. Each one is a *false green produced by the framework's own
state*, not by a tool's exit code — which is why neither of us found them: we were both auditing
tools, and these live in the orchestrator.

**N-1 · The phase table makes the Red Team optional (`F-03`).** `05` requires `["03","04"]` and `09`
requires `["07"]`. Phase `08` has no gate id by design, so omitting `"08"` from `09`'s prerequisites
means the only thing that ever required the red team was a field that was never written. Verified:
`phase start 09` → exit 0 with `08` never run. Same for `FZ` → `05`.

**N-2 · The spec freeze is decoration (`F-04`).** `SPEC.sha256` is written by `freeze` and then never
read again: not by `trace:check`, not by `phase done 05..12`, not by `verify`. And `doFreeze` only
checks `CHANGES.md` in the `if (previous && !refreeze)` branch — so the one command documented as the
*exception path* is the one command that bypasses the check. Verified end to end.

**N-3 · The gate tool guards everything except the gate tool (`F-14`).** `DEFAULT_PROTECTED` covers
`pipeline/tools/**` — but not `pipeline/bin/**` (the orchestrator), not `pipeline.config.json` (which
maps gate names to shell commands), not `docs/05-test/baseline.json`, not `docs/02-spec/SPEC.sha256`.
And because the diff base is `HEAD`, a builder that commits its edits produces `changed files: 0`.
Verified with a one-line `commands.unit = "true"` config edit that passed silently.

**N-4 · Honest fail-closed is punished (`F-17`).** `fuzz-api.mjs` exits 3 (correctly — no contract),
`pipeline gate` records `humanCommand: null`, and `validate-progress.mjs` fails **G10** for it. The
pipeline therefore rewards a lying builder (record `passed`) over an honest one (record
`NOT_VERIFIED`). That is an incentive inversion, and it is the mechanism most likely to be exploited
in practice, because it does not require malice — just an agent optimising for a green release gate.

---

## 4 · Where review #2 overreaches

**O-1 · `F-11`'s "no timeout" half is wrong.** The composition it quotes is right —
`timeout -s KILL 5 ulimit -v 262144 2>/dev/null; echo A; echo B` — and the memory limit genuinely
does not apply (I allocated 300 MB under `--memory-mb 64`). But `spawnSync` is also given
`timeout: 2000, killSignal: SIGKILL`, and that kill fires: a `sleep 30` died at 2002 ms. So the
report's claim of two missing controls is one missing control and one dead inner wrapper. The
residual risk it misses is the real one: `spawnSync` kills the *shell*, not the process tree, so a
grandchild can survive the "kill". Worth testing in P1 rather than asserting in a Critical finding.

**O-2 · `F-13` states the mechanism backwards.** It says tripwire "swallows `NOT_VERIFIED` checks by
exiting 0". What actually happens is the opposite direction: `trace-check-v2` exits 2 with
`spec not found` on stderr, tripwire's `MISSING_TOOL` regex matches `/not found/i`, and a **hard
failure is laundered into `NOT_VERIFIED`** — a non-optional check downgraded to "tool unavailable",
then a `RESULT: PASS (with NOT_VERIFIED checks)` with exit 0 unless `--strict`. The defect is worse
than described (it is a false green, not a swallowed yellow) but the sentence points at the wrong
severity. Its sub-observation — `check.optional` is declared on lines 24–28 and **never read** — is
correct and is the actual bug.

**O-3 · `F-23` conflates two layers.** It says §11 "claims F-03 is fixed while `db/index.ts:6` still
throws". §8's F-03 *is* "`next build` hard-fails without `DATABASE_URL`", and the CI Postgres service
genuinely addresses it; the mislabel is that §11's F-03 **row** describes a different fix (test
scripts, which belong to §8 F-04). The ID errors are real — I fixed four of them — but the "claims
fixed while broken" reading is not supported.

**O-4 · Internal count drift.** §1 says "eleven load-bearing places", §R.6 says "24 concrete
defects (4/10/8/2)", §1 also says "the 17 test files pass" while §3.1 correctly reports
`16 file(s)` and `2/2 test groups`. Actual: **16 self-test files, 2 groups**. Trivial, but it is
precisely the documentation drift its own `B-20` finding penalises, and `F-02` bundles four distinct
defects (default `unknown`, missing `resolveFamily`, lax `checkVerdict`, lying `report` line) into
one finding, which inflates the headline count in the same way it accuses the author of doing.

**O-5 · One self-contradiction.** R0 makes `H1`/`FZ` mandatory; D-02 recommends deleting `FZ` as a
phase and folding it into G5. Both can be right, but not as written — see §6.

---

## 5 · Where the two reviews collide, and who wins

| Topic | Review #1 | Review #2 | Ruling | Why |
|---|---|---|---|---|
| Gate integrity | `--cmd true` → PASS (F-01) | not tested; discusses ledger forgery instead | **#1 wins, stays #1 priority** | Cheapest attack, one flag, no corruption needed |
| Orchestrator grade | `WEAK` | `WEAK` (different reason) | **Both too generous — `BROKEN`** | F-03+F-04+F-14 compose into "skip the red team, rewrite the spec, edit the gate" |
| Independence | fail-open on default `builderFamily` (F-11) | fail-open + `checkVerdict` accepts model-less, refuted verdicts (F-02) | **#2 extends #1** | Same root, broader surface, same fix |
| Verifier packet | no code reaches the verifier; `verdicts.schema.json` cited but absent (F-10) | same (F-01) + `EISDIR` on documented directory args | **#2 extends** | Directory expansion is a new, confirmed crash |
| DAST | target E404, records `NOT_VERIFIED` (F-16) | dead port → `RESULT: RAN`, exit 0 (F-05) | **#2 wins** | #1 graded it a wrong URL; #2 proved the exit code is a false green |
| Traceability | comment-only test passes strict mode (F-03) | `--allow-uncovered` hardcoded in `trace:check` (F-15) | **#2 wins** | Stronger: no test needed at all |
| Space-in-path | `%20` reproduces (F-19) | same, correctly graded Linux-not-just-Windows (F-20) | **Agree — both right** | My Am-3 already required the negative-path tests |
| Ledger claims | tamper-evident chain is unkeyed (F-04) | chain is "security theatre" vs a write-access agent (D-01) | **Both right; adopt the wording fix** | Unanimous: soften the README claim |
| Expect-files | not found | 0-byte glob passes (F-19) | **#2 wins** (= my `M-02`, now independently confirmed) | Second source raises it to must-fix |
| Roadmap order | R0 gates → R1 trace → R3 sandbox → R2 ledger | R0 orchestrator → R1 verifier → R2 HMAC → R3 sandbox → R4 plan → R5 metrics → R6 live | **Merge, see §7** | Neither order fixes the incentive inversion early enough |

---

## 6 · What review #2 is silent on, and the one place it contradicts itself

**Silent on self-attestation.** Two attacks it never runs:
`pipeline gate <id> --cmd "<anything>"` → `passed` (review #1's F-01), and hand-editing
`docs/progress.json` (unhashed, the state of record) so that `verify` re-runs a command that is
literally `true` and reports "no drift". Both are still open at `c886abc`. Review #2's own F-03 repro
*silently depends* on being able to hand-author `progress.json` — it just doesn't count that as a
finding.

**Self-contradiction, resolved.** D-02 says collapse `H1` into `02` and `FZ` into `05`. R0 says make
both mandatory. My ruling (unchanged from `Am-4` last round): **keep the controls, drop the
standalone phases.** `SPEC.sha256` stays and becomes a `doneCheck` of `05` plus a check inside
`verify`; `CHANGES.md` stays as the only legitimate path to re-freezing; `H1` stays as a
non-blocking digest inside `02`'s `doneChecks`. That satisfies R0's enforcement *and* D-02's
ceremony-reduction without deleting the two controls that F-04 proves are load-bearing. What must
**not** happen is the reviewers' implied sequence: delete the phase first and enforce the hash later,
because the phase deletion is the cheap move and the hash is the expensive one.

---

## 7 · Merged path forward

Ordering principle I am applying now, which differs from both reviews: **soundness before
substance before sensitivity.**

- *Soundness* — can a builder get a green it did not earn? Fix that first; nothing downstream can be
  trusted while the answer is yes.
- *Substance* — does a green mean anything? (`plan-check`, strict traceability, evidence tiers.)
- *Sensitivity* — can the pipeline tell a good model from a bad one? (calibration, metrics, live
  environment.) Only meaningful once the first two are true.

Mapping to the two earlier numbering schemes is in the last column. Each phase lands with its repro
converted to a permanent test, so a defect can never silently return.

### P0 · Provenance floor — *blocking; nothing else counts until this is green*
**Fixes:** my F-01, review #1 F-01/F-04, review #2 F-03/F-04/F-14/F-20/F-22, and the `speccChanges`
typo. **Effort: M (~1 day).**

1. **Gate command provenance.** `pipeline gate <id> --cmd …` may never record `passed` on its own
   authority: record `commandSource: "agent"`, and make `verify`/`validate-progress` treat an
   agent-sourced command as `NOT_VERIFIED` unless its hash appears in a human-authored allowlist
   written at `init`. Builtins remain first-class.
2. **Protected paths.** Add `pipeline/bin/**`, `pipeline.config.json`, `docs/02-spec/SPEC.sha256`,
   `docs/05-test/baseline.json`. Diff against a **base commit recorded at `init`**, not `HEAD`, and
   include committed-but-changed files, so committing cannot launder an edit.
3. **Phase graph.** `H1 ← 02`, `FZ ← H1,03,04`, `05 ← FZ`, `09 ← 08`. Give `08` a real gate (`G8`)
   so its completion is a recorded command, not a missing prerequisite.
4. **Freeze enforcement.** Verify `SPEC.sha256` in `trace:check`, in the `doneChecks` of `05..12`, and
   in `verify`. `doFreeze` checks `CHANGES.md` in **both** branches (`if (previous && (refreeze || changed))`).
   Rename `speccChanges` → `specChanges` with a config-migration shim.
5. **Ledger honesty.** `try/catch` around line parse (a truncated line currently throws `SyntaxError`
   instead of `{ok:false}`); cross-check `gate-ledger.jsonl` against `progress.json` so tail
   truncation is caught; record `tree` (`git write-tree`) per entry; optional `PIPELINE_LEDGER_KEY`
   HMAC. Stop calling the chain tamper-evident in docs.
6. **Portability.** `fileURLToPath` in the 20 files using `new URL(import.meta.url).pathname`, plus a
   spaced-path test **on Linux** (my `Am-3`).
7. **Claim honesty (≈20 lines of prose).** README/pipeline README: replace "tamper-evident / cannot be
   satisfied by a comment" with what is true today; `INTEGRATIONS.md`: fix the `EISDIR` and
   `--dry-run` commands, the stale `2.0.0`, and the `10`/`17` group counts; `REPO-REVIEW.md` §11: fix
   the four wrong finding IDs (done in this commit).

**Exit criteria:** `pipeline/tools/pipeline.test.mjs` exists and passes, asserting all eight negative
paths: `gate --cmd true` → not `passed`; `phase start 05` pre-`FZ` → exit 1; `phase start 09` pre-`08`
→ exit 1; `freeze --refreeze` without `CHANGES.md` → exit 1; post-freeze `SPEC.md` edit → `verify`
exit 1; appended-then-deleted ledger tail → exit 1; committed config/tool tamper → exit 1; and
`run-selftests.mjs` inside a path with a space → exit 0.

### P1 · Fail-closed floor, and stop punishing it
**Fixes:** review #2 F-05/F-06/F-11/F-12/F-13/F-17/F-18. **Effort: M.**
`dast.mjs` (`ran:false` and exit 3 when no tool produced a parseable artifact; scope the
`.zap/report_json.json` fallback to ZAP; reject unknown lead formats), `fuzz-api.mjs` (exit 3 with
`human command:` when endpoints are skipped; drop `&& rejectUnknown`; `.filter()` not `.find()`),
`tripwire.mjs` (only `optional:true` may degrade to `NOT_VERIFIED`; read the field it already
declares), `entrypoints.mjs` (exit 3 on zero entry points; exclude `pipeline/`; template-literal
fetch), `sandbox.mjs` (`--require-all` **before** `spawnSync`; `sh -c 'ulimit -v N; exec …'` so both
controls actually wrap; `workdirIsolated = !flags.cwd`; process-tree kill; drop the `/work` tmpfs that
shadows the bind mount), and **`pipeline.mjs` falls back to the joined command when a tool prints no
`human command:`** so an honest `NOT_VERIFIED` no longer fails G10.

### P2 · Verifier + independence truth
**Fixes:** review #1 F-10/F-11, review #2 F-01/F-02, plus my `M-01` and review #2's F-16. **Effort: S.**
File excerpts included in `--write-prompt` and `dispatch`; directory expansion in `--files`;
`verdicts.schema.json` created and enforced; `checkVerdict` requires `model` or `family` and exits 1 on
`refuted`/`insufficient` unless `--allow-refuted`; `independence.mjs` normalises via `resolveFamily`
and exits 3 on `unknown`; `pipeline report` stops printing "verified by a model outside …" when the
family is unknown; `quote-verify` quarantines `injectionSuspected` sources, records the snapshot's
provenance and hash (`M-01`), and restricts `file:` URLs to `docs/01-research/` or `os.tmpdir()`.

### P3 · Traceability and evidence tiers
**Fixes:** review #1 F-03, review #2 F-09/F-15/F-19, my `M-02`/`M-03`, review #2's F-07. **Effort: M.**
Remove `--allow-uncovered` from `trace:check` (keep it on `trace:structure`/`trace:freeze`); tag the
two uncovered `mini-app` requirements so the example is honest; `validate-findings` strips comments
and requires a real assertion for T1, `0 < failureRate <= 1` for T2, distinct families for T3, and
accepts `mode:"DIFF"` as supplementary instead of failing it; byte thresholds for glob matches;
`calibrate.mjs` matches without replacement, parses line ranges and `line:col`, requires path
boundaries, and derives its thresholds from the sample size instead of asserting `0.7` against
single-instance classes.

### P4 · Substance gates (was review #2's R4)
`plan-check.mjs`: every `SEC-*` in `SPEC.md` appears in `threat-model.md`, every `REQ-*` in at least
one `slice-*.md`, every `route:*`/`action:*` in `authz-matrix.md`; wire as `--builtin plan` at G4 and
`phase done 06`. Brownfield `--scope` / `--changed-since` on `entrypoints.mjs`, `coverage-gate.mjs`,
`trace-check-v2.mjs`. **Effort: M.**

### P5 · Reporting, schemas, version
`FINAL-REPORT.md` regenerated on `phase done 10/11/12`; `progress.rounds` actually incremented;
`metrics-compute.mjs` derives `metrics.json` from the ledger instead of prose; align the three
existing schemas with their validators and add `schemas.test.mjs`; bump `VERSION` to **2.2.0**
(prior calibration invalidated by rule). **Effort: M.**

### P6 · Live environment — *needs you*
Your API key (a model family different from the builder), a Docker-capable runner, `nuclei` +
`schemathesis`, and a blind 10-bug calibration run on a throwaway branch. **Effort: L, mostly yours.**

| Merged | Supersedes (review #1 / mine) | Supersedes (review #2) |
|---|---|---|
| P0 | R0 + F-11 one-liner | R0 + R2 |
| P1 | R3 (sandbox) + parts of R1 | R3 + F-17 from R1 |
| P2 | R1 (+ `M-01`, Am-2) | R1 + F-16 from R4 |
| P3 | R2 (+ `M-02`, `M-03`) | R5 |
| P4 | R4–R5 | R4 |
| P5 | R6–R7 | R5 |
| P6 | R8 | R6 |

---

## 8 · If you only have one hour

1. **P0.7** — delete the false claims from the README and the two broken commands from
   `INTEGRATIONS.md`. ~20 lines, zero risk, removes the misrepresentation immediately.
2. **P0.3 + P0.4** — the phase graph and the spec-hash check. ~30 lines in `gates.mjs` and
   `pipeline.mjs`, and they close the two defects that let a builder skip the red team and rewrite
   the spec. These are the highest credibility-per-line changes in the whole plan.
3. **P0.1** — `--cmd` can no longer self-certify. This is the one that makes every other gate mean
   something.

Everything else can wait a day. Those three cannot wait a release.

---

## 9 · Decisions I need from you

1. **Approve P0 as scoped?** (~1 day, 11 files + 1 new test file, no new dependencies, no version
   bump.) My recommendation: yes, start now.
2. **Am I allowed to edit the public claims** in `README.md` / `pipeline/README.md` /
   `INTEGRATIONS.md` in P0.7, or do you want to approve the new wording first? Default: I write it,
   you review the diff.
3. **Do you want the ledger sealed (P0.5 HMAC) now or later?** A key outside the agent's environment
   turns "accidental-edit checksum" into "tamper evidence"; without it, the honest label is
   "tamper-evident against accidental edits only". I recommend the label now, the key in P2.
4. **`H1`/`FZ` as phases:** keep them as phases, or collapse them into `02`/`05` per review #2's D-02
   while keeping the controls (§6)? I recommend collapse-with-controls, done inside P0 so it is one
   change to one state machine rather than two.

---

## 10 · Corrections to my own record

- **`REPO-REVIEW.md` §11 had four wrong finding IDs** — review #2 is right. Fixed in this commit:
  the "no test script" row is §8 **F-04**, not F-03; the "three copies of one prompt" row is an
  unnumbered §1 observation, not F-10; the starter scaffold is **§1**, not F-02 (which is graceful
  degradation); "no root `package.json`" is **§1**, not F-13 (which is the CSP).
- **My `REVIEW-OF-REVIEW.md` "nine confirmed repros"** stands, but it was incomplete in an important
  way: all nine were tool-level. Review #2 found the four orchestrator-level false greens I missed
  (§3 above). My gap-list framing — "the gate-bypass class" — should have included the state
  machine, not just `--cmd`.
- **`M-02`** (glob byte thresholds) is now independently confirmed by review #2's F-19, so it moves
  from "nice to have" into P3 as a required fix.
- **My earlier grade of Orchestrator `WEAK`** is withdrawn: **BROKEN**.

---

## Bottom line

Two independent auditors, two different lenses, one convergent verdict: **the tools are real, the
orchestrator is theatre.** Review #1 proved the tools can be told what to say; review #2 proved the
orchestrator can be told to skip the parts that would catch it. Neither is wrong, and the union is
worse than either: at `c886abc` a builder can type its own gate result, skip the red team, rewrite
the frozen spec, edit the gate tool itself, and commit the evidence away — and the pipeline reports
**PASS** at every step. P0 closes all five of those in roughly a day of work and is the difference
between a demo that looks enforced and a pipeline that is.

---

## 11 · P0 landed — the provenance floor (2026-11-26)

Scope approved by the owner ("start P0 now"). Version `2.1.0 → 2.2.0`, because the semantics
changed: an agent-supplied gate command is now refused rather than recorded as a pass.

| Exploit (reproduced at `420b560`) | Before | After |
|---|---|---|
| `gate G7 --cmd true` | `PASS`, exit 0 | **refused**: `NOT_VERIFIED`, exit 3, hash printed for a human to allowlist |
| `phase start 05` with no `FZ` | `phase 05 started`, exit 0 | **exit 1**: `phase FZ is not done` |
| `phase start 09` with no `08` | `phase 09 started`, exit 0 | **exit 1**: `phase 08 is not done` |
| edit `SPEC.md` after freeze → `verify` | `no drift`, exit 0 | **exit 1**: `spec drift: … write CHANGES.md, then freeze --refreeze` |
| `freeze --refreeze` with no `CHANGES.md` | re-frozen, exit 0 | **exit 1**: `CHANGES.md is missing or under 40 bytes` |
| tamper `pipeline/bin` + `pipeline.config.json`, then `git commit` | `changed files: 0 RESULT: PASS` | **exit 1**: both files listed, diff base is the init commit |
| delete the last ledger lines | `chain: intact RESULT: PASS` | **exit 1**: `… has no ledger entry — the ledger was truncated` |
| truncated JSON line in the ledger | `SyntaxError` crash | **exit 1**: `line N is not valid JSON — …` |
| `run-selftests` in a path with a space | `ENOENT … pipeline%20space` | **exit 0** (20 files converted to `fileURLToPath`) |

What else changed:

- **`G8` exists.** Phase `08` owns a real gate (`entrypoints,coverage,findings`), so the red team
  phase cannot be skipped by omitting a prerequisite string. `09` requires both `08` and `G8`.
- **`H1` and `FZ` are real prerequisites**, not free-standing phases: `H1 ← 02`, `FZ ← H1,03,04`,
  `05 ← FZ`. Decision 4 in §9 (collapse vs keep the phases) is still open — this keeps them, which
  is the conservative half of that decision.
- **`SPEC.sha256` has three readers**: `pipeline verify`, `phase done` (any phase), and
  `trace-check-v2` itself. `pipeline report` now prints a `spec:` line so a stale freeze is visible
  without running anything.
- **Ledger entry v2**: `tree` (hash of every tracked + untracked-non-ignored file the gate ran
  against, minus orchestrator state), `commandSource`, and an optional `hmac` when
  `PIPELINE_LEDGER_KEY` is set. `gate-ledger verify --require-hmac` enforces the seal.
- **The incentive inversion is gone**: a tool that exits 3 without printing `human command:` now
  records the gate command itself as the human command, so an honest `NOT_VERIFIED` no longer fails
  `G10`.
- **Claim honesty**: the README no longer says the ledger is tamper-evident; it says what it is
  (an unkeyed chain that catches accidental edits, narrowed by the progress cross-check, the tree
  hash and the optional HMAC). `INTEGRATIONS.md` lost the two commands that crashed (`--files … ,src`
  → `EISDIR`, `--dry-run` without stdin → exit 3) and the stale `2.0.0`/count claims.
- **Acceptance test**: `pipeline/tools/pipeline.test.mjs`, 11 tests, one per exploit above plus a
  positive control (an allowlisted command still passes). It runs inside `run-selftests.mjs`, so CI
  now fails if any of these bypasses returns.

Still open, in order: **P1** (`dast`/`fuzz`/`tripwire`/`entrypoints`/`sandbox` fail-open exit
codes; `--require-all` still executes before refusing), **P2** (the verifier never sees the files;
independence fails open), **P3** (`--allow-uncovered` is still hardcoded in `trace:check`). Those
are exactly the four findings that `pipeline.test.mjs` does *not* yet cover.

## 12 · P1 landed — the fail-closed floor (2026-11-26)

Scope approved by the owner ("P1 next"). Version `2.2.0 → 2.3.0`, because exit-code semantics
changed for six tools. Every row below was reproduced at `50b57e4` before it was fixed, and each one
now has a named test in the tool's own `*.test.mjs`, so it cannot come back silently.

| # | The bypass at `50b57e4` | What it does now | Test |
|---|---|---|---|
| F-05 | `dast run` counted a scanner as `ran:` when its artifact existed, even when the scan failed; "ran but produced no artifact" was also `ran: true`, so a dead target with nothing installed said `RESULT: RAN` | a scan is `ran` only if it produced an artifact **that parses**; the `.zap/report_json.json` fallback is scoped to ZAP, which used to let a failed nuclei run ingest ZAP's report; nothing parseable → `RESULT: NOT_VERIFIED`, exit 3, with the install command for each missing scanner | `dast.test.mjs` · "no scanner produced a parseable artifact, so nothing counts as `ran`" |
| B-02 | schemathesis was declared `format: "junit"` and `leadsFrom()` had no `junit` case: its leads silently vanished while the tool reported `ran` | `fromJunit()` in `lib/leads.mjs`; `failure` → medium, `error` → high; `detectFormat` recognises `<testsuite`/`<testcase`; a `--format` that does not match the file is `NOT_VERIFIED`, not a stack trace | `dast.test.mjs` · "schemathesis junit output is parsed, not silently dropped" |
| F-09 | a fuzz run in which **every** case was skipped (no credential in the env) printed `RESULT: CLEAN` | skipped cases are recorded; zero executed cases → `RESULT: NOT_VERIFIED`, exit 3, naming the unset variables and the exact `VAR=<token> node …` to run | `fuzz-api.test.mjs` · "a run where every case was skipped is NOT_VERIFIED, not CLEAN" |
| F-06 | `wrong-type` was only a violation when the contract happened to say `unknownFields: "reject"`, and `.find()` fuzzed only the first numeric field per endpoint | every numeric field is fuzzed, and a wrong type is a violation regardless of the unknown-field policy | `fuzz-api.test.mjs` · "every numeric field in the body is fuzzed, not just the first" |
| F-13 | `tripwire` downgraded **any** check whose stderr matched `/not found/` to "tool unavailable" — `trace-check-v2` exiting 2 with "spec not found" became a yellow — and a `NOT_VERIFIED`-only run exited 0, i.e. green | `optional: true` (declared and never read) is now the only licence to downgrade; a mandatory check that cannot run **fails**; `NOT_VERIFIED` exits 3 and prints the human command | `tripwire.test.mjs` · "a mandatory check is never downgraded to NOT_VERIFIED", "a missing tool is NOT_VERIFIED, which is not a pass" |
| F-10 | `entrypoints` only failed on zero findings when `--out` was absent: with `--out` it warned and exited 0, and `--root .` enumerated the pipeline's own tools as application surface; `fetch(\`http://${host}\`)` was invisible to the SSRF rule | zero entry points is `NOT_VERIFIED`, exit 3, with or without `--out`; `pipeline/` is excluded; template-literal fetches are SSRF surfaces | `entrypoints.test.mjs` · three tests |
| — | `coverage-gate` accepted an empty entry-point list as trivially "fully covered", and ignored units the enumerator had not listed | empty list → `NOT_VERIFIED`, exit 3; extra units must be examined with a hunter or excluded with a reason | `coverage-gate.test.mjs` · two tests |
| F-11 | `sandbox run --require-all` executed the command and *then* refused to call the run sandboxed; `--memory-mb` composed as `timeout -s KILL N ulimit -v X; cmd`, so `timeout` died on a shell builtin and the command ran with **no** rlimit while both controls were reported applied; `workdirIsolated` was `true` while `--cwd` pointed at the real project | `--require-all` refuses **before** `spawnSync` (records `executed: false`); the controls compose as `timeout -s KILL N sh -c 'ulimit -v X; exec …'`; `workdirIsolated = !flags.cwd`; the temp workdir is removed even with `--cwd`; a startup death under a small rlimit explains itself (`ulimit -v` counts virtual address space) | `sandbox.test.mjs` · "the memory rlimit is enforced, not merely reported", "the timeout kills the whole process group, not just the wrapper", "--require-all refuses to execute …" |
| F-12 | the shipped compose profile mounted a `tmpfs` at `/work`, shadowing the read-only bind mount, so the container saw an empty directory | the tmpfs is gone; `/work` is the bind mount | `sandbox.test.mjs` (`profile`/`verify`) |
| F-17 | `sandbox --cmd "sh -c '…'"` was double-parsed | one shell owns parsing; quoting is tested by the group-kill test above | `sandbox.test.mjs` |
| F-18 | `pipeline gate G3` (and G4) suggested `--builtin manual`, which resolves to nothing and then errors with "nothing to run" | G3/G4 suggest the real call: `gate G3 --evidence docs/03-design/design-brief.md,docs/03-design/tokens.json` | `pipeline.test.mjs` |

**What is verified, not just claimed.** `run-selftests.mjs` → 17 files + trace selftest, 2/2 groups;
`node --test pipeline/tools/*.test.mjs` → **150 tests, 0 failing**; `demo.mjs` → PASS 00→12. The
process-group kill is asserted by a probe file that a grandchild writes 2 s after a 700 ms timeout —
it must still be absent.

**Residual, stated rather than hidden.** `ulimit -v` bounds virtual address space, so a JS runtime
needs a limit well above its reservation (`--memory-mb 4096`, not 256); the tool now says this at the
moment a command dies at startup. Network denial still depends on `unshare -n`, and `--require-all`
is the only thing that turns that dependency into a refusal — without it, an unenforced control is
recorded as `NOT_VERIFIED` in the output and the run continues.

Still open, in the order I would take them: **P2** (`verifier-route` lists the files but not their
contents, so a verifier cites `file:line` from memory — F-01; `independence` fails *open* when
`builderFamily` is left at `unknown` — F-02), then **P3** (`--allow-uncovered` is hardcoded in
`trace:check`), then the §5 substance gates. P2 is the one that matters most: P0 and P1 make the
pipeline refuse to *lie*, but the verifier still cannot see what it is verifying.
