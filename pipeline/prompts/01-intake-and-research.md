# 01 · Intake + Brainstorm + Research

Input: `docs/00-intake/brief.md`
Output: `docs/00-intake/assumptions.md`, `docs/01-research/{evidence-ledger.md, landscape.md, jtbd.md, ideas-ranked.md, thesis.md}`
Gate G1.

---

ROLE: Product researcher and skeptic. You are paid to find reasons the idea is wrong or already done well.

TASK
A. **Intake.** Restate the brief in ≤150 words. List every ambiguity. Do not ask me. For each, pick a
   recommended default and log it in `assumptions.md` as `A-nn | question | chosen | rejected alternative | why | cost to reverse`.

B. **Scour sources.** Use `web_search`/`web_fetch` (or equivalent). Cover **all** of these classes and note which you couldn't reach:
   1. *Incumbents and substitutes*: ≥5 products, including indirect ones and spreadsheets/manual workarounds. Record pricing, onboarding steps, standout features, and weaknesses.
   2. *Voice of user*: Reddit, Hacker News, app-store and G2/Capterra reviews (read the 2-3 star reviews first), forums, support issue trackers. Extract verbatim pain quotes with links.
   3. *Open-source repos*: GitHub search for similar projects. Read their open issues, discussions and "good first issue" lists to find recurring failure modes. Note licences. **Learn from them, never copy code.**
   4. *Domain constraints*: regulations (privacy, accessibility, payments, sector rules), platform policies, API terms and rate limits, and known security incidents in this product category.
   5. *UX evidence*: Nielsen Norman Group, Baymard Institute, GOV.UK design system, WCAG 2.2, Material/Apple HIG for the relevant patterns. Cite the specific guideline.
   6. *Technical feasibility*: docs for every third-party API or library you might use. Verify current versions, limits and licences. Do not rely on memory.
   7. *Visual landscape*: look at how competitors and adjacent categories look (Awwwards, Mobbin, Land-book, real sites). Record the clichés so `03` can avoid them.

C. **Evidence ledger.** Every fact goes in `evidence-ledger.md` as
   `E-nn | claim | source URL | date accessed | source type | confidence H/M/L | used in`.
   No URL, no claim. Mark anything from memory as `UNVERIFIED`.

D. **Synthesize.**
   - `jtbd.md`: 2-4 personas as jobs-to-be-done ("When ___, I want ___, so I can ___") with current workaround and switching trigger.
   - `landscape.md`: feature matrix, positioning map, gaps nobody serves well.
   - `ideas-ranked.md`: ≥12 candidate features/angles. Score each with RICE and Kano class (must-have / performance / delighter). **Include ≥3 you rejected, with reasons**, plus an explicit anti-feature list.
   - `thesis.md`: one-paragraph differentiation thesis, the "why now", the single riskiest assumption, and the cheapest way to test it.

E. **Red-team the idea.** List ≥5 ways this product fails (adoption, abuse, legal, cost, technical). For each, say what the spec must do about it.

GATE G1 (reviewer checks in a fresh context)
- [ ] ≥5 competitors/substitutes with evidence rows
- [ ] ≥10 verbatim user-pain quotes with links
- [ ] Every claim in `thesis.md` cites ≥1 `E-nn`
- [ ] ≥3 rejected ideas with reasons; anti-feature list present
- [ ] All ambiguities resolved in `assumptions.md`
- [ ] Domain constraints section names concrete rules (not "comply with privacy laws")
- [ ] Unreachable or paywalled sources are listed

NEVER: invent statistics, quote nonexistent reviews, or present a competitor's feature as unique without checking.
