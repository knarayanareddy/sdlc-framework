"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { GATES, STATIONS, type Mode } from "@/lib/pipeline-data";
import { LineMap, TRAVEL_ORDER, nodeVisible, type GateRecord } from "./LineMap";
import { StationPanel } from "./StationPanel";
import { DefectTrace } from "./DefectTrace";
import { EnforcementLadder } from "./EnforcementLadder";
import { RedTeamZoom } from "./RedTeamZoom";
import { ReviewView } from "./ReviewView";
import { PromptLibrary, type LibraryItem } from "./PromptLibrary";

export type { GateRecord, LibraryItem };

type Tab = "map" | "trace" | "ladder" | "red" | "review" | "prompts";
const TABS: { id: Tab; letter: string; label: string }[] = [
  { id: "map", letter: "A", label: "Map" },
  { id: "trace", letter: "B", label: "Trace a defect" },
  { id: "ladder", letter: "C", label: "Who enforces it" },
  { id: "red", letter: "D", label: "Red team" },
  { id: "review", letter: "E", label: "Review" },
  { id: "prompts", letter: "F", label: "Prompts" },
];

const MODES: { id: Mode; label: string; sub: string; cls: string }[] = [
  { id: "v1", label: "v1", sub: "the repo", cls: "bg-v1" },
  { id: "v2", label: "v2", sub: "amended", cls: "bg-v2" },
  { id: "diff", label: "Diff", sub: "what changed", cls: "bg-ink" },
];

function nodeName(id: string): string {
  const s = STATIONS.find((x) => x.id === id);
  if (s) return s.minor ? s.label : `${s.id} · ${s.label}`;
  return `Gate ${id.slice(1)}`;
}

