# Last-mile integrations

Four things were listed as *specified, not built*. All four now have working code, tests, and a
place in the orchestrator. What is left in each case needs something this repository cannot
have from here: a model credential, a container runtime, a scanner binary, or a finished
product to calibrate against.

Every claim below is a command you can run. Nothing in this file is aspirational.

| Layer | Built and tested | What only you can do |
|---|---|---|
| Cross-model verifier routing | `verifier-route.mjs`, `independence.mjs`, `lib/families.mjs`, transport example, 18 tests | supply one endpoint + key, set `independence.builderFamily` |
| Sandbox profile | `sandbox.mjs` (run/check/profile/verify), 9 tests | install docker (or bwrap) and run the generated profile |
| DAST / fuzz | `fuzz-api.mjs` (real fuzzer), `dast.mjs` (adapters + `leads` normaliser), 13 tests | install ZAP/nuclei/schemathesis, or use the built-in fuzzer only |
| Planted-bug calibration | `calibrate.mjs` (plan/template/score/status), `lib/bug-classes.mjs`, 11 tests | run one plant on a throwaway branch with a second agent |

```bash
node pipeline/tools/run-selftests.mjs     # every tool above, including the new ones
```

---

## 1 · Cross-model verifier routing

Reason it exists: a second opinion from the same model family is not a second opinion. R-09.

### What is built

```bash
node pipeline/tools/verifier-route.mjs status          # families, author, routable targets
node pipeline/tools/verifier-route.mjs route --phase 07 --gate G7 --author-model claude-sonnet-4 \
  --task "spec-to-code compliance" --claims claims.json --files docs/02-spec/SPEC.md --out env.json
node pipeline/tools/verifier-route.mjs dispatch --envelope env.json --out verdicts.json
node pipeline/tools/independence.mjs --ledger docs/gate-ledger.jsonl --config pipeline.config.json
```

- The envelope is **hash-sealed**: claims, files (with their hashes), rules, and the results
  contract. `check` refuses a verdict that answers a different envelope, skips a claim, or
  claims "confirmed" without a `file:line`.
- The verifier family must differ from the author's. Unknown model → `family: unknown` → refused.
- `independence.mjs` reads what the ledger *recorded* and returns PASS / FAIL (same family) /
  NOT_VERIFIED (no model recorded). `pipeline gate G9 --builtin independence` runs it, and
  exit 3 lands in the ledger as NOT_VERIFIED with the reason and a human command.
- `pipeline report` prints the independence verdict in `FINAL-REPORT.md`.

### What only you can do

1. **Name your builder's family** in `pipeline.config.json`:

   ```json
   { "independence": { "builderFamily": "anthropic", "requireFor": ["G3", "G4", "G7", "G9", "G12"] } }
   ```

2. **Add any model whose family the table does not know** (it is a substring table, not a
   provider claim):

   ```json
   { "verifierFamilies": { "mistral": ["mistral", "mixtral"], "internal": ["acme-"] } }
   ```

3. **Point the transport at your endpoint.** The example already speaks the common
   `{model, messages[]}` shape:

   ```bash
   export PIPELINE_VERIFIER_URL="https://api.example.com/v1/chat/completions"
   export PIPELINE_VERIFIER_KEY="…"
   export PIPELINE_VERIFIER_MODEL="gpt-5"
   echo '{"prompt":"…","envelope":{}}' | node pipeline/examples/verifier-transport.example.mjs --dry-run   # inspect the request, no network
   # (it reads the envelope on stdin; without stdin it exits 3 rather than guessing)
   ```

   If your provider differs, copy `pipeline/examples/verifier-transport.example.mjs` and change
   the request/response mapping only. It must read `{prompt, envelope}` on stdin and print the
   verdict JSON on stdout. Nothing else in the pipeline changes.

4. **Record the verifier on each gate** so the ledger can prove independence:

   ```bash
   node pipeline/bin/pipeline.mjs gate G7 --builtin types,lint,unit,build --model gpt-5 --files docs/02-spec/SPEC.md
   ```

### How you know it worked

```bash
node pipeline/tools/independence.mjs --ledger docs/gate-ledger.jsonl --builder-family anthropic
# expect: RESULT: PASS, and every required gate marked INDEPENDENT
```

