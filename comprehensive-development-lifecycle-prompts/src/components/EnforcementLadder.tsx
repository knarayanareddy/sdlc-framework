"use client";

import { useState } from "react";
import { RULES, RUNGS } from "@/lib/pipeline-data";

const W = 860;
const H = 480;
const X1 = 150;
const X2 = 520;
const rungY = (r: number) => 100 + (3 - r) * 100;

export function EnforcementLadder() {
  const [sel, setSel] = useState<string>(RULES[0].id);
  const mech = (v: number) => RULES.filter((r) => v === 1 ? r.v1 >= 2 : r.v2 >= 2).length;
  const hard = (v: number) => RULES.filter((r) => (v === 1 ? r.v1 : r.v2) === 3).length;
  const builtFull = RULES.filter((r) => r.built === "built").length;
  const builtPartial = RULES.filter((r) => r.built === "partial").length;
  const selected = RULES.find((r) => r.id === sel)!;

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_minmax(0,780px)] py-8">
      <div>
        <h3 className="sign text-4xl font-bold leading-tight">Who decides the gate: a promise, a reviewer, or a script?</h3>
        <p className="mt-3 max-w-xl">
          Each line is one rule from the framework. Its left end is how v1 enforces it. Its right end is how v2 would. Higher is harder to talk your way past.
        </p>
        <dl className="mt-5 grid grid-cols-2 gap-x-8 gap-y-1 max-w-md">
          <dt className="sign text-[15px] text-ink-2">Rules enforced by a script</dt>
          <dd className="mono text-[15px]"><span className="text-v1">{mech(1)}</span> → <span className="text-v2 font-medium">{mech(2)}</span> of {RULES.length}</dd>
          <dt className="sign text-[15px] text-ink-2">…and hardened against gaming</dt>
          <dd className="mono text-[15px]"><span className="text-v1">{hard(1)}</span> → <span className="text-v2 font-medium">{hard(2)}</span> of {RULES.length}</dd>
          <dt className="sign text-[15px] text-ink-2">Actually built and tested</dt>
          <dd className="mono text-[15px]">{builtFull} full, {builtPartial} partial, {RULES.length - builtFull - builtPartial} specified only</dd>
        </dl>
        <ul className="mt-6 divide-y divide-rule border-y-2 border-ink">
          {RULES.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => setSel(r.id)} aria-pressed={sel === r.id} onMouseEnter={() => setSel(r.id)} className={`w-full text-left py-2.5 px-3 flex items-baseline justify-between gap-4 ${sel === r.id ? "bg-paper-2" : "hover:bg-paper-2"}`}>
                <span className={sel === r.id ? "font-semibold" : ""}>{r.rule}</span>
                <span className="mono text-[12px] text-ink-2 whitespace-nowrap">{r.built}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-4 max-w-xl" aria-live="polite">
          <span className="sign text-xl font-bold">{selected.rule}.</span> <span className="text-ink-2">v1: {RUNGS[selected.v1]} → v2: {RUNGS[selected.v2]}.</span> {selected.note}
        </p>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Slope chart of enforcement level per rule, v1 to v2">
        {RUNGS.map((name, r) => (
          <g key={name}>
            <rect x={0} y={rungY(r) - 42} width={W} height={84} fill={r % 2 ? "rgba(24,23,20,0.045)" : "transparent"} />
            <text x={8} y={rungY(r) - 28} className="sign" fontSize={15} fontWeight={600} fill="var(--color-ink-2)">{name}</text>
          </g>
        ))}
        <text x={X1} y={30} textAnchor="middle" className="sign" fontSize={24} fontWeight={700} fill="var(--color-v1)">v1</text>
        <text x={X2} y={30} textAnchor="middle" className="sign" fontSize={24} fontWeight={700} fill="var(--color-v2)">v2</text>
        {RULES.map((r, i) => {
          // spread rules inside a rung so lines don't sit on top of each other
          const spread = (version: "v1" | "v2") => {
            const peers = RULES.filter((q) => q[version] === r[version]);
            const k = peers.findIndex((q) => q.id === r.id);
            return peers.length === 1 ? 0 : (k / (peers.length - 1) - 0.5) * Math.min(72, (peers.length - 1) * 14);
          };
          void i;
          const y1 = rungY(r.v1) + spread("v1") + 8;
          const y2 = rungY(r.v2) + spread("v2") + 8;
          const on = r.id === sel;
          const dash = r.built === "built" ? undefined : r.built === "partial" ? "8 4" : "3 5";
          return (
            <g key={r.id} opacity={on ? 1 : 0.35} onClick={() => setSel(r.id)} style={{ cursor: "pointer" }}>
              <line x1={X1} y1={y1} x2={X2} y2={y2} stroke={on ? "var(--color-ink)" : "var(--color-ink-2)"} strokeWidth={on ? 4 : 2.5} strokeDasharray={dash} />
              <circle cx={X1} cy={y1} r={on ? 8 : 6} fill="var(--color-v1)" />
              <circle cx={X2} cy={y2} r={on ? 8 : 6} fill="var(--color-v2)" />
              {on && <text x={X2 + 16} y={y2 + 5} className="sign" fontSize={17} fontWeight={600} fill="var(--color-ink)">{r.rule}</text>}
            </g>
          );
        })}
        <g transform={`translate(8 ${H - 14})`} className="mono" fontSize={11} fill="var(--color-ink-2)">
          <text>solid = built and self-tested · long dash = partly built · dotted = specified only</text>
        </g>
      </svg>
    </div>
  );
}
