# Slice 01 — REQ-001, REQ-002, SEC-001

Red: `node --test tests/items.test.mjs` failed (canRead did not exist).
Green: `src/lib/can-read.mjs` added; tests pass.
Tripwire: run `node pipeline/bin/pipeline.mjs gate G5 --builtin trace:check` and
`node pipeline/tools/tripwire.mjs --config pipeline.config.json` before commit.
Commit: `slice 01: item scoping and read state [REQ-001 REQ-002 SEC-001]`.
No TODO, no fake data in a production path.