If it prints `SAME_FAMILY`, the routing silently went to the author's own family — that is a
failure, not a warning.

### Limits that stay

- The pipeline cannot know which model produced the code. `builderFamily` is a declaration;
  a dishonest operator can lie about it. The ledger makes the lie *visible and consistent*,
  not impossible.
- Nothing here scores the verifier's quality. A cross-family verifier that agrees with
  everything is useless; that is what calibration (below) measures for the red team, and what
  the `refuted` path makes normal.

---

## 2 · Sandbox profile

Reason it exists: you are going to execute code written by an agent, and sometimes code
written by an attacker. R-14.

### What is built

```bash
node pipeline/tools/sandbox.mjs check                  # what this host can actually enforce
node pipeline/tools/sandbox.mjs run --cmd "npm test" --timeout 600000 --require-all
node pipeline/tools/sandbox.mjs run --cmd "node exploit.mjs" --copy ./app --deny-network
node pipeline/tools/sandbox.mjs profile --out docker-compose.sandbox.yml
node pipeline/tools/sandbox.mjs verify --file docker-compose.sandbox.yml
```

`run` always applies: a scrubbed environment (allowlist only — inherited `*_TOKEN`/`*_SECRET`
are dropped and counted), a fresh temporary workdir, `--copy` isolation so the command cannot
write to your tree, a hard timeout, an output cap, and a JSON record of what was enforced.

`run` applies **only where available**: a network namespace, a memory rlimit. Anything it could
not enforce is printed as `NOT_VERIFIED` and, with `--require-all`, refuses to exit 0.

`profile` generates a compose file with `network_mode: none`, `read_only`, `cap_drop: ALL`,
`no-new-privileges`, `pids_limit`, `mem_limit`, `ulimits`, `tmpfs`, a non-root uid, and no
docker-socket or writable host mount. `verify` fails if any of those controls is missing or if
`privileged`/host networking/root/socket mount appears — it is a control checklist, so a
tampered profile cannot pass.

The orchestrator gate:

```bash
node pipeline/bin/pipeline.mjs gate G0 --builtin sandbox     # verifies docker-compose.sandbox.yml
```

### What only you can do

1. Install a container runtime (**this sandbox does not have one empirically** — `sandbox.mjs
   check` reports `docker: no` here):

   ```bash
   node pipeline/tools/sandbox.mjs profile --out docker-compose.sandbox.yml
   docker compose -f docker-compose.sandbox.yml build
   docker compose -f docker-compose.sandbox.yml run --rm sandbox npm test
   ```

2. If you prefer bubblewrap to docker: `bwrap --unshare-net --ro-bind / / --tmpfs /tmp <cmd>`
   is the equivalent, and `sandbox.mjs check` will report `bubblewrap: yes`.

3. Decide policy per phase and write it down in `docs/00-control/guardrails.md`:
   phase 06 runs the product's own tests in the sandbox; phase 08 runs *attacker* code with
   `--deny-network --require-all --copy`.

### How you know it worked

```bash
node pipeline/tools/sandbox.mjs run --cmd 'node -e "fetch(\"https://example.com\").then(r=>console.log(\"NETWORK OK\",r.status)).catch(e=>console.log(\"NETWORK BLOCKED\"))"' --deny-network --require-all
# expect: NETWORK BLOCKED, exit 0, "N NOT_VERIFIED" empty
```

### Limits that stay

- On a host without network namespaces or a container runtime, `run` is *weaker than it looks*.
  That is why the control report exists: read it, and quote it in the report.
- This is process-level isolation, not a VM. A kernel exploit escapes it. For hostile code of
  unknown provenance, use a disposable VM.

---

## 3 · DAST and fuzzing

Reason it exists: static reading finds patterns; only execution finds behaviour. R-08.

### What is built

```bash
node pipeline/tools/dast.mjs plan                          # what is installed, how to install, what it produces
node pipeline/tools/dast.mjs run --target http://127.0.0.1:3000 --contract api-contract.json --out docs/08-redteam/run-1/floor
node pipeline/tools/dast.mjs leads --from semgrep.json --out scanner-leads.json
node pipeline/tools/fuzz-api.mjs --contract api-contract.json --base http://127.0.0.1:3000
```

