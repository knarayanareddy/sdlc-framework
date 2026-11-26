# Response to SECOND-OPINION-3

**Review under assessment:** [`SECOND-OPINION-3.md`](SECOND-OPINION-3.md) — the external review produced against [`SECOND-OPINION-PROMPT-3.md`](SECOND-OPINION-PROMPT-3.md), target `b7fc97d`, `pipeline/VERSION` 2.7.0.
**Assessed on:** `main` @ `5d68aa8`. `pipeline/bin/pipeline.mjs` is byte-identical to `b7fc97d`, so the review's line references and every reproduction in it still apply.
**Method:** I did not accept the review on its citations. I re-ran its load-bearing reproductions against the shipped tools on this host and recorded what I saw. Where my run differs from the reviewer's, that is stated.

---

## 1 · Verdict

**The review is correct.** P0–P6 closed the *specific* bypasses they were pointed at and did not close the class. `--cmd true` was fixed, and the next flag (`--allow-commands`) reproduces it; `--evidence` was narrowed for G4 and remains a green button for nine gates, `G11` included.

The whole critique is one loop, which I ran myself on a fresh project:

```
$ head -c 200 /dev/zero | tr '\0' a > docs/x/junk.md
$ for g in G3 G4 G5 G7 G8 G9 G10 G11 G12; do pipeline gate $g --evidence docs/x/junk.md; done
G3 exit=0  G4 exit=0  G5 exit=0  G7 exit=0  G8 exit=0  G9 exit=0  G10 exit=0  G11 exit=0  G12 exit=0
$ pipeline verify
  G11  recorded=passed  now=pass match (evidence present)
  G12  recorded=passed  now=pass match (evidence present)
no drift across 9 re-run gate(s)
```

Nine gates, including the human gate, satisfied by 200 bytes of the letter `a`, then certified by `verify` as "no drift". That is the review's thesis and it holds.

The review's own framing of what survives is also fair: the hash chain, tail truncation, exit-3 propagation, and the absent-input refusals in `plan-check` / scope / `live-check probe` all work. They protect against accident and naive edits. They do not protect against a builder who reads the flags.

---

## 2 · What I reproduced myself

Run against the shipped tools, not against a patched tree. Scratch projects under `/tmp` and `$HOME`.

