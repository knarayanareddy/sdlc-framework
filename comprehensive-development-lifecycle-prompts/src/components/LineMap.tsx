"use client";

import { GATES, STATIONS, type Mode } from "@/lib/pipeline-data";

export interface GateRecord {
  status: string;
  note: string;
}

// Order a build packet travels in. Hidden nodes are filtered out per mode.
export const TRAVEL_ORDER = [
  "00", "G0", "01", "G1", "02", "G2", "H1", "03", "G3", "04", "G4", "FZ", "05", "G5", "06", "07", "G7", "08", "09", "G9", "10", "G10", "11", "G11", "12", "G12",
];

const COLORS = { v1: "var(--color-v1)", v2: "var(--color-v2)", ink: "var(--color-ink)" };

function labelLines(label: string): string[] {
  if (label.includes(" + ")) {
    const [a, b] = label.split(" + ");
    return [`${a} +`, b];
  }
  if (label.length > 11 && label.includes(" ")) {
    const mid = Math.floor(label.length / 2);
    const idx = [...label].map((c, i) => (c === " " ? i : -1)).filter((i) => i >= 0).sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid))[0];
    return [label.slice(0, idx), label.slice(idx + 1)];
  }
  return [label];
}

export function nodeVisible(id: string, mode: Mode): boolean {
  const s = STATIONS.find((x) => x.id === id);
  if (s) return mode !== "v1" || s.change !== "new";
  const g = GATES.find((x) => x.id === id);
  return !!g && (mode !== "v1" || g.inV1);
}

export function nodePos(id: string): { x: number; y: number } | null {
  const s = STATIONS.find((x) => x.id === id);
  if (s) return { x: s.x, y: s.y };
  const g = GATES.find((x) => x.id === id);
  return g ? { x: g.x, y: g.y } : null;
}

function GateGlyph({ state, stroke }: { state?: string; stroke: string }) {
  if (state === "passed")
    return (
      <>
        <rect x={-12} y={-12} width={24} height={24} rx={5} fill="var(--color-ok)" stroke="var(--color-ink)" strokeWidth={2} />
        <path d="M-6 0 L-2 5 L7 -5" fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      </>
    );
  if (state === "failed")
    return (
      <>
        <rect x={-12} y={-12} width={24} height={24} rx={5} fill="var(--color-bad)" stroke="var(--color-ink)" strokeWidth={2} />
        <path d="M-5 -5 L5 5 M5 -5 L-5 5" stroke="#fff" strokeWidth={3} strokeLinecap="round" />
      </>
    );
  if (state === "NOT_VERIFIED")
    return (
      <>
        <rect x={-12} y={-12} width={24} height={24} rx={5} fill="var(--color-paper)" stroke="var(--color-hold)" strokeWidth={3} strokeDasharray="5 3" />
        <text textAnchor="middle" y={6} fontSize={16} fontWeight={700} fill="var(--color-hold)" className="mono">?</text>
      </>
    );
  return <rect x={-12} y={-12} width={24} height={24} rx={5} fill="var(--color-paper)" stroke={stroke} strokeWidth={3} />;
}

interface Props {
  mode: Mode;
  gates: Record<string, GateRecord>;
  selected: string | null;
  onSelect: (id: string) => void;
  tokenAt: string | null;
}

