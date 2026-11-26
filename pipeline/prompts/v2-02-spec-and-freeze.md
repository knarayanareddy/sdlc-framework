# v2-02 · Spec authoring, decision digest and freeze

Input: `docs/00-intake/*`, `docs/01-research/*`, `pipeline/templates/SPEC.template.md`
Output: `docs/02-spec/{SPEC.md, DECISIONS.md, SPEC.sha256}`, `docs/02-spec/CHANGES.md` (only when the spec changes after freeze)
Gates: **G2**, then the digest (phase `H1`), then the freeze (phase `FZ`).

```bash
node pipeline/bin/pipeline.mjs phase start 02
node pipeline/bin/pipeline.mjs gate G2 --builtin trace:structure
node pipeline/bin/pipeline.mjs phase done 02

node pipeline/bin/pipeline.mjs phase start H1 && node pipeline/bin/pipeline.mjs phase done H1   # needs DECISIONS.md

# FZ does NOT run here. It needs H1 done AND G3 (phase 03) and G4 (phase 04) recorded,
# so freeze happens after design and architecture, not straight after the spec:
#   phase 03 → gate G3 → phase 04 → gate G4 → phase start FZ → phase done FZ
node pipeline/bin/pipeline.mjs phase start FZ && node pipeline/bin/pipeline.mjs phase done FZ   # hashes SPEC.md
```

ROLE: staff engineer writing the contract that builders and testers are both held to.

## Rules

1. **Every requirement is a `### REQ-nnn`, `### SEC-nnn` or `### NFR-nnn` heading** with Priority (P0/P1/P2), Rationale (cite `E-nn` or `A-nn`), Statement in EARS form ("When <trigger>, the system shall <response>"), **Acceptance** as Given/When/Then, Test level (unit | integration | e2e | security), and Done-when. `trace-check-v2` enforces all six fields.
2. **No weasel words.** `trace-check-v2` rejects eleven in the Statement: fast, robust, user-friendly, secure, scalable, intuitive, seamless, appropriate, reasonable, efficient (and their inflections). Replace each with a number or an observable behaviour.
3. **Information-flow table (mandatory).** For every datum: source, trust, validation (schema, max size, charset), storage, readers, render/log sinks, retention, deletion path.
4. **Every state has a spec:** empty, loading, error, partial failure, offline/timeout, permission denied, first-run, rate-limited, concurrent edit.
5. **Data model** with constraints, indexes and an ownership column; **API contract** with request/response schemas, status codes, error shape, idempotency, pagination and rate limits.
6. **Authorization matrix:** role × resource × action, default deny.
7. **Abuse cases:** for each P0 feature, what a hostile user does, mapped to a SEC id.
8. **Slices.** Slice 0 is a walking skeleton. Each slice lists the REQ ids it delivers, its demo script and its definition of done.
9. **Out of scope** and **open questions, each with a default decision**.
10. **Traceability:** every requirement names the test file that will prove it (created in `05`).

## Decision Digest (phase H1)

`docs/02-spec/DECISIONS.md`: one page with the thesis, the top 5 assumptions and the scope in/out. Mark it `unreviewed` unless a human answers. The pipeline does not block; the final report lists unreviewed decisions. This is the only cheap human checkpoint at the highest-leverage decision.

## Spec freeze (phase FZ)

`phase done FZ` hashes `SPEC.md` to `docs/02-spec/SPEC.sha256`. Later edits fail until they are justified:

```bash
# write the change note first: what changed, why, which tests it affects
node pipeline/bin/pipeline.mjs freeze --refreeze
```

A spec that drifts silently is a spec nobody is held to.

## GATE G2

- [ ] `node pipeline/tools/trace-check-v2.mjs docs/02-spec/SPEC.md tests --allow-uncovered` exits 0 and says `PASS (structure only; not a coverage claim)` — tests do not exist yet at freeze, so this is the only phase where the flag is legitimate.
- [ ] A **fresh-context reviewer** tries to write a test for every requirement. Any requirement it cannot test is rewritten.
- [ ] Reviewer lists contradictions between requirements, the info-flow table and the data model. Count must be 0.
- [ ] A P0 requirement exists for every thesis claim.
- [ ] `DECISIONS.md` exists (H1), and the spec is frozen (FZ).

NEVER: describe implementation where behaviour will do. The spec says what; `04` says how.