| ID | My reproduction | Observed | Verdict |
|---|---|---|---|
| **G-01** critical | `gate {G3,G4,G5,G7,G8,G9,G10,G11,G12} --evidence <200-byte junk>`, then `verify` | 9/9 exit 0; `verify` → `match (evidence present)`, `no drift across 9` | **Confirmed, as stated** |
| **G-02** critical | `gate G7 --cmd true --allow-commands /tmp/al.json` (file carries sha256 of `true`) | `G7 PASSED … (exit 0)`; without the flag the same command is `NOT_VERIFIED` | **Confirmed** |
| **G-03** high | record G7 as passed via allowlist, then rewrite `progress.gates.G7.command` to `true`, then `verify` | `verify` ran `true` → `match (exit 0)`; ledger still records `echo ok`; nothing reports the disagreement | **Confirmed** |
| **G-04** high | empty project, `phase start 12 --force` then `phase done 12 --force` | ledger row `P12 passed, commandSource: orchestrator, exitCode: 0`; no gate rows; `FINAL-REPORT.md` contains zero occurrences of "forced"/"Forced"; report says `NOT_VERIFIED: 0` | **Confirmed, and worse**: the report calls a project with *no gates* clean |
| **G-05** high | `demo.mjs` runs `gate G7 --builtin unit --model gpt-5` and `gate G9 … --model gemini-2.5-pro`; report then says "every judged gate (G7, G9) was verified by a model outside anthropic" | no model is called anywhere in the demo | **Confirmed** — my own demo output makes this claim |
| **G-06** high | read `checkVerdict()` (`verifier-route.mjs:328-395`) | validates shape, `envelopeHash` echo (the builder holds the envelope), typed `model`/`family`, and citation ranges; nothing binds the file to a `dispatch` that produced it | **Confirmed by code read** (not re-run) |
| **G-07** high | spec with 5 ids; test file containing `// @req …5 ids`, `test("hollow", () => { // expect(1).toBe(2) })` | `requirements: 5 covered: 5 … RESULT: PASS` | **Confirmed** |
| **G-08** high | freeze baseline, delete one test case → G5 FAIL (correct); then `rm docs/05-test/baseline.json` → `gate G5 --builtin trace:freeze,trace:check` | **PASS** — the builtin re-freezes the weakened tests | **Confirmed exactly** |
| **G-09** high | `{"protectedPaths":[]}` in config, gut `tests/a.test.mjs`, commit | `protected rules: 0 … RESULT: PASS` | **Confirmed** |
| **G-10 / G-11** high | clone the repo under `/tmp`, run `node pipeline/tools/run-selftests.mjs` | `1/2 test groups pass`, `RESULT: FAIL`; `quote-verify.test.mjs:148` fails because `file:quote-verify.mjs` resolves *inside* the trusted tmpdir | **Confirmed** — the first command in the task fails on a stock `/tmp` clone |
| **G-12** high | `{"entrypoints":[]}` as the enumerator output, spec table present | `ok authz 0/0 routes covered` → `RESULT: PASS` | **Confirmed** |
| **G-13** high | feed `rounds.mjs` FULL for 08,09,08,09,08,08 | `{"full":2,"diff":0}`, `roundLog.length = 2` | **Confirmed** — the stop-at-3 rule is unreachable |
| **G-14** high | hand-write `calibration/calibration.json` `{calibrated:true, pipelineVersion:"2.7.0", …}`, run `calibrate status` | `calibration: calibrated for 2.7.0 — recall 100.0% on undefined planted bugs`, exit 0 | **Confirmed** (the `undefined` in the output is the tell) |
| **G-15** high | append `garbage line not json` to the ledger, run `metrics-compute` | `RESULT: PASS — every number above was computed from a named file`; the garbage line is dropped silently | **Confirmed** |
| **G-16** high | `npm view @zaproxy/zap-cli`; inspect default `commands.dast` | `npm error 404`; default builtin is `npx @zaproxy/zap-cli quick-scan --self-contained`, and `P6-LIVE.md` says this flips G8 | **Confirmed** — a documented builtin that cannot run |
| **G-18** high | `sandbox.mjs run --cmd "echo hi" --require-all` | ran, exit 0, `4 control(s) applied`, `network was NOT denied` | **Confirmed** |
| **G-19** medium | stub `docker`/`nuclei`/`schemathesis` that `exit 0` silently + 3 env strings, `live-check probe` | `READY verifier`, `READY sandbox` ("docker daemon"), `READY scanners` | **Confirmed** |
| **G-20** medium | read `lib/scope.mjs:43,59` | combined `--changed-since`+`--scope` returns an **array** of files but `scopeFail` tests `.size` (undefined) → never fires; label still claims both | **Confirmed by code read** |
| **G-21** medium | `{"tripwire":[]}` then `tripwire.mjs` | `checks: 0 … RESULT: PASS` | **Confirmed** |
| **G-22** medium | covered by G-01 (`gate G11 --evidence` passes) and by `demo.mjs:109`, which records G11 `--not-verified` and ends `RESULT: PASS` | human gate not enforced anywhere; the demo relies on it | **Confirmed** |
| **G-23** low | `P6-LIVE.md:119` uses `leads --file`; real flag is `--from`. `ls pipeline/tools/*.mjs` = 22, not 23 | both confirmed | **Confirmed** |
| **G-24** low | `.github/workflows/pipeline.yml` | traceability step uses `--allow-uncovered`; `calibrate … \|\| true`; Node 22 only; no `verify`, no `probe`, no tmpdir clone | **Confirmed** |
| **G-17** medium | not run (needs a stub `nuclei` + stale artifact fixture) | — | **Accepted from code read**: `dast.mjs:208` accepts an artifact without an mtime check, and `:199` interpolates `--target` into a `shell: true` command |

**Tally: 20 of 24 reproduced by running the tools on this host; 4 accepted from direct code read (G-06, G-17, G-20, G-24). G-03 needed the reviewer's precondition (`status: passed`) before it fired — with that precondition it reproduces.**

Nothing in the review is wrong. The only things I would restate are in §4.

---

## 3 · Why three reviews keep landing the same finding

P0 fixed `--cmd true`. The next flag reproduced it (G-02). P2 fixed `--evidence` for G4. The same branch left eight more gates open (G-01). P3 anchored coverage to a frozen baseline. `rm baseline.json` re-freezes it (G-08).

The pattern is not carelessness in each check. It is that every integrity anchor the checks consult — `progress.json` (`command`, `baseCommit`), `pipeline.config.json` (`protectedPaths`, `commands`, `tripwire`), the allowlist path, `baseline.json`, `calibration.json`, `entrypoints.json` — is a file in the builder's own working tree, writable by the same uid that runs the tools. A check that reads its own trust input from the tree it is inspecting is a check that can be talked to.