export function LineMap({ mode, gates, selected, onSelect, tokenAt }: Props) {
  const v2ish = mode !== "v1";
  const lineColor = mode === "v1" ? COLORS.v1 : mode === "v2" ? COLORS.v2 : COLORS.ink;
  const accent = mode === "v1" ? COLORS.v1 : COLORS.v2;
  const sx = v2ish ? 40 : 125;
  const ex = v2ish ? 1675 : 1450;

  const upper = "M440 260 C480 260 470 170 520 170 L600 170 C640 170 620 260 660 260";
  const lower = "M440 260 C480 260 470 350 520 350 L600 350 C640 350 620 260 660 260";
  const token = tokenAt && nodeVisible(tokenAt, mode) ? nodePos(tokenAt) : null;

  const activate = (id: string) => (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(id);
    }
  };

  return (
    <div className="overflow-x-auto border-y-2 border-ink bg-paper/70" tabIndex={0} aria-label="Pipeline map, scrolls horizontally">
      <svg viewBox="0 0 1720 520" className="min-w-[1280px] w-full h-auto block" role="group" aria-label={`Pipeline map, ${mode === "v1" ? "original" : mode === "v2" ? "amended" : "differences"} view`}>
        <defs>
          <marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="var(--color-ink)" />
          </marker>
        </defs>

        {/* Orchestrator ribbon */}
        <g>
          <rect x={v2ish ? 40 : 150} y={42} width={v2ish ? 1635 : 1240} height={34} rx={4} fill="none" stroke={mode === "v1" ? COLORS.v1 : mode === "v2" ? COLORS.v2 : COLORS.ink} strokeWidth={2} strokeDasharray="8 5" />
          <text x={(v2ish ? 40 : 150) + 14} y={64} className="sign" fontSize={19} fontWeight={600} fill="var(--color-ink)">
            {v2ish ? "Orchestrator + control plane · hash-chained gate ledger · protected paths · budgets" : "Orchestrator · spawns a fresh agent per phase · re-runs every gate itself"}
          </text>
        </g>

        {/* Lines */}
        <g fill="none" strokeWidth={11} strokeLinecap="round" strokeLinejoin="round" stroke={lineColor}>
          <path d={`M${sx} 260 H440`} />
          <path d={upper} />
          <path d={lower} />
          <path d={`M660 260 H${ex}`} />
        </g>
        {mode === "diff" && (
          <g fill="none" strokeWidth={11} strokeLinecap="round" stroke={COLORS.v2}>
            <path d="M40 260 H125" />
            <path d="M1450 260 H1675" />
          </g>
        )}

        {/* Terminals */}
        <text x={sx} y={228} textAnchor="middle" className="sign" fontSize={17} fontWeight={700} fill="var(--color-ink)">Brief</text>
        <text x={ex} y={228} textAnchor="middle" className="sign" fontSize={17} fontWeight={700} fill="var(--color-ink)">Ship</text>

        {/* Loops */}
        <g fill="none" stroke="var(--color-ink)" strokeWidth={3} markerEnd="url(#arr)">
          <path d="M1000 242 C1000 175 880 175 880 242" />
          <path d="M1240 242 C1240 175 1120 175 1120 242" />
        </g>
        <text x={940} y={166} textAnchor="middle" className="mono" fontSize={13} fill="var(--color-ink)">defects → back to 06</text>
        <text x={1180} y={166} textAnchor="middle" className="mono" fontSize={13} fill={mode === "v1" ? COLORS.v1 : mode === "diff" ? COLORS.ink : COLORS.v2} fontWeight={500}>
          {v2ish ? "FULL · FULL · FULL|DIFF" : "re-run on the diff ≤3"}
        </text>
        {mode === "diff" && (
          <text x={1180} y={148} textAnchor="middle" className="mono" fontSize={13} fill={COLORS.v2} fontWeight={500}>v1 was: re-run on the diff ≤3</text>
        )}

        {/* Verifier ribbon */}
        <g>
          <rect x={v2ish ? 480 : 480} y={462} width={v2ish ? 800 : 800} height={34} rx={4} fill={v2ish ? "rgba(181,48,14,0.08)" : "rgba(31,70,144,0.08)"} stroke={accent} strokeWidth={2} strokeDasharray={v2ish ? "0" : "3 5"} />
          <text x={494} y={485} className="sign" fontSize={18} fontWeight={600} fill="var(--color-ink)">
            {v2ish ? "Verifiers: fresh context + different model family where available · file manifest logged" : "Verifiers: fresh context only (same model family)"}
          </text>
        </g>

        {/* Gates */}
        {GATES.map((g) => {
          if (!nodeVisible(g.id, mode)) return null;
          const isNew = mode === "diff" && g.v2Change === "new";
          const isChanged = mode === "diff" && g.v2Change === "changed";
          const rec = gates[g.id];
          const stroke = isNew || isChanged ? COLORS.v2 : lineColor;
          return (
            <g key={g.id} transform={`translate(${g.x} ${g.y})`} role="button" tabIndex={0} aria-label={`Gate ${g.id}${rec ? `, ${rec.status}` : ", not yet evaluated"}`} aria-pressed={selected === g.id} onClick={() => onSelect(g.id)} onKeyDown={activate(g.id)} style={{ cursor: "pointer" }}>
              <rect x={-24} y={-24} width={48} height={48} fill="transparent" />
              {selected === g.id && <rect x={-18} y={-18} width={36} height={36} rx={8} fill="none" stroke="var(--color-ink)" strokeWidth={2.5} />}
              <GateGlyph state={rec?.status} stroke={stroke} />
              <text y={-22} textAnchor="middle" className="mono" fontSize={13} fontWeight={500} fill={isNew || isChanged ? COLORS.v2 : "var(--color-ink)"}>{g.id}</text>
            </g>
          );
        })}

        {/* Stations */}
        {STATIONS.map((s) => {
          if (!nodeVisible(s.id, mode)) return null;
          const r = s.minor ? 10 : 17;
          const isNew = s.change === "new";
          const isChanged = s.change === "changed";
          const stroke = mode === "diff" ? (isNew || isChanged ? COLORS.v2 : COLORS.ink) : lineColor;
          const fill = isNew && mode !== "v1" ? (mode === "diff" ? COLORS.v2 : "var(--color-paper)") : "var(--color-paper)";
          const lines = labelLines(s.label);
          const below = s.labelPos === "below";
          const baseY = below ? r + 24 : -(r + 14) - (lines.length - 1) * 21 - (mode === "diff" && s.change !== "same" ? 20 : 0);
          return (
            <g key={s.id} transform={`translate(${s.x} ${s.y})`} role="button" tabIndex={0} aria-label={`Station ${s.id}, ${s.label}, ${s.change === "new" ? "new in v2" : s.change === "changed" ? "changed in v2" : "unchanged in v2"}`} aria-pressed={selected === s.id} onClick={() => onSelect(s.id)} onKeyDown={activate(s.id)} style={{ cursor: "pointer" }}>
              <circle r={r + 14} fill="transparent" />
              {selected === s.id && <circle r={r + 9} fill="none" stroke="var(--color-ink)" strokeWidth={2.5} className="station-pulse" />}
              {mode === "diff" && isChanged && <circle r={r + 6} fill="none" stroke={COLORS.v2} strokeWidth={2} strokeDasharray="3 3" />}
              <circle r={r} fill={fill} stroke={stroke} strokeWidth={s.minor ? 4 : 6} />
              {isNew && mode === "diff" && !s.minor && <text textAnchor="middle" y={6} fontSize={20} fontWeight={700} fill="#fff" className="mono">+</text>}
              {!s.minor && <text textAnchor="middle" y={5} fontSize={14} fontWeight={500} fill={isNew && mode === "diff" ? "transparent" : "var(--color-ink)"} className="mono">{s.id}</text>}
              {lines.map((ln, i) => (
                <text key={ln + i} textAnchor="middle" y={baseY + i * 21} className="sign" fontSize={21} fontWeight={600} fill="var(--color-ink)">{ln}</text>
              ))}
              {s.minor && (
                <text textAnchor="middle" y={below ? baseY + lines.length * 21 : baseY - 0} className="mono" fontSize={11} fill="var(--color-ink-2)" display="none">{s.id}</text>
              )}
              {mode === "diff" && s.change !== "same" && (
                <text textAnchor="middle" y={below ? baseY + lines.length * 20 : baseY + lines.length * 21 - 2} className="mono" fontSize={12} fontWeight={500} fill={COLORS.v2}>{s.change === "new" ? "NEW" : "CHANGED"}</text>
              )}
            </g>
          );
        })}

        {/* Build packet */}
        {token && (
          <g className="token" style={{ transform: `translate(${token.x}px, ${token.y}px)` }} aria-hidden="true">
            <circle r={9} fill="var(--color-ink)" stroke="var(--color-paper)" strokeWidth={3} />
          </g>
        )}
      </svg>
    </div>
  );
}
