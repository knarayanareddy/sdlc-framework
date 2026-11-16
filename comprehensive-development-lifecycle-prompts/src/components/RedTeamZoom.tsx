"use client";

import { useState } from "react";
import { chapman } from "@/lib/estimator";
import type { Mode } from "@/lib/pipeline-data";

interface Node {
  id: string;
  label: string;
  v2only?: boolean;
  changed?: boolean;
  text: string;
  v2text?: string;
}

const NODES: Node[] = [
  { id: "floor", label: "Floor", v2only: true, text: "", v2text: "Scripts, not models: Semgrep/CodeQL, osv, gitleaks, ZAP or Nuclei against the sandboxed production build, Schemathesis against the contract, and an entry-point enumerator. Output is leads, never findings." },
  { id: "recon", label: "Recon", changed: true, text: "Map the code (not the docs): entry points, trust boundaries, authN/authZ, data stores. Diff against the threat model. Write architecture.md and coverage-ledger.json.", v2text: "Same, plus entrypoints.json from the enumerator. Gate by script: every enumerated entry point must appear in the ledger as examined or excluded with a reason." },
  { id: "hunt", label: "Hunt waves", changed: true, text: "One isolated hunter per group of ledger units, each starting from a concrete invariant. Trail of Bits lenses: sharp-edges, variant-analysis, insecure-defaults. Critics (fresh) list unexamined units; repeat until no material gap.", v2text: "Same, and each hunter confirms, refutes or defers every scanner lead assigned to its units. Critics run on top of the script-checked floor, not instead of it." },
  { id: "verify", label: "Disprove", changed: true, text: "A fresh verifier who did not hunt tries to refute each candidate. Verdicts: confirmed, needs_validation, rejected.", v2text: "Verifier from a different model family where available, with the family logged. If only one family exists, the run is labelled NOT_VERIFIED: single-model-family." },
  { id: "repro", label: "Repro test", changed: true, text: "Every confirmed finding gets a deterministic failing test in tests/security/. No test means needs_validation.", v2text: "Evidence tiers. T1 executed test. T2 bounded stress: ≥20 seeds, failure rate recorded (races, resource exhaustion). T3 static proof with controls-checked list and two verifiers, Medium ceiling." },
  { id: "schema", label: "findings.json", text: "Write findings to the skill's schema. validate-findings.cjs must pass. Malformed agent output is discarded, not repaired." },
  { id: "record", label: "Record verify", text: "Fresh agents re-check every final claim against source. Any substantive edit goes to yet another fresh verifier." },
  { id: "report", label: "Report", text: "REPORT.md, FINDINGS-DETAIL.md and NEEDS-VALIDATION.md derived from verified records only.", v2text: "Report must name which rounds were FULL and which DIFF, print the capture–recapture estimate, and state the verifier model family." },
  { id: "calib", label: "Calibrate", v2only: true, text: "", v2text: "Phase 12, once per pipeline version: plant 8–12 known bugs on a throwaway branch, run blind, report recall per class. Below 0.7 overall, or 0 for an applicable class, the report says 'red team inconclusive'." },
];

const ROUNDS = {
  v1: [
    { name: "Round 1", kind: "FULL" as const },
    { name: "Round 2", kind: "DIFF" as const },
    { name: "Round 3", kind: "DIFF" as const },
  ],
  v2: [
    { name: "Round 1", kind: "FULL" as const },
    { name: "Round 2", kind: "FULL" as const },
    { name: "Round 3", kind: "FULL" as const, alt: "or DIFF if round 2 found nothing new" },
  ],
};

function Cells({ full }: { full: boolean }) {
  // Illustrative: 24 cells stand for the codebase. DIFF only sees patched files and their callers.
  const seen = new Set([3, 4, 11, 12, 17]);
  return (
    <div className="grid grid-cols-12 gap-[3px] w-[216px]" aria-hidden="true">
      {Array.from({ length: 24 }).map((_, i) => (
        <span key={i} className={`h-[14px] w-[14px] border border-ink ${full || seen.has(i) ? "bg-ink" : "hatch bg-paper"}`} />
      ))}
    </div>
  );
}

