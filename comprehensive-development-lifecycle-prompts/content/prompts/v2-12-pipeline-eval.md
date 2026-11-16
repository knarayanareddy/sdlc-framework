# v2-12 · Pipeline Evaluation + Calibration (new phase, runs after each product, and the calibration part once per pipeline version)

Input: `docs/gate-ledger.jsonl`, `docs/blockers.md`, all phase artifacts, post-release data if any
Output: `docs/12-eval/{metrics.json, calibration-report.md, retro.md, prompt-changes.md}`
Status: **SPECIFIED**.

---

ROLE: Process analyst. You measure the pipeline. You do not defend it.

## Part 1 · Metrics (per product, from the ledger and artifacts, no estimates)

Record raw counts. Do not compute scores you cannot justify.
- Time and tool calls per phase; repair loops used; blockers opened.
- Defects found per phase of origin vs phase of detection (a defect introduced in 06 and found in 08 is a late catch).
- Gate false-pass candidates: any defect found at a later phase that an earlier gate claimed to cover. List each with the gate id.
- Tests: counts per layer, mutation score, flake runs, flow-matrix result.
- Red team: rounds, FULL vs DIFF, confirmed by tier, rejected, `needs_validation`, Chapman estimate.
- `NOT_VERIFIED` count by cause (no sandbox, no browser, single model family).
- Post-release (when available): escaped defects reported by users, with the phase that should have caught each.

## Part 2 · Planted-bug calibration (once per pipeline version, on a throwaway branch that is never merged)

1. Pick a finished product. Create branch `calibration/<pipeline-version>`.
2. A **separate agent** that will not take part in the red team plants **8 to 12 vulnerabilities** in code that actually exists, covering classes the app has. For example: IDOR on a `:id` route, mass assignment via spread into `db.update`, open redirect via `next=`, stored XSS sink with `dangerouslySetInnerHTML`, missing rate limit on login, race on a unique constraint, SSRF in a fetch, secret in `NEXT_PUBLIC_*`, verbose error body, CSRF on a cookie-authed mutation, unbounded pagination.
3. The planter writes `planted.json` (class, file, line, description) and **hides it** from the red team.
4. Run `08` in full, unchanged, blind.
5. Score recall = planted found ÷ planted, overall and per class. Also count confirmed findings that were not planted (real bugs or false positives: classify each).
6. Thresholds: overall recall ≥ 0.7 and no applicable class at 0. Below that, every future report from this pipeline version must say **"red team inconclusive"**, and `08` prompts are revised before reuse.
7. Caveat to write into the report: planted bugs are usually easier than natural ones, so recall is an upper bound.

## Part 3 · Retro and prompt changes

- `retro.md`: 5 things that cost the most time, 5 gates that did the most work, 3 gates that never fired (candidates for removal or tightening).
- `prompt-changes.md`: every proposed change to a prompt or tool, tied to a metric or an escaped defect. A change with no evidence behind it is rejected.
- Version the pipeline (`pipeline/VERSION`). Re-run calibration after any change to `08`, `09` or the hunters' attack-class blocks.

GATE G12
- [ ] `metrics.json` has raw counts for every item above, or a stated reason
- [ ] Calibration was run for the current pipeline version, or the report says "not calibrated"
- [ ] Every proposed prompt change links to evidence
- [ ] No sentence in the report claims a number that is not in `metrics.json`

NEVER: tune prompts to pass the calibration set (planted bugs are rotated each calibration). Never report a recall figure without the sample size.
