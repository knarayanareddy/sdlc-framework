# Repository review — `knarayanareddy/sdlc-framework`

Reviewed at commit `e4690b0` (single squashed commit, "Add comprehensive-development-lifecycle-prompts folder").
Everything below marked **[ran]** I executed in this checkout; everything marked **[read]** is my reading of the source.
Section 8 lists what I could **not** verify, in the same `NOT_VERIFIED` spirit the repo preaches.

---

## 1. What this repo actually is

It is **two generations of one idea in a single tree**, and the second generation is bigger and better than the first:

| Layer | What it is | Where |
|---|---|---|
| **v1 — the framework** | 11 phase prompts, a spec template, one mechanical gate tool, an operating manual, and a Next.js starter | `pipeline/`, `src/`, root README |
| **v2 — the critique and the amendment** | A 277-line independent review (15 findings), 6 amended prompts, a rewritten gate tool with a self-test, and a full interactive web app that presents all of it | `comprehensive-development-lifecycle-prompts/` |

The nesting matters: the root README documents `pipeline/` and `src/` and **never mentions** `comprehensive-development-lifecycle-prompts/`, which contains the most valuable artefact in the repo (see F-01).

The thesis itself is: *an autonomous build pipeline is only as trustworthy as its mechanical gates*, and most gate rules are prose that the agent being gated can ignore. v1 states the rules. v2 tries to convert them into scripts.

---

## 2. Layer v1 — the pipeline

### 2.1 Shape

```
BRIEF → 01 research → G1 → 02 spec → G2 → 03 design ║ 04 architecture+threat model → G3/G4
      → 05 tests (red) → G5 → 06 build slices ⟲ 07 QA → G7 → 08 red team → 09 patch → G9
      → 10 release → G10
```

Design points that are genuinely good:

- **Artifacts are the interface.** Every phase reads and writes files under `docs/`; nothing depends on chat memory. This is what makes a 10-phase run resumable and auditable.
- **Builder ≠ verifier.** 07/08/09 must run in fresh contexts; the spec reviewer cannot be the spec author.
- **Threat model before code** (04) and a **walking skeleton** before feature slices (05).
- **Bounded loops** (≤3 repairs, ≤3 red-team rounds) with a `blockers.md` escalation instead of infinite churn.
- **`NOT_VERIFIED` as a first-class status.** Fail closed; never claim a gate you couldn't evaluate. Rule 7 in `pipeline/README.md` §3.
- **"NEVER state 'no vulnerabilities'"** in the final report — only what was tested, how many rounds, what remains unverified.

### 2.2 The spec template

`pipeline/templates/SPEC.template.md` is the strongest single document in v1: 14 sections including an information-flow table (datum × entry point × trust × validation × storage × readers × sinks × retention × deletion), an authorization matrix with default-deny, a state-coverage table (empty/loading/error/partial/offline/denied/first-run), an abuse-case table keyed to SEC ids, an error catalog, and slices with a walking skeleton as slice 0.

Its requirements use EARS statements plus Given/When/Then plus a named test file — which is exactly what makes the traceability tool possible.

### 2.3 The one tool: `pipeline/tools/trace-check.mjs`

75 lines of regex: parse `### REQ|SEC|NFR-nnn` headings, require Priority/Statement/Acceptance/Test level/Done-when, lint six weasel words, then scan test files for `@req ID` **anywhere in the text**.

I reproduced v1's three known failure modes **[ran]**:

| Fixture | v1 result |
|---|---|
| `// @req SEC-001` over `it.skip(..., () => {})` — a skipped, assertion-free P0 security test | `RESULT: PASS`, exit 0 |
| `expect(1).toBe(1); /* @req SEC-001 */` — tautology, tag in a trailing comment | `RESULT: PASS`, exit 0 |
| Spec with zero requirement headings, empty `tests/` | exit 1, and **prints no reason at all** (the message is appended to `problems` after the print loop) |

So the repo's own central criticism is accurate, and the reasoning is sound: a builder under time pressure can satisfy the gate with comments.

### 2.4 Red team (08)

This is the most sophisticated prompt. It takes Cloudflare's 6-phase `security-audit-skill` and bolts on Trail of Bits lenses (`spec-to-code-compliance`, `sharp-edges`, `variant-analysis`, `differential-review`, `fp-check`, `insecure-defaults`, `supply-chain-risk-auditor`, `post-patch-validation`). Its invariants:

- hunters start from a **concrete invariant** (lower-trust principal → accepted value → expected control → trace → smallest observable effect), not from "find bugs";
- a candidate is only `confirmed` with a complete source trace **and** an observed result **and** a deterministic failing reproduction test;
- the hunter never verifies its own candidate; coverage critics look for unexamined ledger units;
- `findings.json` is schema-validated; malformed agent output is discarded, not repaired.

The weaknesses the repo itself admits (and which I agree with) are captured as findings in the v2 review rather than papered over.

---

## 3. Layer v2 — the review

`comprehensive-development-lifecycle-prompts/content/REVIEW-AND-V2.md` is an unusually honest document. It opens by stating what the author **did not** do (never ran the pipeline on a real brief; read only the Cloudflare README, not `HUNTING.md`; never measured cost or time), then gives 15 findings each with an ID, evidence, and a concrete amendment.

The four high-severity findings are the right ones:

| ID | Problem | Why it matters |
|---|---|---|
| **R-01** | `trace-check` counts a comment as coverage | The pipeline's only mechanical traceability gate is gameable — I confirmed it **[ran]** |
| **R-02** | Core rules ("never weaken a test", "never pass a gate from memory") are prose enforced by the agent that benefits from breaking them | No mechanism at all |
| **R-03** | Stop rule can be satisfied by a diff-only round that cannot see most of the code | v1 orchestrator says "re-run 08 on the diff", which yields zero findings almost by construction |
| **R-04** | The pipeline has no threat model for itself | Phase 01 reads Reddit/HN/GitHub issues with an agent that has shell + file write; phase 06 installs dependencies with install scripts in an env holding `DATABASE_URL` |

The remaining findings are medium/low and mostly correct: self-attested coverage (R-08), the `needs_validation` bucket swallowing whole bug classes (R-09), nothing measuring whether the red team works (R-10), security checks arriving late (R-11), design being paper-only (R-12), no human checkpoint on the thesis (R-13), no deploy verification or retrospective (R-14).

Two clever additions:

- **Capture–recapture stop rule.** Two independent FULL hunts, `N̂ = (nA+1)(nB+1)/(m+1) − 1`, stop only if a FULL round finds nothing new **and** expected remaining ≤ 1. The document states the estimator's independence assumption and calls its own number optimistic.
- **Evidence tiers.** T1 executed test / T2 bounded stress (≥20 seeds, rate recorded) / T3 static proof with two verifiers and a Medium severity ceiling — a genuine fix for the fact that races and resource exhaustion can't always be proved by one assertion.
- **Planted-bug calibration.** Inject 8–12 known vulnerabilities on a throwaway branch, run the red team blind, report recall per class; below 0.7 the report must say "red team inconclusive". This is the only thing in either version that measures the detector.

## 4. Layer v2 — the amended prompts

Six prompts, each explicitly labelled **BUILT** or **SPECIFIED**:

| File | Content | Status |
|---|---|---|
| `v2-00-guardrails.md` | Pipeline threat model, per-phase sandbox profile, protected paths, hash-chained `gate-ledger.jsonl`, budgets, `--ignore-scripts`, a verbatim prompt-injection rule | SPECIFIED |
| `v2-01-research-quarantine.md` | Reader agent (web only, **no shell, no file write**) returns JSON → snapshot script → `quote-verify` substring check → synthesiser that never sees raw pages | SPECIFIED |
| `v2-05-test-integrity-and-tripwire.md` | `trace-check-v2` + frozen baseline; per-slice tripwire (tsc, lint, build, Semgrep, gitleaks, osv, incremental mutation, skeleton); fresh differential review on boundary slices | baseline mode BUILT, tripwire SPECIFIED |
| `v2-08-redteam.md` | Deterministic floor (SAST/DAST/fuzz/entry-point enumerator), scripted coverage gate, cross-model verifiers, evidence tiers, FULL/DIFF rounds + Chapman stop | SPECIFIED |
| `v2-11-deploy-verify.md` | Build-id identity, migrations against a data copy, rollback drill, an alert fired on purpose, headers on the real origin | SPECIFIED |
| `v2-12-pipeline-eval.md` | Raw metrics from the gate ledger, planted-bug calibration, retro, evidence-linked prompt changes | SPECIFIED |