That is the review's §7 disagreement 1 and I accept it as the primary finding, ahead of any individual G-item. The individual fixes below are worth doing because each one is cheap and turns a silent bypass into a loud refusal, but the structural fix is: **read trust anchors from `git show <baseCommit>:<path>`, where `baseCommit` is pinned in the ledger's genesis row and not in `progress.json`, and make the ledger HMAC mandatory in G10** rather than opt-in.

---

## 4 · Where I would adjust the review

Three places, all about the fix rather than the finding.

**4.1 `EVIDENCE_GATES = {G3}` is too blunt, but its direction is right.** G4 (tests observed failing before the fix) and G11 (a human looked at it) are legitimately evidence gates — but they need *validated* evidence, not a size check: G4 should require `--cmd` against the test runner (the failing run is a command; `--evidence` there is the B-22 hole), and G11 should require `--attested-by <name>` plus `PIPELINE_HUMAN=1` (the review's own G-22 fix), with the attestation recorded in the ledger. Concretely: `EVIDENCE_GATES = {G3}` for *files as evidence*, `HUMAN_GATES = {G11}` for *named attestation*, and `--evidence` refused for G5/G7/G8/G9/G10/G12. That is the review's fix plus one category, and it is still ~10 lines.

**4.2 "`phase done 12` should exit 3 while any gate is NOT_VERIFIED" — I would not adopt that as written.** `NOT_VERIFIED` is the honest terminal state (rule 2: never converted into green). The demo records G11 `--not-verified` with a reason and a human command; that is the mechanism working, not failing. If `phase done 12` exits 3 on any `NOT_VERIFIED`, `--not-verified` becomes unusable and the rational response is `--force`, which is strictly worse (G-04). What I would adopt instead:

- `phase done 12` exits 0, but stdout and `FINAL-REPORT.md` print `INCOMPLETE — n gate(s) NOT_VERIFIED` in the headline, not in a footnote, and `metrics.json` carries `complete: false`;
- a `--strict-complete` flag turns that into exit 3 for anyone who wants the hard gate in CI;
- `G12` cannot be `passed` while a required gate is `NOT_VERIFIED`.

That keeps the demo's honesty, removes the "clean" claim, and gives CI a switch. This one is a human decision — it changes what "finished" means in this repo.

**4.3 Calibration keyed to the exact `VERSION` string (disagreement 3) — accepted as a defect.** Every fix below bumps the version, so the artefact would read `stale` after each one even though no red-team prompt changed. `status` should hash `prompts/v2-08*`, `prompts/v2-09*` and `lib/bug-classes.mjs` instead. Currently moot (calibration has never run), but it must be fixed *before* the first calibration run, not after.

The review's disagreement 4 (`verify` re-running file-writing builtins refreshes artifacts instead of testing them) is also right; `verify` needs a read-only `--check` mode for `metrics`, `entrypoints` and `quotes`.

---

## 5 · Disposition and plan

Every finding is accepted. Disclosed-and-carried items from `SECOND-OPINION-PROMPT-3.md` §7 that this review widens (B-21→G-04, B-22→G-01, B-23→G-12, B-26/B-28→G-15, B-29, B-30, B-34→G-09, B-35→G-17) are marked where they are subsumed. Each fix ships with the named regression test, per the standing rule.

**2.7.1 — close self-certification (G-01, G-02, G-22).** Critical, ~15 lines.
- `--evidence` refused for every gate except `EVIDENCE_GATES = {G3}`; `validate-progress` rejects `commandSource: evidence` outside that set.
- delete `--allow-commands`; read `docs/00-control/allowed-commands.json` from `git show <baseCommit>:…`, refuse when unreadable.
- `HUMAN_GATES = {G11}`: `NOT_VERIFIED` unless `--attested-by` and `PIPELINE_HUMAN=1`; attestation recorded.
- tests: one per non-evidence gate (`--evidence` → non-zero), `--cmd … --allow-commands` → exit 3 `refused-agent-command`, `gate G11 --evidence` → exit 3. Rewrite `pipeline.test.mjs:160-161` to use G3.

**2.7.2 — make "passed" and "verified" mean what they say (G-03, G-04, G-05, G-06).**
- `verifyLedger` compares `command` and `commandSource`, not just `status`; `verify` re-runs the ledger's command.
- `--force` writes `forced: true, overridden: [...]` into ledger and phase record; report gains a "Forced" section; `validate-progress` fails forced phases at G10.
- independence line counts only rows carrying a `verdictSha256` from `dispatch`; otherwise "declared by flag, not evidenced". `demo.mjs` stops claiming "nothing is faked".
- `dispatch` writes `.attest`; `check` requires it.
- tests: tampered `progress.gates.G7.command` → `verify` exit 1; `phase done X --force` → `forced:true` + "Forced"; `gate G9 … --model gpt-5` → report must not contain "verified by a model outside"; forged verdict without `.attest` → exit 3.

**2.8.0 — make "covered", "frozen", "protected" hold (G-07, G-08, G-09, G-10, G-11).**
- strip comments and string literals before counting assertions; attribute assertions to the enclosing `test(`/`it(` block; `requirements: 0` → NOT_VERIFIED.
- baseline may be created only while phase 05 is not `done`.
- `protected-paths`: zero rules → exit 3; rules and base from the base commit; add `protected --strict` to 06/09/10 done-checks.
- `quote-verify`: drop `os.tmpdir()` from allowed sources; point its tests at an in-repo fixture. This also fixes `run-selftests` and `demo` on a `/tmp` clone.
- tests: comments-only fixture → exit 1; `rm baseline.json` after 05 → exit 1; `protectedPaths: []` → exit 3; `file:/tmp/x` → exit 1; suite green from a clone under `$RUNNER_TEMP`.

**2.8.1 — the fail-open empties and the documentation (G-12, G-13, G-14, G-15, G-16, G-17, G-18, G-19, G-20, G-21, G-23, G-24).**
- empty `entrypoints` → NOT_VERIFIED; union routes with the spec table instead of `??`; parse matrix cells; recognise Express/`pages/api`, and exit 3 when no framework matched; `walk` skip-override for route dirs.
- `roundLog` keyed by `{phase, runDir}`; `mode` derived from `coverage-gate`.
- `calibration.json` bound to plan/answer/findings hashes and to the prompt hashes; `normalisePath` stops stripping package prefixes.
- `metrics-compute` calls `verifyLedger` first; `requirements: 0` and missing calibration are not green.
- `dast` builtin → `dast.mjs run --require-all-tools` (the npm package 404s); fresh-artifact check; `--target` validated and passed as argv, not through a shell.
- sandbox `verify`: per-service parsing, reject `cap_add`, `seccomp` ≠ `no-new-privileges`, host namespaces, `devices`, writable binds; `--require-all` treats `false` as refusal.
- `probe` caps at `PARTIAL`; `READY` is reserved for `verify --run`.
- scope: intersect sets, use `.length`, include untracked files, exit 3 for scoped coverage claims.
- tripwire zero checks → exit 3.
- docs: `P6-LIVE.md:119` `--file`→`--from`, 22 vs 23 tools, `INTEGRATIONS.md:311` version, `ARTIFACTS.slices` vs `cfg.slicesGlob`, `v2-06`/`v2-08` wording; CI adds `verify`, the tmpdir clone and a Node 20 job.

**2.9.0 — trust anchors (review §7 disagreement 1, structural).**
- read every anchor (`progress.json` fields that matter, `pipeline.config.json`, allowlist, `baseline.json`, `calibration.json`, `entrypoints.json`) with `git show <base>:<path>`;
- pin `baseCommit` in the ledger genesis row, not in `progress.json`;
- make `--require-hmac` mandatory in G10, or state in the README that the ledger is advisory.

**Sequencing rationale:** 2.7.1 and 2.7.2 are small and remove the two critical self-certifying routes plus the two unearned report lines; 2.8.0 is the first batch that changes how a requirement counts as covered, so it carries the calibration caveat (if any `v2-08`/`v2-09` prompt wording changes, calibration is invalidated by the repo's own rule — and it has never been run, so the cost is zero today); 2.8.1 is volume, no design change; 2.9.0 is the one that stops the next review from finding G-25 of the same shape.

**Not moved by any of this:** the four P6 blockers. No non-builder model, no Docker, no scanners, no blind calibration on this host. `live-check probe` still reports 0/4 here, and the review's Appendix items stay unverifiable until a host supplies them.

---

## 6 · What needs a human decision before 2.7.2 ships

1. **§4.2** — `phase done 12` exiting 3 on `NOT_VERIFIED` (the review's position) versus `INCOMPLETE` in the headline plus `--strict-complete` (mine). This changes what "finished" means.
2. **G11 enforcement model** — `--attested-by` + `PIPELINE_HUMAN=1` is a convention, not a boundary; the builder shares the shell. Accepting it means accepting that G11's real control is the human reading the report, which argues for the report carrying the attestation name and timestamp in the headline.
3. **`--evidence` for G3 only** — G3 is "research provenance", and its evidence is a document. If G3's evidence path stays, it should be validated as a research doc under `docs/01-research/` with `quote-verify` clean, not merely ≥64 bytes.