function Estimator() {
  const [nA, setA] = useState("6");
  const [nB, setB] = useState("5");
  const [m, setM] = useState("4");
  const res = chapman({ nA: Number(nA), nB: Number(nB), m: Number(m) });
  const field = (label: string, value: string, set: (v: string) => void, help: string) => (
    <label className="block">
      <span className="sign text-[15px] font-semibold">{label}</span>
      <input inputMode="numeric" value={value} onChange={(e) => set(e.target.value.replace(/[^0-9]/g, "").slice(0, 5))} className="mono mt-1 block w-24 border-2 border-ink bg-paper px-2 py-1.5 text-lg" aria-describedby={`h-${label}`} />
      <span id={`h-${label}`} className="text-[13px] text-ink-2">{help}</span>
    </label>
  );
  return (
    <section className="mt-12 border-t-2 border-ink pt-6" aria-labelledby="est-h">
      <h3 id="est-h" className="sign text-3xl font-bold">How many bugs are probably still in there?</h3>
      <p className="mt-2 max-w-2xl">Run two independent FULL hunts. Count what each found and what both found. Chapman&apos;s capture–recapture estimate gives the likely total. v2 only stops when this says one or fewer remain.</p>
      <div className="mt-4 flex flex-wrap gap-6 items-start">
        {field("Run A found", nA, setA, "distinct confirmed")}
        {field("Run B found", nB, setB, "distinct confirmed")}
        {field("Both found", m, setM, "the overlap")}
        <div className="min-w-[260px] flex-1" aria-live="polite">
          {res.ok ? (
            <>
              <p className="sign text-2xl font-bold">
                Estimated total <span className="mono text-xl font-medium">{res.total.toFixed(1)}</span> · found <span className="mono text-xl font-medium">{res.union}</span> · remaining <span className={`mono text-xl font-medium ${res.stop ? "text-ok" : "text-bad"}`}>{res.remaining.toFixed(1)}</span>
              </p>
              <div className="mt-2 h-4 w-full bg-paper-3 relative" aria-hidden="true">
                <div className="absolute inset-y-0 left-0 bg-ink" style={{ width: `${Math.min(100, (res.union / Math.max(res.total, 1)) * 100)}%` }} />
              </div>
              <p className={`mt-2 ${res.stop ? "text-ok" : "text-bad"} font-semibold`}>{res.note}</p>
            </>
          ) : (
            <p className="text-bad font-semibold">{res.reason}</p>
          )}
        </div>
      </div>
      <p className="mt-4 max-w-2xl text-[15px] text-ink-2">
        Assumes the two hunts are independent and every bug is about equally findable. Hunters from one model are correlated and some bugs are much harder, so this number is optimistic. A pass here does not mean the code is clean.
      </p>
    </section>
  );
}

