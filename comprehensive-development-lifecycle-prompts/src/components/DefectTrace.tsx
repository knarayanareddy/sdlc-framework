"use client";

import { useMemo, useState } from "react";
import { DEFECTS, type Catch, type CatchKind, type Defect } from "@/lib/pipeline-data";
import { PHASE_ORDER, outcome, pos, strength, type Outcome } from "@/lib/outcome";

const V1_PHASES = new Set(["01", "02", "03", "04", "05", "06", "07", "08", "09", "10"]);
const SHORT: Record<string, string> = { H1: "Dig", FZ: "Frz" };
const KIND: Record<CatchKind, { label: string; cls: string }> = {
  mechanical: { label: "Mechanical", cls: "bg-ink text-paper" },
  prevent: { label: "Prevented upstream", cls: "bg-ok text-paper" },
  judgement: { label: "Judgement", cls: "border-2 border-ink text-ink" },
  late: { label: "Late: harm done", cls: "bg-hold text-paper" },
};

function Track({ d, version, catches }: { d: Defect; version: "v1" | "v2"; catches: Catch[] }) {
  const out = outcome(d, catches);
  const color = version === "v1" ? "var(--color-v1)" : "var(--color-v2)";
  const originIdx = pos(d.origin);
  const endIdx = out.kind === "escapes" ? PHASE_ORDER.length - 1 : pos(out.at!);
  const pct = (i: number) => ((i + 0.5) / PHASE_ORDER.length) * 100;
  const tokenIdx = endIdx;

  const verdict =
    out.kind === "prevented"
      ? { text: `Prevented at ${out.at}`, cls: "text-ok" }
      : out.kind === "stopped"
        ? { text: `Stopped at ${out.at}`, cls: "text-ink" }
        : { text: out.at ? `Only caught late, at ${out.at}` : "Escapes: no control", cls: "text-bad" };

  return (
    <section aria-label={`${version} outcome`} className="mt-6">
      <div className="flex items-baseline gap-4">
        <h4 className="sign text-2xl font-bold" style={{ color }}>{version === "v1" ? "v1 · the repo today" : "v2 · amended"}</h4>
        <p className={`sign text-2xl font-bold ${verdict.cls}`}>{verdict.text}</p>
      </div>
      <div className="relative mt-3 h-[92px] select-none">
        <div className="absolute left-0 right-0 top-[44px] h-[8px] rounded" style={{ background: color, opacity: version === "v1" ? 1 : 1 }} />
        {PHASE_ORDER.map((p, i) => {
          const exists = version === "v2" || V1_PHASES.has(p);
          const here = catches.filter((c) => c.at === p);
          return (
            <div key={p} className="absolute top-0 -translate-x-1/2 text-center" style={{ left: `${pct(i)}%` }}>
              <div className={`mono text-[11px] leading-none h-3 ${exists ? "text-ink" : "text-ink-2/40"}`}>{SHORT[p] ?? p}</div>
              <div className={`mx-auto mt-5 h-[18px] w-[18px] rounded-full border-[4px] bg-paper ${exists ? "" : "opacity-30"}`} style={{ borderColor: exists ? color : "var(--color-rule)", marginTop: 36 }} />
              {here.length > 0 && (
                <div className="absolute left-1/2 -translate-x-1/2 -top-1 flex flex-col items-center" aria-hidden="true">
                  {here.map((c, k) => (
                    <span key={k} className={`block h-[10px] w-[10px] ${c.kind === "late" ? "bg-hold" : c.kind === "prevent" ? "bg-ok" : "bg-ink"} rotate-45 -mb-1 mt-[18px]`} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {originIdx >= 0 && (
          <div className="absolute -translate-x-1/2 sign text-[12px] font-semibold text-ink-2" style={{ left: `${pct(originIdx)}%`, top: 70 }}>▲ enters</div>
        )}
        <div className="absolute top-[34px] -translate-x-1/2 token transition-[left] duration-700 ease-in-out" style={{ left: `${pct(tokenIdx)}%` }} aria-hidden="true">
          <div className={`h-7 w-7 rounded-full border-[3px] border-paper ${out.kind === "escapes" ? "bg-bad" : out.kind === "prevented" ? "bg-ok" : "bg-ink"}`} />
        </div>
      </div>
      {catches.length === 0 ? (
        <p className="mt-1 text-ink-2 italic">No control in this version looks for this.</p>
      ) : (
        <ol className="mt-1 space-y-2">
          {[...catches].sort((a, b) => pos(a.at) - pos(b.at)).map((c, i) => (
            <li key={i} className="grid grid-cols-[auto_1fr] gap-x-3 items-baseline">
              <span className={`sign text-[13px] font-semibold px-2 py-0.5 whitespace-nowrap ${KIND[c.kind].cls}`}>{KIND[c.kind].label}</span>
              <span><span className="mono text-[13px] font-medium">at {c.at}</span> · {c.how}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function DefectTrace({ onOpenFinding }: { onOpenFinding: (id: string) => void }) {
  const [id, setId] = useState(DEFECTS[0].id);
  const d = useMemo(() => DEFECTS.find((x) => x.id === id)!, [id]);
  const o1 = outcome(d, d.v1);
  const o2 = outcome(d, d.v2);
  const better = (o: Outcome) => strength(o);

  return (
    <div className="grid gap-10 lg:grid-cols-[320px_1fr] py-8">
      <nav aria-label="Defects" className="lg:border-r-2 lg:border-ink lg:pr-6">
        <h3 className="rule-head">Send a defect down the line</h3>
        <ul className="space-y-0.5">
          {DEFECTS.map((x) => (
            <li key={x.id}>
              <button type="button" onClick={() => setId(x.id)} aria-current={x.id === id} className={`w-full text-left py-2 px-3 leading-snug border-l-[6px] ${x.id === id ? "border-v2 bg-paper-2 font-semibold" : "border-transparent hover:bg-paper-2"}`}>
                {x.title}
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-[14px] text-ink-2 leading-snug">My assessment from reading the prompts, not a measurement. A control labelled Judgement depends on an agent or a person actually noticing.</p>
      </nav>
      <div>
        <h3 className="sign text-4xl font-bold leading-tight">{d.title}</h3>
        <p className="mt-2 max-w-2xl">{d.story}</p>
        <p className="mt-2 flex flex-wrap items-center gap-2 text-[15px]">
          <span className="mono text-[13px] text-ink-2">Enters at {d.origin}</span>
          <button type="button" onClick={() => onOpenFinding(d.ref)} className="mono text-[13px] font-medium border-2 border-ink px-2 py-0.5 hover:bg-ink hover:text-paper">{d.ref}</button>
          {better(o2) > better(o1) && <span className="sign font-semibold text-ok">v2 is stronger here</span>}
          {better(o2) === better(o1) && <span className="sign font-semibold text-ink-2">Same outcome; compare how</span>}
        </p>
        <Track d={d} version="v1" catches={d.v1} />
        <Track d={d} version="v2" catches={d.v2} />
      </div>
    </div>
  );
}