The discipline of labelling what is built vs specified is the single most trustworthy thing in this repo — and the review says so itself: *"Most v2 controls are specified, not built. Until each has a self-test like trace-check-v2, treat it as a prompt, not a gate."*

## 5. Layer v2 — `trace-check-v2.mjs` (the one built thing)

134 lines, plus a 51-line self-test. Six changes over v1, each with a fixture:

1. a `@req` tag only counts on its own comment line (`^[ \t]*(//|/*|*)` …), not trailing code;
2. a tagged file needs ≥1 real assertion (`expect(`, `assert(`, `should.`, `fc.assert(`);
3. `skip/todo/fixme/fails/xit/xfail` inside a tagged file is an **error**, never coverage;
4. tautologies (`expect(1).toBe(1)`) are counted and excluded;
5. zero requirements prints why;
6. `--baseline` / `--check-baseline` freezes assertions-per-file so later gates fail on deletions, lost assertions and new skips.

Verified **[ran]**: the self-test reports all 7 behaviours as expected (exit 0), and on my own fixtures v2 fails all three cases that v1 passes, with a specific reason line for each. The weasel list grew from 6 to 11 terms and is scoped to the Statement.

The honest limits: it is regex, not AST; a determined agent can write `expect(x).toBeDefined()` everywhere; the self-test asserts exit codes only, so a case could fail for the wrong reason. All three are stated in the review. I found one more (F-11).

## 6. Layer v2 — "The Line" app

A Next.js 16 / React 19 / Drizzle / Postgres dashboard that presents the whole review. It is not a template — it has a deliberate visual identity (drafting paper `#efe8d8`, Barlow Condensed signage, Newsreader prose, IBM Plex Mono, railway-signalling metaphors) and a stated accessibility posture (contrast ratios documented per token, `:focus-visible` rings, `prefers-reduced-motion`, keyboard handlers on SVG nodes, `aria-live` on status text).

**Six tabs:**

| Tab | Content | Data/logic |
|---|---|---|
| A **Map** | SVG pipeline map, v1/v2/diff modes, clickable stations and gate squares, "Send a build" packet animation | `STATIONS`, `GATES`, `TRAVEL_ORDER` |
| B **Trace a defect** | 12 defects, each with catches in v1 and v2, verdict Prevented / Stopped / Late / Escapes | `outcome()` in `src/lib/outcome.ts` |
| C **Who enforces it** | Slope chart placing each rule on a Prose → Judgement → Mechanical (gameable) → Mechanical (hardened) ladder | `RULES` |
| D **Red team** | 9-phase zoom, FULL vs DIFF round visualisation, live Chapman estimator | `chapman()` in `src/lib/estimator.ts` |
| E **Review** | All 15 findings, severity filter, evidence + fix, "keep" list | `FINDINGS`, `KEEP` |
| F **Prompts** | The six v2 prompts + tool source, copy and download | `content-manifest.ts` allowlist |

**Backend:** one table `gate_status` (PK `gate`, `status`, `note`, `updated_at`). `GET /api/gates` (optionally `?download=1` → `progress.json` attachment) and `PUT /api/gates` to record your own gate marks. Content is served by `/api/content/[slug]` with `force-static` + `generateStaticParams` over an allowlist, `text/plain` + `nosniff` + `Content-Disposition: attachment`.

