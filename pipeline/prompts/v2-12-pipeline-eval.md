# v2-12 · Pipeline evaluation + planted-bug calibration

Input: `docs/gate-ledger.jsonl`, `docs/blockers.md`, every phase artifact, post-release data if any
Output: `docs/12-eval/{metrics.json, calibration-report.md, retro.md, prompt-changes.md}`
Gate: **G12**.

```bash
node pipeline/bin/pipeline.mjs phase start 12
node pipeline/tools/gate-ledger.mjs show --path docs/gate-ledger.jsonl --json > docs/12-eval/ledger-export.json
node pipeline/bin/pipeline.mjs estimate --a 6 --b 5 --m 4 --write
node pipeline/bin/pipeline.mjs gate G12 --builtin metrics
node pipeline/bin/pipeline.mjs phase done 12
```

ROLE: process analyst. You measure the pipeline. You do not defend it.

## Part 1 · Metrics (`metrics.json`), raw counts only

From the ledger and artifacts, not from memory:

- Time and tool calls per phase; repair loops used; blockers opened.
- Defects by phase of origin vs phase of detection (introduced in 06, found in 08 is a late catch).
- **Gate false-pass candidates:** any defect found later that an earlier gate claimed to cover. List each with the gate id and the recorded exit code.
- Tests: counts per layer, mutation score, flake runs, flow-matrix result.
- Red team: rounds with FULL/DIFF labels, confirmed by tier, rejected, `needs_validation`, the estimate.
- `NOT_VERIFIED` count by cause (no sandbox, no browser, single model family).

Do not compute scores you cannot justify from the data.

## Part 2 · Planted-bug calibration (once per pipeline version, throwaway branch, never merged)

1. Pick a finished product. Branch `calibration/<pipeline-version>`.
2. A **separate agent** that will not take part in the red team plants **8 to 12 vulnerabilities** in code that actually exists, covering classes the app has: IDOR on a `:id` route, mass assignment via spread into `update`, open redirect via `next=`, stored XSS with `dangerouslySetInnerHTML`, missing login rate limit, race on a unique constraint, SSRF in a fetch, a secret in `NEXT_PUBLIC_*`, a verbose error body, CSRF on a cookie-authed mutation, unbounded pagination.
3. The planter writes `planted.json` (class, file, line, description) and **hides it** from the red team.
4. Run `08` in full, unchanged, blind.
5. Recall = planted found ÷ planted, overall and per class. Also classify confirmed findings that were not planted (real bugs vs false positives).
6. Thresholds: overall recall ≥0.7 and no applicable class at 0. Below that, every future report from this pipeline version must say **"red team inconclusive"**, and the `08` prompts are revised before reuse.
7. Write the caveat: planted bugs are usually easier than natural ones, so recall is an upper bound.

`calibration-report.md` records the sample size next to every number. Never report a recall figure without it.

## Part 3 · Retro and prompt changes

- `retro.md`: the five things that cost the most time, the five gates that did the most work, and three gates that never fired (candidates for removal or tightening).
- `prompt-changes.md`: every proposed change to a prompt or tool, tied to a metric or an escaped defect. A change with no evidence behind it is rejected.
- Bump `pipeline/VERSION` after any change to `v2-08`, `v2-09` or the hunters' attack-class blocks, and re-run calibration.

## GATE G12

- [ ] `metrics.json` has raw counts for every item above, or a stated reason
- [ ] Calibration was run for the current pipeline version, or the report says **"not calibrated"**
- [ ] Every proposed prompt change links to evidence
- [ ] No sentence in the report claims a number that is not in `metrics.json`

NEVER: tune the prompts to pass the calibration set (planted bugs rotate each calibration). Never present a zero-finding red team as clean when calibration was never run.
