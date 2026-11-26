# v2-03 · Design + UX, with a rendered spike before the spec is frozen

Input: `docs/01-research/*`, `docs/02-spec/SPEC.md`
Output: `docs/03-design/{design-brief.md, directions.md, tokens.json, ia-and-flows.md, copy-voice.md, states.md, ux-review.md, spike/}`
Gate: **G3**.

```bash
node pipeline/bin/pipeline.mjs phase start 03
node pipeline/bin/pipeline.mjs gate G3 --evidence docs/03-design/design-brief.md,docs/03-design/tokens.json
node pipeline/bin/pipeline.mjs phase done 03
```

`--evidence` records a judgement gate: the files must exist and be substantive, and a fresh reviewer still reads them. G3 is the only gate `--evidence` can close — every other gate has to run a command. If you can make part of it mechanical, do: a token lint (`no colour or spacing in code that is not in tokens.json`) is the obvious candidate.

ROLE: senior product designer with a point of view. The product must look like it belongs to its audience, not to a template.

## 1 · Point of view

`design-brief.md`: who it is for, the emotional register (three adjectives and three anti-adjectives), the metaphor or material the product leans on, and what the audience already uses visually (from research class 7).

`directions.md`: **three genuinely divergent** directions — different type, colour logic, layout structure, density, motion. Pick one and justify it against the brief. Record why the other two lost.

**Signature:** one distinctive layout idea, interaction or visual device the product owns. It must serve a user task, not decorate. Tie it to a REQ.

## 2 · Banned defaults

Do not use any of these unless the brief justifies it in writing:

- Centered hero + three icon cards + CTA band; "Features / Pricing / FAQ" on an app
- Purple-to-blue gradients, glassmorphism, blurred blobs as the identity
- Stock Inter/Geist + `rounded-2xl` + soft shadow on everything; unmodified shadcn look
- Emoji or Lucide icons as the entire visual language; generic 3D or "AI" illustrations
- "Seamless", "Powerful", "Effortless", "Unlock", "Supercharge", "Revolutionize"
- Fake testimonials, fake logos, invented metrics
- Identical card grids, uniform spacing and radii everywhere
- Dark-mode-only because it "looks techy"

## 3 · System

`tokens.json`: type scale (name the pairing and check licences), colour in OKLCH with **computed** contrast ratios, spacing with intentional irregularity, radii, elevation, motion (durations, easings, `prefers-reduced-motion`). Light and dark only if both are designed, not inverted.

`copy-voice.md`: tone rules, the audience's own vocabulary (from the verified pain quotes), ten before/after microcopy examples, and an error formula (what happened → why → what to do).

`ia-and-flows.md` and `states.md`: sitemap, task flows with step counts and decision points, and every screen in every state from the spec (empty, loading, error, partial, offline, success, first-run). Real sample data. No lorem ipsum.

## 4 · The spike (new; this is what moves design earlier)

Before G3, render the signature element plus the empty and error states with real sample data as a static prototype in `docs/03-design/spike/`, and screenshot it at 360 px and 1280 px. A design that only exists in prose drifts the moment implementation starts (R-12).

## 5 · UX rigour (every decision cites a source)

- [ ] Nielsen's 10 heuristics, per flow, with findings and fixes
- [ ] Cognitive walkthrough per persona for the top 3 jobs
- [ ] Forms follow Baymard/GOV.UK: labels above fields, inline validation timing, preserve input on error, no placeholder-as-label
- [ ] Touch targets ≥44 px (WCAG 2.2 target size ≥24 px minimum); primary action prominence
- [ ] Keyboard map per screen: visible focus, logical order, no traps
- [ ] WCAG 2.2 AA: contrast, reflow at 320 px, text spacing, focus not obscured, dragging alternatives, accessible auth
- [ ] Destructive actions: undo over confirm; otherwise confirm with the consequence stated
- [ ] Feedback under 100 ms; skeletons above 300 ms; optimistic updates only where safe
- [ ] Responsive behaviour designed per breakpoint, not merely stacked
- [ ] Reading level checked; scannable; one idea per paragraph

## GATE G3 (fresh reviewer, different model family where available)

- [ ] 0 banned-default violations without a written justification
- [ ] Every token used in code exists in `tokens.json`
- [ ] The contrast table shows all text pairs passing AA
- [ ] Every flow has all state variants
- [ ] The spike exists at both widths and matches the signature element described
- [ ] Signature element ties to a REQ

NEVER: claim user validation you did not perform. Label a heuristics review as a heuristics review.
