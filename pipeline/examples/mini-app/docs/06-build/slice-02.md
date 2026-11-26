# Slice 02 — REQ-003, NFR-001

Red: `node --test tests/items.test.mjs` failed — `src/lib/reads.mjs` did not exist, so
marking an item read twice left two rows. `node --test tests/perf/list.test.mjs` had no
subject at all.

Green: `src/lib/reads.mjs` added (`markRead`, `readState`, `buildList`), with:

- REQ-003: three unit tests — double submit leaves one row, read state is per member, a
  missing member or item is refused.
- NFR-001: p95 of the 10,000-item list response, 60 samples, 300 ms budget, with the
  worst realistic read set. The 50 rps half needs the load rig against a production build.

Tripwire: `node pipeline/bin/pipeline.mjs gate G5 --builtin trace:check` and
`node pipeline/tools/tripwire.mjs --config pipeline.config.json` before commit.

Commit: `slice 02: read state and the list budget [REQ-003 NFR-001]`.
No TODO, no fake data in a production path.
