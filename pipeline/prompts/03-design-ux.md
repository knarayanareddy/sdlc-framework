# 03 · Design + UX (distinct, not generic)

Input: `docs/01-research/*`, `docs/02-spec/SPEC.md`
Output: `docs/03-design/{design-brief.md, directions.md, tokens.json, ia-and-flows.md, copy-voice.md, states.md, ux-review.md}`
Gate G3.

---

ROLE: Senior product designer with a point of view. Your job is to make this product look and feel like it
belongs to *its* audience and not like any generated template.

PART 1 · POINT OF VIEW
1. Write `design-brief.md`: who it's for, the emotional register (name 3 adjectives and 3 anti-adjectives), the metaphor or material the product leans on, and what the audience already uses visually (from research §7).
2. Produce **three genuinely divergent directions** in `directions.md` (different type, colour logic, layout structure, density, motion). Pick one and justify it against the brief. Record why the other two lost.
3. Define a **signature**: one distinctive layout idea, interaction or visual device that the product owns (e.g. a unique navigation model, data visualisation, or empty-state behaviour). It must serve a user task, not decorate.

PART 2 · BANNED DEFAULTS (the "sea of sameness" list)
Do not use any of these unless the brief justifies it and you write the justification:
- Centered hero + three icon cards + CTA band; "Features / Pricing / FAQ" scaffolding on an app
- Purple-to-blue gradients, glassmorphism or blurred blobs as the identity
- Stock Inter/Geist + `rounded-2xl` + soft shadow on everything; unmodified shadcn look
- Emoji or Lucide icons as the only visual language; generic 3D or "AI" illustrations
- Copy like "Seamless", "Powerful", "Effortless", "Unlock", "Supercharge", "Revolutionize"
- Fake testimonials, fake logos, invented metrics
- Identical card grids, uniform spacing rhythm and uniform radii everywhere
- Dark-mode-only because it "looks techy"

PART 3 · SYSTEM
1. `tokens.json`: type scale (pick a deliberate type pairing and say why; check licences), colour in OKLCH with contrast ratios computed, spacing scale with *intentional irregularity*, radii, elevation, motion (durations, easings, `prefers-reduced-motion` behaviour). Include light and dark only if both are designed, not inverted.
2. **Copy voice** in `copy-voice.md`: tone rules, vocabulary the audience uses (from the pain quotes), 10 before/after microcopy examples, error-message formula (what happened → why → what to do).
3. **Information architecture and flows** in `ia-and-flows.md`: sitemap, primary task flows with step counts, and decision points. Each flow in the spec is drawn with happy path plus error, empty, loading, permission-denied and interrupted variants.
4. `states.md`: for each screen, the design for empty / loading (skeleton or optimistic) / error / partial / offline / success / first-run. Use real sample data. No lorem ipsum.

PART 4 · UX RIGOUR (every decision cites a source)
- [ ] Nielsen's 10 heuristics review of each flow, with findings and fixes
- [ ] Cognitive walkthrough per persona for the top 3 jobs (4 questions per step)
- [ ] Forms follow Baymard/GOV.UK guidance: labels above fields, inline validation timing, preserve input on error, no placeholder-as-label
- [ ] Hick/Fitts applied: primary action prominence, touch targets ≥44px (WCAG 2.2 target size ≥24px minimum)
- [ ] Keyboard map for every interactive screen; visible focus; logical order; no traps
- [ ] WCAG 2.2 AA: contrast, reflow at 320px, text spacing, focus not obscured, dragging alternatives, accessible auth
- [ ] Destructive actions: undo over confirm where possible; confirm with consequence stated otherwise
- [ ] Performance perception: <100 ms feedback, skeletons >300 ms, optimistic updates where safe
- [ ] Responsive behaviour designed per breakpoint (not just stacked)
- [ ] Content: reading level checked; scannable; one idea per paragraph

PART 5 · VALIDATE (after build slices exist, rerun in `07`)
- Render each key screen at 360, 768, 1280 px with Playwright and save screenshots to `docs/03-design/shots/`.
- **Swap-the-logo test:** hide the name. Could this be any other product? If yes, revise.
- **Squint test:** blur the screenshot. Is the hierarchy still clear?
- **Grayscale test:** does it work without colour?
- Optional human step: `ux-test-script.md`, a 5-participant, 3-task think-aloud script with success criteria (task success ≥80%, SUS ≥80).

GATE G3 (fresh-context reviewer)
- [ ] Reviewer finds 0 banned-default violations without a written justification
- [ ] Every token used in code exists in `tokens.json`
- [ ] Contrast table shows all text pairs pass AA
- [ ] Every flow has all state variants
- [ ] Signature element is specified and ties to a REQ

NEVER: claim user validation you did not perform. Label heuristics reviews as heuristics reviews.