**Security worth praising** (this is the app demonstrating the framework's own rules):
- strict allowlist parser rejects unknown keys rather than ignoring them (no mass assignment), rejects `__proto__`, strips control characters, caps the note at 280;
- body limit enforced on bytes **actually read**, not on the spoofable `Content-Length` (there is a test that lies about the header);
- same-origin check on PUT, `Content-Type: application/json` required (a form post can't change the board), `Cache-Control: no-store`;
- no stack traces or SQL in error bodies (asserted by a test with a regex on the response);
- SQL injection test stores `'); drop table gate_status; --` as a literal note;
- `next.config.ts` sets CSP, `nosniff`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`, `poweredByHeader: false`.

**Tests (26 total):** `estimator.test.ts` (6, pure math incl. "two empty runs are not proof of a clean codebase"), `pipeline-data.test.ts` (17, self-consistency), `gates.test.ts` (9, real Postgres, refuses to run unless the DB name ends `_test`).

The standout idea is in `pipeline-data.test.ts`: the app **tests its own honesty**. Findings must match the headings in `REVIEW-AND-V2.md` both ways; severity and BUILT flags must agree with the document; v2 may never score weaker than v1 on any defect; exactly one rule may be labelled "built"; at least one defect must escape v1 and none may escape v2. That is the repo applying its own thesis to its own marketing surface.

---

## 7. What I ran **[ran]**

| Command | Result |
|---|---|
| `node content/tools/trace-check-v2.selftest.mjs` | 7/7 behaviours as expected, exit 0 |
| v1 vs v2 `trace-check` on 3 fixtures | v1 PASSes the skipped test and the tautology; v2 fails both with reasons; v1 on a zero-requirement spec exits 1 silently, v2 prints the reason |
| `npm ci` (nested) | 427 packages, 16s, exit 0 |
| `npx tsc --noEmit` (nested) | clean, exit 0 |
| `npx eslint .` (nested) | clean, exit 0 |
| `npx next build` **without** `DATABASE_URL` | **fails** — see F-03 |
| `npx next build` **with** a `DATABASE_URL` | clean; 11 routes; `/api/content/*` prerendered (9 paths), `/` and `/api/gates` dynamic |
| `vitest run` on `estimator` + `pipeline-data` (temp config, no DB) | 23/23 pass in 346ms |
| `next start` + `curl` | `/` → 200, 84 KB; security headers present; `/api/content/v2-08` → 200; `/api/content/..%2F..%2Fpackage.json` → 404; `/api/health` → 500 (no DB, as expected) |

---

## 8. Findings against the repo (F-nn)

These are **additional** to R-01…R-15, which are the repo's critique of itself. Severity is about how likely the repo is to mislead or block its user.

### F-01 · High (structural) · Two apps, two configs, and the wrong one is documented
The root is a starter (`name: sdlc-framework`) with `src/app/page.tsx` rendering "Arena Next.js PostgreSQL Starter". The Line lives one directory down with its **own** `package.json` (still named `nextjs-postgresql-template`), its own lockfile, tsconfig, eslint and drizzle config. The root README describes `pipeline/` and `src/` and never mentions the nested folder; `pipeline/README.md` contains the string "v2" zero times.

Consequences: no root lockfile, so `npm ci` at the root is impossible; `git clone && npm install && npm run dev` gives a starter page, not the deliverable; there are two `drizzle.config.json` and two `.gitignore`s; any CI added later will test the wrong directory. **Fix:** either promote the nested app to the root, or turn the root into an npm workspace and make the README's first paragraph point at the subdirectory.

### F-02 · Medium · The root page has no graceful degradation
`src/app/page.tsx` awaits `db.execute(sql\`select 1\`)` unguarded, so the root page 500s without Postgres, while the nested `page.tsx` wraps `loadGates()` in try/catch and renders fine. The README's verification path (`/api/health`) is fine, but the two apps behave inconsistently. **Fix:** the same try/catch, or a static landing page.

### F-03 · Medium · `next build` hard-fails without `DATABASE_URL`
`src/db/index.ts` throws at module scope when the variable is missing, and Next imports the route module during "Collecting page data" — so the build dies even though every handler catches its own errors. Phase 10 of the framework requires `npm run build` to pass; in CI that silently requires a provisioned Postgres. **Fix:** create the pool lazily behind a function, or move the env read into the handlers.

### F-04 · Medium · The test suite can't be run as shipped
There is **no `test` script** in `package.json`, no `.env.example`, no README in the nested folder, and `vitest.config.ts` `globalSetup` requires a live Postgres plus permission to `CREATE DATABASE`. `gates.test.ts` additionally refuses to run unless the database name ends `_test`. A newcomer has no way to discover any of this short of reading four files. I only got the 23 DB-free tests running by writing a throwaway config. **Fix:** add `"test"`, `"test:db"`, `"db:push"` scripts; an `.env.example`; and either a compose file / testcontainers or a clean skip when `DATABASE_URL` is absent.

### F-05 · Low–Medium · No CI, in a repo whose thesis is mechanical gates
`.github/workflows/` does not exist. Prompts 05, 07 and 10 all assume CI runs lint, typecheck, unit, integration, e2e, a11y and build. The framework that insists gates must be mechanical has no robot enforcing its own. **Fix:** one workflow running `tsc`, `eslint`, the DB-free tests, an ephemeral Postgres service, `next build`, and the `trace-check-v2` self-test.

### F-06 · Low–Medium · Three different G1 thresholds
Root README line 16 and `pipeline/README.md` line 42 both say *"GATE G1: … ≥3 competitors"*. `pipeline/prompts/01-intake-and-research.md` requires **≥5 competitors** and **≥10 verbatim quotes**. `v2-01` requires **≥10 verified quotes from ≥3 distinct domains**. A reader checking the diagram would pass a gate the prompt fails. **Fix:** make the diagram quote the prompt, or link to it.

### F-07 · Low · MIT is claimed but not licensed
The README ends with "## 📜 License — MIT"; there is no `LICENSE` file. **Fix:** add one.

### F-08 · Low · Gate numbering has holes with no explanation
Gates run G0–G5, G7, G9–G12. G6 and G8 never appear and nothing says why. The app's `GATE_IDS` mirrors the gap faithfully, which is consistent but still confusing. **Fix:** one sentence, or renumber.

### F-09 · Low · Packaging nits
`vitest` (^5.1.0) and `server-only` sit in `dependencies` rather than `devDependencies`; the nested package is still named `nextjs-postgresql-template`; there is no `engines` field despite Next 16 / React 19 requirements.

### F-10 · Low · Schema duplication and committed credentials
There is no migrations directory. The table is created by hand-written DDL in `tests/global-setup.ts`, duplicating `src/db/schema.ts`. To its credit, a test compares `information_schema` columns against the Drizzle schema so drift fails — but the duplication remains, and `drizzle.config.json` (both copies) hardcodes `postgres:postgres@127.0.0.1`. **Fix:** commit real Drizzle migrations and have `global-setup` apply them.

### F-11 · Low · `trace-check-v2`'s baseline has a dead field
`--baseline` records `{sha, asserts, skips}` per file, but `--check-baseline` compares only existence, assertion count and skip count. The `sha` is never read. So a file can be rewritten — different tests, same number of `expect(` — and still pass. Coverage is also per-file: one assertion covers every tag in that file. Both are inside the "regex, not an AST" caveat the review already states, but the unused `sha` looks like intended-but-unfinished work. **Fix:** either compare `sha` (strict, noisy) or drop the field; consider per-test-block tag/assertion pairing.

### F-12 · Low · `/api/gates` has no authentication or ownership
CSRF is handled well (origin check, JSON-only, byte cap, allowlist parser), but anyone who can reach the deployment can rewrite every gate. For a single-user local dashboard that is a defensible choice — it just needs to be stated, and the app should not be deployed publicly as-is.

### F-13 · Low · The CSP would fail the framework's own phase 04
`script-src 'self' 'unsafe-inline'` (documented in a comment), no HSTS, no nonce. `X-Frame-Options: DENY` plus `frame-ancestors 'none'` is redundant. Fine for a local dashboard; inconsistent with `04`'s nonce-based CSP requirement.

### F-14 · Low · The framework ships no worked example
There is no `docs/` directory, no example `brief.md`, no example SPEC, no example evidence ledger. The README says "Place project brief in `docs/00-intake/brief.md`" and nothing creates it. The only executable artefact is the tool self-test. For a framework whose value is procedural, that means every user must invent the folder tree and the first spec before seeing anything work. **Fix:** ship `examples/mini-app/` with a brief, a 10-requirement SPEC generated from the template, three tagged tests, and a passing `trace-check-v2` run.

---

## 9. NOT_VERIFIED (what I could not do here)

- **Database paths.** No Postgres in this sandbox, so `tests/gates.test.ts` (9 tests), the migration path, and `/api/gates` round-trips were not executed. The API logic was read, and its RS256-free, allowlist-based design looks correct.
- **Browser.** No Playwright/axe run, no screenshots at 360/768/1280, so the visual claims (contrast ratios, keyboard map, reflow) are from the source, not from rendered pixels.
- **The pipeline itself.** I did not run 01→10 on a real brief. Nothing here measures whether v1 or v2 produces a good product — which is precisely what the repo's own R-10 and `v2-12` say is missing, and which the review also admits.
- **Planted-bug calibration.** Not run; it requires a finished product and a second model family.
- **Skill integrations.** The Cloudflare and Trail of Bits skills are not installed here, so 08's sub-phases were assessed as documents, not executed.

---

## 10. Verdict

**On the framework (v1):** a strong, unusually well-informed process document. The genuinely good ideas are artifacts-as-interface, builder ≠ verifier, threat-model-before-code, canary-based information-flow tests, bounded loops, and `NOT_VERIFIED`. The structural weakness is the one the repo identifies itself: almost every gate is prose, and the single mechanical gate is a comment matcher.

**On the critique (v2):** the best part of the repository. Fifteen findings, each with evidence and a fix, explicit about what was and wasn't done, with a clear built-vs-specified boundary. The additions that matter are the deterministic floor, the script-enforced coverage subset, evidence tiers, FULL/FULL/FULL|DIFF rounds with a capture–recapture stop rule, cross-model verifiers, pipeline self-hardening (`v2-00`), and planted-bug calibration.

**On the engineering:** the one built tool is small, self-tested, and demonstrably better than what it replaces; the app that presents it is well designed, has real security tests, and — unusually — tests that it never overstates its own evidence.

**What to fix first, in order:**

1. Resolve F-01. Decide which app is the repo and make the README, lockfile and scripts agree. Right now the best material is invisible and the obvious entry point is the starter.
2. F-03 + F-04 + F-05: make `build` and `test` work from a clean clone, and put CI in front of them. A repo about mechanical gates should have one.
3. F-06 + F-07: one paragraph and one file.
4. F-14: ship a worked example. The pipeline is currently a manual with no sample output, which is the largest remaining barrier to anyone actually using it.
5. F-11: finish or remove the baseline `sha`, and add stdout assertions to the self-test so it fails for the right reason.

None of these touch the ideas. The ideas are good.

---

## 11. Addendum — what has since been built (2026-11-26)

The review above is the state of the repository at commit `e4690b0`. The v2 layer has since
been **implemented at the pipeline layer**, in this branch. The point of this section is to
let a reader tell the review's claims apart from the current state.

| Finding | Status now |
|---|---|
| F-01 (which app is the repo) | README rewritten: the framework is the repo, the review app is named and documented, and it now serves the canonical `pipeline/` files instead of keeping copies. |
| F-03 (no `test` script) | `test`, `test:watch` and `typecheck` added to the app's `package.json`. |
| F-04 (tests need a live DB) | CI provisions Postgres 16 as a service, so the DB tests actually run on every push. |
| F-05 (no CI) | `.github/workflows/pipeline.yml`: tool self-tests, ledger tamper test, the end-to-end demo, the traceability gate, and the app's typecheck/lint/tests/build. |
| F-06 (G1 drift) | Both READMEs and the diagram now say what the prompt says: verified quotes, ≥5 competitors, ≥10 quotes, ≥3 rejected ideas. |
| F-07 (no `LICENSE`) | MIT `LICENSE` added. |
| F-10 (three copies of one prompt) | `comprehensive-development-lifecycle-prompts/content/prompts/` is gone; the app's allowlist points at `pipeline/prompts/`. `content/tools/` holds import shims, not copies. |
| F-14 (no worked example) | `pipeline/examples/mini-app/` plus `pipeline/tools/demo.mjs`, which walks phases 00 → 12 and exits `RESULT: PASS`. |

**Not fixed, and deliberately so:** F-02 (the repo still contains the starter scaffold) and
F-13 (no root `package.json`) are product decisions, not pipeline-layer work. F-11's remaining
item — the baseline `sha` — is untouched; the v2 baseline is a different file with a different
job (`--check-baseline`), and it does record a content hash.

**The four layers that were "specified, not built" are now built and tested** (see
`pipeline/INTEGRATIONS.md`): cross-model verifier routing (`verifier-route.mjs`,
`independence.mjs`), the sandbox (`sandbox.mjs`: real env scrubbing, isolation, timeouts, a
hardened compose profile with a control validator), DAST/fuzzing (`fuzz-api.mjs`, a real
schema-driven fuzzer tested against a trusting and a strict server, plus `dast.mjs` adapters and
a normaliser tested on real scanner fixtures), and planted-bug calibration (`calibrate.mjs`,
recall per class with the refusals that make the number meaningful).

**Still true of v2 after this work:** it is a pipeline, not a product-grade tool, and four
things can only be finished on your machine — a model credential for the transport (request
shape tested with `--dry-run`), a container runtime for the sandbox profile, the scanner
binaries themselves, and a finished product to calibrate against. Every one of those is
`NOT_VERIFIED` until you do it, and the final report says so, because it is generated from
recorded exit codes. That is the point: the gap is now visible and small, instead of being a
paragraph in a prompt.
