# P6 · the last mile: four things this repository cannot do from here

Everything else in `pipeline/` is built, wired into a gate, and tested. These four items need
something that only exists on your machine — a model credential, a container runtime, two
scanner binaries, and a finished product to calibrate against. **DO NOT** read this as "the
pipeline does not work": read it as the exact list of what is still `NOT_VERIFIED`, with the
command that flips each one.

The harness is one tool. It prepares everything that can be prepared, and it refuses to call an
item done because a file with the right name exists.

```bash
node pipeline/tools/live-check.mjs probe        # the four items, their state, and the next command
node pipeline/tools/live-check.mjs prep         # write every artifact that does not need your key
node pipeline/tools/live-check.mjs verify --run # re-probe and exercise the binaries; exit 0 only when all four are in place
node pipeline/bin/pipeline.mjs live             # same as probe, from the orchestrator
```

`prep` writes `docs/13-live/live-plan.md` — a snapshot of what is ready, what is not, and the
commands below, generated from the probes so it cannot drift from them.

**What "ready" means here.** A binary on `PATH` is not a runtime: `probe` asks the docker daemon
(`docker info`) and runs `nuclei -version`; a `pipeline.config.json` key is not a working
verifier: `probe` resolves both families through `lib/families.mjs` and refuses a same-family
pair; a `calibration/calibration.json` from another pipeline version is not a calibration for
this one. Nothing in this list can be satisfied by creating a file.

---

## Already done for you

| Prepared | Where | Why it is safe to generate |
|---|---|---|
| hardening compose profile, generated **and validated** | `docs/13-live/sandbox.compose.yml` | `sandbox.mjs profile` + `sandbox.mjs verify`; validation never needs docker |
| the two config blocks, paste-ready | `docs/13-live/config.snippet.json` | it is a snippet, not an edit to your config |
| DAST plan: which adapters exist, their install lines, their exact commands | `docs/13-live/dast-plan.json` | `dast.mjs plan --json` |
| a hash-sealed verifier envelope built from your real spec | `docs/13-live/verifier-envelope.json` | `verifier-route.mjs route`; dispatchable the moment a key exists |
| a deterministic 10-plant calibration plan + a **blank** blind-answer file | `calibration/planted.plan.json`, `calibration/planted.answer.json` | `calibrate.mjs plan`/`template`; the answer stays gitignored and unfilled |
| the request shape your transport must speak, proven with `--dry-run` | `pipeline/examples/verifier-transport.example.mjs` | 8 tests, no network |

`prep` never overwrites a file it finds. If you edit `config.snippet.json`, it is left alone.

---

## 1 · A verifier from another model family  *(flips `G9 --builtin independence`)*

The rule the pipeline enforces: a verifier that shares the builder's family is not a second
opinion. `independence.mjs` answers `NOT_VERIFIED` — not PASS — when the builder's family is
unknown, which is why the first two lines matter.

```bash
# 1. name your builder's family (once). Either:
export PIPELINE_BUILDER_MODEL="claude-sonnet-4"          # family is derived from the model name
#   … or set independence.builderFamily in pipeline.config.json (see docs/13-live/config.snippet.json)

# 2. name a verifier from a DIFFERENT family, and the command that talks to it
export PIPELINE_VERIFIER_MODEL="gpt-5"
export PIPELINE_VERIFIER_CMD="node <repo>/pipeline/examples/verifier-transport.example.mjs"
export PIPELINE_VERIFIER_URL="https://<your-endpoint>/v1/chat/completions"
export PIPELINE_VERIFIER_KEY="<your key>"                 # never commit it; never paste it to an agent

# 3. dispatch the envelope that prep built, then check the verdict against it
node pipeline/tools/verifier-route.mjs dispatch --envelope docs/13-live/verifier-envelope.json --out docs/13-live/verdicts.json
node pipeline/tools/verifier-route.mjs check --envelope docs/13-live/verifier-envelope.json --verdict docs/13-live/verdicts.json
# dispatch also writes verdicts.json.attest; check refuses a verdict without one, and
# `gate … --verdict docs/13-live/verdicts.json` records its sha256 so the report can cite it

# 4. record the family on a gate so the ledger can prove independence
node pipeline/bin/pipeline.mjs gate G9 --builtin independence --model gpt-5
```

If your provider does not speak `{model, messages[]}`, write your own transport — the contract is
small: **stdin** is `{prompt, envelope}`, **stdout** must be the verdict JSON only, **stderr** is
for humans, **exit 3** means "I could not run" and is recorded `NOT_VERIFIED` rather than faked.

**Accepted when** `probe` says `READY verifier … openai verifies anthropic`, `check` exits 0, and
the ledger row for the gate carries `modelFamily: openai`.

**What to send back:** the `derivedFrom`-style evidence is already in
`docs/13-live/live-readiness.json`; paste the `verifier` row and the dispatch stderr if it failed.

---

## 2 · A container runtime that can run the workload  *(flips `G0 --builtin sandbox`)*

`sandbox.mjs` has always applied the controls it can (env scrub, `ulimit -v`, `timeout`, output
cap) and reported the rest as `NOT_VERIFIED`. A full sandbox needs docker, or bubblewrap plus a
network namespace.