**`fuzz-api.mjs` is a real fuzzer, not a wrapper.** Given a contract it fires, per endpoint:
baseline, unknown fields, wrong types, a 2 MB body, SQL/XSS/template/unicode payloads, a
5 000-element array, malformed JSON, a wrong content-type, path traversal, and unsupported
methods. It judges the response against the contract and emits violations with a rule id:
`server-error`, `mass-assignment`, `missing-body-limit`, `unvalidated-type`, `reflected-xss`,
`path-traversal`, `unhandled-method`. It is tested against a deliberately trusting server and a
strict one, so it is proven to find the former and stay quiet on the latter.

**`dast.mjs` orchestrates and normalises.** It detects ZAP / nuclei / schemathesis, runs what
exists, and converts whatever comes back (semgrep, SARIF, ZAP JSON, nuclei JSONL, its own fuzz
report) into the one lead shape the hunters already consume. Each parser is tested against a
fixture of the tool's real output shape.

Violations and scanner hits are **leads, not findings** — a hunter must confirm each with a
trace, exactly as `v2-08` requires.

### What only you can do

1. **Write `api-contract.json`** from your spec's API section. Start from
   `pipeline/templates/api-contract.example.json`. The important field is
   `body.unknownFields: "reject"` — only claim it if the spec says unknown fields are rejected,
   because that is what turns a mass-assignment lead into a violation.

2. **Run it against the production build**, not the dev server:

   ```bash
   npm run build && npm start &
   node pipeline/tools/fuzz-api.mjs --contract api-contract.json --base http://127.0.0.1:3000 \
     --out docs/08-redteam/run-1/floor/fuzz.json --leads docs/08-redteam/run-1/floor/scanner-leads.json
   ```

3. **Add a real scanner** if you want coverage beyond the built-in cases (any one is enough to
   stop the layer being `NOT_VERIFIED`):

   ```bash
   docker pull ghcr.io/zaproxy/zaproxy:stable     # ZAP baseline
   go install github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest && nuclei -update-templates
   pipx install schemathesis
   node pipeline/tools/dast.mjs plan              # confirms detection and prints the exact invocation
   ```

4. **Wire it into the gates**:

   ```bash
   node pipeline/bin/pipeline.mjs gate G7 --builtin fuzz --model <verifier>
   node pipeline/bin/pipeline.mjs gate G7 --builtin dast          # uses commands.dast from pipeline.config.json
   ```

### How you know it worked

```bash
node pipeline/tools/dast.mjs plan            # every installed tool shows "ready"
node pipeline/tools/fuzz-api.mjs --contract api-contract.json --base <url>   # "RESULT: CLEAN" or a violation list
ls docs/08-redteam/run-1/floor/              # fuzz.json, scanner-leads.json, dast.json
```

`dast.json` records, per tool, whether it ran, its exit code and how many leads it produced. If
nothing ran it says `RESULT: NOT_VERIFIED`, and the final report must repeat that.

### Limits that stay

- The built-in fuzzer is **schema-driven, not coverage-guided**. It finds missing validation and
  missing limits; it will not find a business-logic bug in a three-step checkout flow.