export function RedTeamZoom({ mode }: { mode: Mode }) {
  const [sel, setSel] = useState("floor");
  const v2ish = mode !== "v1";
  const nodes = NODES.filter((n) => v2ish || !n.v2only);
  const cur = NODES.find((n) => n.id === sel && (v2ish || !n.v2only)) ?? nodes[0];
  const showV2 = v2ish && cur.v2text;
  const step = 1500 / nodes.length;

  return (
    <div className="py-8">
      <h3 className="sign text-4xl font-bold leading-tight">Inside phase 08: the red team</h3>
      <p className="mt-2 max-w-2xl">
        Your original prompt compressed this whole chain into one sentence. {mode === "v1" ? "This is the repo's version." : mode === "v2" ? "This is v2: the same method on a scripted floor, with measured coverage." : "Vermilion marks what v2 adds or changes."}
      </p>

      <div className="mt-6 overflow-x-auto border-y-2 border-ink bg-paper/70">
        <svg viewBox="0 0 1600 210" className="min-w-[1100px] w-full h-auto block" role="group" aria-label="Red team phases">
          <line x1={step / 2} y1={80} x2={1600 - step / 2} y2={80} stroke={v2ish ? (mode === "diff" ? "var(--color-ink)" : "var(--color-v2)") : "var(--color-v1)"} strokeWidth={9} strokeLinecap="round" />
          {nodes.map((n, i) => {
            const x = step / 2 + i * step;
            const isNew = n.v2only && v2ish;
            const isCh = n.changed && v2ish;
            const accent = mode === "diff" ? (isNew || isCh ? "var(--color-v2)" : "var(--color-ink)") : v2ish ? "var(--color-v2)" : "var(--color-v1)";
            const active = cur.id === n.id;
            return (
              <g key={n.id} transform={`translate(${x} 80)`} role="button" tabIndex={0} aria-pressed={active} aria-label={`${n.label}${isNew ? ", new in v2" : isCh ? ", changed in v2" : ""}`} onClick={() => setSel(n.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSel(n.id); } }} style={{ cursor: "pointer" }}>
                <rect x={-step / 2 + 4} y={-60} width={step - 8} height={150} fill="transparent" />
                {active && <circle r={25} fill="none" stroke="var(--color-ink)" strokeWidth={2.5} className="station-pulse" />}
                <circle r={16} fill={isNew && mode === "diff" ? "var(--color-v2)" : "var(--color-paper)"} stroke={accent} strokeWidth={6} />
                {mode === "diff" && isCh && <circle r={22} fill="none" stroke="var(--color-v2)" strokeWidth={2} strokeDasharray="3 3" />}
                <text textAnchor="middle" y={5} className="mono" fontSize={13} fontWeight={500} fill={isNew && mode === "diff" ? "#fff" : "var(--color-ink)"}>{i + 1}</text>
                <text textAnchor="middle" y={52} className="sign" fontSize={22} fontWeight={600} fill="var(--color-ink)">{n.label}</text>
                {mode === "diff" && (isNew || isCh) && <text textAnchor="middle" y={74} className="mono" fontSize={12} fontWeight={500} fill="var(--color-v2)">{isNew ? "NEW" : "CHANGED"}</text>}
              </g>
            );
          })}
          <text x={800} y={16} textAnchor="middle" className="sign" fontSize={16} fontWeight={600} fill="var(--color-ink-2)">Cloudflare 6 phases · Trail of Bits spec-to-code, sharp-edges, variant-analysis feed in at Hunt and Disprove</text>
        </svg>
      </div>

      <div className="mt-5 grid gap-8 md:grid-cols-2" aria-live="polite">
        <section>
          <h4 className="rule-head text-v1">v1 · {cur.label}</h4>
          <p>{cur.text || <span className="italic text-ink-2">Not in v1.</span>}</p>
        </section>
        <section>
          <h4 className="rule-head text-v2">v2 · {cur.label}</h4>
          <p>{showV2 ? cur.v2text : v2ish && cur.v2only ? cur.v2text : <span className="italic text-ink-2">{v2ish ? "Unchanged." : "Switch to v2 or Diff to see the amendment."}</span>}</p>
        </section>
      </div>

      <section className="mt-12 border-t-2 border-ink pt-6">
        <h3 className="sign text-3xl font-bold">The stop rule: what can each round actually see?</h3>
        <p className="mt-2 max-w-2xl">
          The framework&apos;s own source says a single run finds roughly half of what repeated runs find. v1&apos;s later rounds are diff-only, so they can only look at the patched files. A round that can&apos;t see most of the code will usually report zero.
        </p>
        <div className="mt-5 grid gap-8 md:grid-cols-2">
          {(["v1", "v2"] as const).map((v) => (
            <div key={v} className={mode !== "diff" && ((mode === "v1" && v === "v2") || (mode === "v2" && v === "v1")) ? "opacity-40" : ""}>
              <h4 className="rule-head" style={{ color: v === "v1" ? "var(--color-v1)" : "var(--color-v2)" }}>{v === "v1" ? "v1 · re-run on the diff" : "v2 · full, full, then full or diff"}</h4>
              <ol className="space-y-4">
                {ROUNDS[v].map((r) => (
                  <li key={r.name} className="flex items-center gap-4">
                    <span className="sign text-lg font-semibold w-20">{r.name}</span>
                    <Cells full={r.kind === "FULL"} />
                    <span className="mono text-[13px] font-medium">{r.kind}{"alt" in r && r.alt ? <span className="block text-ink-2 font-normal">{r.alt}</span> : null}</span>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[13px] text-ink-2">Illustrative: 24 squares stand for the codebase. A DIFF round sees only the patched files and their callers.</p>
      </section>

      <Estimator />
    </div>
  );
}