```bash
# Install docker 24+ (or: bubblewrap + unprivileged netns on Linux).
node pipeline/tools/sandbox.mjs check                       # what is enforceable here, per control

# the profile was generated and validated by prep; run something inside it
docker compose -f docs/13-live/sandbox.compose.yml run --rm sandbox node --version
docker compose -f docs/13-live/sandbox.compose.yml run --rm sandbox node --test tests/security

# record it
node pipeline/bin/pipeline.mjs gate G0 --builtin sandbox      # re-verifies the compose file
node pipeline/bin/pipeline.mjs gate G7 --builtin sandbox      # when a real workload ran inside
```

**Accepted when** `probe` says `READY sandbox … docker daemon 24.x`, and a command has actually
executed inside the container with `--network none`. A `docker` binary whose daemon is down is
reported `PARTIAL`, not ready — that is the difference between installed and usable.

**What to send back:** the `sandbox` row of `live-readiness.json` plus the output line from the
container run.

---

## 3 · `nuclei` + `schemathesis`  *(flips `G8 --builtin dast`)*

```bash
go install github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest && nuclei -update-templates
pipx install schemathesis                       # or: uv tool install schemathesis
node pipeline/tools/dast.mjs plan                # confirm both are detected

# against a running build, with the contract generated from your routes:
node pipeline/tools/dast.mjs run --target http://127.0.0.1:3000 --contract api-contract.json --out docs/13-live
node pipeline/tools/dast.mjs leads --file docs/13-live/nuclei.jsonl     # normalised leads, not findings
node pipeline/bin/pipeline.mjs gate G8 --builtin dast
```

ZAP is optional (`dast.mjs plan` prints the docker line). The built-in fuzzer
(`--builtin fuzz`, `fuzz-api.mjs`) needs no binaries and already runs in CI; these two add
template checks and schema-driven adversarial requests on top.

**Accepted when** `probe` says `READY scanners`, and `dast.mjs run` produced an artifact that
`leads` can parse. A run in which every case was skipped is `NOT_VERIFIED`, not `CLEAN` — that
rule is already tested.

---

## 4 · A blind planted-bug calibration  *(flips `G12 --builtin calibrate`)*

This one needs no binaries and no key. It needs a **finished product** and **a second agent**.
The plan was already prepared by `prep`.

```bash
# 0. throwaway branch, never merged
git switch -c calibration/2.7.0

# 1. the plan (prep made one; make your own to change n/seed/classes)
node pipeline/tools/calibrate.mjs plan --n 10 --seed 1729 --out calibration/planted.plan.json
node pipeline/tools/calibrate.mjs template --plan calibration/planted.plan.json --out calibration/planted.answer.json

# 2. hand the plan to an agent that is NOT on the red team. It plants each bug in real code,
#    proves each is reachable from an existing entry point, and fills planted.answer.json.
#    It tells nobody else. The file is gitignored — check: git check-ignore calibration/planted.answer.json

# 3. run phase 08 unchanged and blind (the answer file is not in the red team's context)
node pipeline/bin/pipeline.mjs phase start 08
#    … the red team runs, findings.json is written …

# 4. score
node pipeline/tools/calibrate.mjs score --plan calibration/planted.plan.json \
  --answer calibration/planted.answer.json \
  --findings docs/08-redteam/run-1/findings.json \
  --out calibration/calibration-report.md
node pipeline/tools/calibrate.mjs status --dir calibration      # exit 0 = calibrated for this version
node pipeline/bin/pipeline.mjs gate G12 --builtin calibrate
```

Read **both** numbers: recall, and the `unplanted` list. 100 % recall with 40 invented findings
is a red team that reports everything. Below 5 planted bugs the verdict is `sampleSufficient:
false` and nothing is calibrated.

**Accepted when** `probe` says `READY calibration … calibrated for 2.7.0`, and
`calibration/calibration-report.md` (the score) quotes `n` next to recall.

---

## Closing the loop

When all four are in place:

```bash
node pipeline/tools/live-check.mjs verify --run          # exit 0, and docs/13-live/live-readiness.json says verifiedAt
node pipeline/bin/pipeline.mjs gate G0 --builtin sandbox
node pipeline/bin/pipeline.mjs gate G7 --builtin sandbox
node pipeline/bin/pipeline.mjs gate G8 --builtin dast
node pipeline/bin/pipeline.mjs gate G9 --builtin independence --model <verifier-model>
node pipeline/bin/pipeline.mjs gate G12 --builtin calibrate
node pipeline/bin/pipeline.mjs verify                     # re-runs every recorded gate; no DRIFT
node pipeline/bin/pipeline.mjs report                     # FINAL-REPORT.md now quotes real numbers
```

`live-check` adds **no gate of its own**. Readiness is not a deliverable; the evidence each item
produces is what the existing gates read. A fifth gate that passes when a directory exists would
be exactly the failure mode P0–P5 removed.

## What stays unverified even after all four

- **Coverage-guided fuzzing** (AFL-style) needs a native target; the schema fuzzer covers the web case.
- **Kernel-level isolation** (seccomp profiles, gVisor) is a platform decision; the compose
  profile is the floor.
- **Prompt-injection testing of an LLM app** has only the attack-class block in `v2-08`; it
  needs a product that has an LLM.
- **Planted bugs are easier than natural ones**: calibration recall is an upper bound, and says
  nothing about precision.
- **One model family is still one model family** if your verifier shares the builder's — which
  is precisely why item 1 exists.