- Auth is a cookie or bearer token you supply via an env var; per-role testing (user A reading
  user B's record) is still a hunter's job — the fuzzer only proves the *shape* of rejection.
- Scanner output is noisy. The normaliser is deliberately dumb: it does not de-duplicate.

---

## 4 · Planted-bug calibration

Reason it exists: "we found nothing" is a measurement of the red team, not of the code. R-10.

### What is built

```bash
node pipeline/tools/calibrate.mjs classes                     # the 14-class catalogue
node pipeline/tools/calibrate.mjs plan --n 10 --seed 42 --out calibration/planted.plan.json
node pipeline/tools/calibrate.mjs template --plan calibration/planted.plan.json --out calibration/planted.answer.json
node pipeline/tools/calibrate.mjs score --plan … --answer … --findings docs/08-redteam/run-1/findings.json \
  --out calibration/calibration-report.md
node pipeline/tools/calibrate.mjs status --dir calibration
```

- The plan is **deterministic from its seed** and drawn from a catalogue of real vulnerability
  classes (IDOR, mass assignment, open redirect, stored XSS, missing rate limit, race on a
  unique constraint, SSRF, secret in the client bundle, verbose errors, CSRF, unbounded
  pagination, SQL injection, path traversal, prototype pollution).
- `score` matches planted bugs to **confirmed** findings by class (with aliases, so "BOLA"
  counts as IDOR) and location (file, line within ±25).
- Thresholds: recall ≥ 70% **and** no planted class at zero recall. Otherwise the verdict is
  `INCONCLUSIVE` and every report from that pipeline version must say so.
- It refuses to score when: the answer file is tracked by git (a readable plant is not blind),
  the answer contains classes the plan did not ask for (or omits ones it did), or the findings
  file is a **DIFF** round.
- `pipeline gate G12 --builtin calibrate` and `pipeline report` both read
  `calibration/calibration.json`, so the final report states calibrated / inconclusive / stale
  with the recall number instead of a caveat.
- `pipeline init` adds `calibration/planted.answer.json` to `.gitignore` before anyone plants
  anything.

### What only you can do

Nothing external is needed — this one needs a **finished product** and a **second agent**. The
procedure, in order:

1. Pick a finished product. Branch `calibration/<pipeline-version>`, never merged.
2. `calibrate.mjs plan --n 8..12 --seed <any> --classes <only classes this app can have>`.
3. Give the plan to an agent that **is not on the red team**. It plants each bug in real code,
   proves each is reachable from an existing entry point, and fills in `planted.answer.json`
   (file, line, one-line description). It tells nobody else.
4. Run `08` in full, unchanged and blind. The answer file is not in the red team's context.
5. `calibrate.mjs score …`. Read both numbers: recall **and** the unplanted list.
6. If inconclusive: the `08` prompts are wrong for this product. Fix them, bump
   `pipeline/VERSION`, and re-calibrate with a different seed.

### How you know it worked

```bash
node pipeline/tools/calibrate.mjs status --dir calibration
# NOT_VERIFIED: calibration has not been run for pipeline 2.2.0
```

and `docs/FINAL-REPORT.md` says the same thing, with the sample size.

### Limits that stay

- Planted bugs are easier than natural ones: recall is an **upper bound**.
- Recall says nothing about precision. A red team that reports everything as critical can score
  100% recall and be useless — read the `unplanted` section.
- Ten bugs is a small sample; one miss moves recall by 10 points. The report must print `n`.
- Changing `v2-08`'s attack blocks invalidates the number. `status` reports **stale** when the
  pipeline version moved on.

---

## 5 · The four commands that tell you where you stand

```bash
node pipeline/tools/run-selftests.mjs                  # 17 test files + the traceability selftest: the code is intact
node pipeline/tools/verifier-route.mjs status          # is a cross-family verifier available?
node pipeline/tools/sandbox.mjs check                  # what can this host actually enforce?
node pipeline/tools/dast.mjs plan                       # which scanners are installed?
node pipeline/tools/calibrate.mjs status --dir calibration   # is the red team calibrated?
```

Anything that answers `NOT_VERIFIED` is not a failure of the pipeline — it is the honest state
of your environment, and it is the exact list of what is left to integrate.

## 6 · What is still not built, and why

| Item | State | Why it stays out |
|---|---|---|
| Model API calls | transport written, untested against a live endpoint | needs a credential; the request shape is tested with `--dry-run` |
| Container execution | profile + validator built, never executed here | no docker in this sandbox (`sandbox.mjs check` says so) |
| ZAP / nuclei / schemathesis | adapters + parsers built and tested on fixtures | binaries not installed; `dast.mjs plan` prints the install line |
| Kernel-level isolation (seccomp profiles, gVisor) | not attempted | it is a platform decision, not a repo one; the compose profile is the floor |
| Prompt-injection testing of an LLM app | only the attack-class block in `v2-08` | needs the product to have an LLM; there is nothing to test here |
| Coverage-guided fuzzing (AFL-style) | not attempted | needs a native target; the schema fuzzer covers the web case |