export function Atlas({ initialGates, library }: { initialGates: Record<string, GateRecord>; library: LibraryItem[] }) {
  const [tab, setTab] = useState<Tab>("map");
  const [mode, setMode] = useState<Mode>("diff");
  const [gates, setGates] = useState(initialGates);
  const [selected, setSelected] = useState<string | null>(null);
  const [focusFinding, setFocusFinding] = useState<string | null>(null);

  // Build packet player
  const [tokenIdx, setTokenIdx] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);

  const travel = useMemo(() => TRAVEL_ORDER.filter((id) => nodeVisible(id, mode)), [mode]);
  const tokenAt = tokenIdx !== null ? (travel[Math.min(tokenIdx, travel.length - 1)] ?? null) : null;

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      setTokenIdx((i) => {
        const next = (i ?? -1) + 1;
        if (next >= travel.length) {
          setPlaying(false);
          return travel.length - 1;
        }
        return next;
      });
    }, 1100);
    return () => clearInterval(t);
  }, [playing, travel.length]);

  // While a build packet is travelling, the panel follows it; clicking a node takes over.
  const activeSel = tokenAt ?? selected;

  const step = () => {
    setPlaying(false);
    setTokenIdx((i) => (i === null || i >= travel.length - 1 ? 0 : i + 1));
  };
  const play = () => {
    if (tokenIdx === null || tokenIdx >= travel.length - 1) setTokenIdx(0);
    setPlaying(true);
  };
  const reset = () => {
    setPlaying(false);
    setTokenIdx(null);
  };

  const saveGate = useCallback(async (gate: string, status: string | null, note: string): Promise<string | null> => {
    try {
      const res = await fetch("/api/gates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gate, status, note }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) return data.error ?? "Could not save.";
      setGates((prev) => {
        const next = { ...prev };
        if (status === null) delete next[gate];
        else next[gate] = { status, note };
        return next;
      });
      return null;
    } catch {
      return "Network error. Nothing was saved.";
    }
  }, []);

  const openFinding = (id: string) => {
    setFocusFinding(id);
    setTab("review");
  };

  const counts = useMemo(() => {
    const vis = STATIONS.filter((s) => !s.minor && (mode !== "v1" || s.change !== "new"));
    return {
      stations: vis.length,
      gates: GATES.filter((g) => mode !== "v1" || g.inV1).length,
      changed: STATIONS.filter((s) => s.change === "changed").length,
      added: STATIONS.filter((s) => s.change === "new").length + GATES.filter((g) => !g.inV1).length,
    };
  }, [mode]);

  const showMode = tab === "map" || tab === "red";

  return (
    <div className="mx-auto max-w-[1500px] px-5 sm:px-8 pb-24">
      <header className="pt-8 pb-5 flex flex-wrap items-end gap-x-10 gap-y-5">
        <div className="flex items-center gap-5 mr-auto">
          <div className="sign bg-ink text-paper px-3 py-2 text-3xl font-bold leading-none tracking-wide" aria-hidden="true">SDLC</div>
          <div>
            <h1 className="sign text-[44px] sm:text-6xl font-bold leading-[0.95]">The Line</h1>
            <p className="italic text-ink-2 max-w-xl mt-1">
              One build pipeline, drawn twice: the repo as it stands, and what I would change after reading every prompt.
            </p>
          </div>
        </div>
        {showMode && (
          <div role="group" aria-label="Pipeline version" className="flex border-2 border-ink">
            {MODES.map((m) => (
              <button key={m.id} type="button" aria-pressed={mode === m.id} onClick={() => { setMode(m.id); reset(); }} className={`sign px-5 py-2 text-left leading-none ${mode === m.id ? `${m.cls} text-paper` : "bg-paper hover:bg-paper-2"}`}>
                <span className="block text-3xl font-bold">{m.label}</span>
                <span className="block text-[13px] font-medium tracking-wider mt-1">{m.sub}</span>
              </button>
            ))}
          </div>
        )}
      </header>

      <nav aria-label="Views" className="border-y-2 border-ink flex flex-wrap">
        {TABS.map((t) => (
          <button key={t.id} type="button" aria-current={tab === t.id ? "page" : undefined} onClick={() => setTab(t.id)} className={`sign flex items-center gap-2.5 px-4 py-2.5 text-[19px] font-semibold border-r-2 border-ink last:border-r-0 ${tab === t.id ? "bg-ink text-paper" : "hover:bg-paper-2"}`}>
            <span className={`grid place-items-center h-7 w-7 rounded-full text-[16px] font-bold ${tab === t.id ? "bg-paper text-ink" : "bg-ink text-paper"}`} aria-hidden="true">{t.letter}</span>
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "map" && (
        <section aria-label="Pipeline map">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3">
            <div className="flex gap-2">
              <button type="button" onClick={playing ? () => setPlaying(false) : play} className="sign px-4 py-1.5 text-[17px] font-semibold border-2 border-ink bg-ink text-paper hover:bg-ink-2">
                {playing ? "Pause" : "▶ Send a build"}
              </button>
              <button type="button" onClick={step} className="sign px-4 py-1.5 text-[17px] font-semibold border-2 border-ink hover:bg-paper-2">Next stop</button>
              <button type="button" onClick={reset} disabled={tokenIdx === null} className="sign px-4 py-1.5 text-[17px] font-semibold border-2 border-dashed border-ink-2 text-ink-2 hover:bg-paper-2 disabled:opacity-40">Reset</button>
            </div>
            <p className="mono text-[13px] text-ink-2" aria-live="polite">
              {tokenAt ? `Now at ${nodeName(tokenAt)}` : `${counts.stations} phases · ${counts.gates} gates${mode === "v1" ? "" : ` · ${counts.added} added, ${counts.changed} changed`}`}
            </p>
            <p className="mono text-[12px] text-ink-2 ml-auto hidden md:block">
              Gate squares: <span className="inline-block h-3 w-3 bg-ok align-middle" /> passed · <span className="inline-block h-3 w-3 bg-bad align-middle" /> failed · <span className="inline-block h-3 w-3 border-2 border-dashed border-hold align-middle" /> not verified · <span className="inline-block h-3 w-3 border-2 border-ink align-middle" /> not evaluated
            </p>
          </div>
          <LineMap mode={mode} gates={gates} selected={activeSel} onSelect={(id) => { setSelected(id); setPlaying(false); setTokenIdx(null); }} tokenAt={tokenAt} />
          <div className="min-h-[300px]">
            <StationPanel selected={activeSel && nodeVisible(activeSel, mode) ? activeSel : null} mode={mode} gates={gates} onSaveGate={saveGate} onOpenFinding={openFinding} />
          </div>
          <p className="mt-2 text-[14px] text-ink-2">
            <a className="underline underline-offset-4 hover:text-ink" href="/api/gates?download=1" download>Export your gate marks as progress.json</a>
          </p>
        </section>
      )}
      {tab === "trace" && <DefectTrace onOpenFinding={openFinding} />}
      {tab === "ladder" && <EnforcementLadder />}
      {tab === "red" && <RedTeamZoom mode={mode} />}
      {tab === "review" && <ReviewView focus={focusFinding} />}
      {tab === "prompts" && <PromptLibrary items={library} />}

      <footer className="mt-16 border-t-2 border-ink pt-4 text-[14px] text-ink-2 max-w-3xl">
        Review of <span className="mono text-[12px]">knarayanareddy/sdlc-framework</span>. Built from reading its prompts and running its one tool; neither version was run on a real product, so no performance claim is made. Defect-trace outcomes are my assessment, not measurements.
      </footer>
    </div>
  );
}
