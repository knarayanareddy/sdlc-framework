# Worked example: a 3-requirement CRUD slice

This directory is not part of the framework. It exists so that the pipeline can be
**run** rather than only read: `node pipeline/tools/demo.mjs` copies it to a temp
directory and walks phases 00 → 12, running every gate for real.

It is deliberately tiny, and it is honest about it:

- **Real:** the SPEC is valid per `trace-check-v2`; the tests execute under `node --test`;
  the entry-point enumerator and the coverage gate read real source; `findings.json`
  references a real reproduction test.
- **Checked against itself:** `plan-check` at G4 matches the threat model and the
  authorization matrix against the spec and the enumerated entry points, and `plan:slices` at
  `phase done 06` requires every `REQ-*`/`SEC-*`/`NFR-*` to be delivered by a slice log
  (`docs/06-build/slice-01.md`, `slice-02.md`).
- **Faked, and labelled as such:** the research quotes come from a fixture page in
  `docs/01-research/sources/` fetched over `file:`, so the demo needs no network. The
  coverage ledger is hand-written for every entry point the enumerator finds — a real run has
  hunters fill it in. There is no browser, so G11 is recorded `NOT_VERIFIED` with the command a
  human should run. `docs/12-eval/metrics.json` ships as a `computed: false` placeholder; the
  demo's G12 replaces it with a file computed from the ledger.

Run the whole thing:

```bash
node pipeline/tools/demo.mjs
```

Run it yourself in place (this writes into this directory):

```bash
node pipeline/bin/pipeline.mjs --cwd pipeline/examples/mini-app init
node pipeline/bin/pipeline.mjs --cwd pipeline/examples/mini-app status
```
