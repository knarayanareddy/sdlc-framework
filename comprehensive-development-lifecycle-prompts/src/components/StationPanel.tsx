"use client";

import { useState } from "react";
import { GATES, STATIONS, type Mode } from "@/lib/pipeline-data";
import { GATE_STATUSES, MAX_NOTE } from "@/lib/gates";
import type { GateRecord } from "./LineMap";

interface Props {
  selected: string | null;
  mode: Mode;
  gates: Record<string, GateRecord>;
  onSaveGate: (gate: string, status: string | null, note: string) => Promise<string | null>;
  onOpenFinding: (id: string) => void;
}

const TAG: Record<string, { text: string; cls: string }> = {
  new: { text: "New in v2", cls: "bg-v2 text-paper" },
  changed: { text: "Changed in v2", cls: "border-2 border-v2 text-v2" },
  same: { text: "Unchanged in v2", cls: "border-2 border-ink-2 text-ink-2" },
};

const STATUS_LABEL: Record<string, string> = { passed: "Passed", failed: "Failed", NOT_VERIFIED: "Not verified" };

function GateEditor({ gate, record, onSave }: { gate: string; record?: GateRecord; onSave: Props["onSaveGate"] }) {
  const [note, setNote] = useState(record?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(status: string | null) {
    setBusy(true);
    setError(null);
    const err = await onSave(gate, status, note);
    setBusy(false);
    if (err) setError(err);
  }

  return (
    <div className="mt-5 border-t-2 border-ink pt-4">
      <h4 className="rule-head">Your run · mark this gate</h4>
      <p className="text-[15px] text-ink-2 max-w-prose">
        Mirrors <span className="mono text-[13px]">docs/progress.json</span>. A gate you can&apos;t evaluate is <span className="mono text-[13px]">NOT_VERIFIED</span>, never passed.
      </p>
      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={`Status for gate ${gate}`}>
        {GATE_STATUSES.map((s) => (
          <button key={s} type="button" disabled={busy} onClick={() => save(s)} aria-pressed={record?.status === s}
            className={`sign px-4 py-2 text-[17px] font-semibold border-2 border-ink transition-colors disabled:opacity-50 ${record?.status === s ? "bg-ink text-paper" : "bg-paper hover:bg-paper-2"}`}>
            {STATUS_LABEL[s]}
          </button>
        ))}
        <button type="button" disabled={busy || !record} onClick={() => save(null)} className="sign px-4 py-2 text-[17px] font-semibold border-2 border-dashed border-ink-2 text-ink-2 hover:bg-paper-2 disabled:opacity-40">
          Clear
        </button>
      </div>
      <label className="block mt-3">
        <span className="sign text-[15px] font-semibold">Evidence note</span>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={MAX_NOTE} rows={2}
          className="mt-1 block w-full max-w-xl border-2 border-ink bg-paper p-2 text-[16px]" placeholder="Command run, commit SHA, or why it is NOT_VERIFIED" />
        <span className="mono text-[12px] text-ink-2">{note.length}/{MAX_NOTE} · saved with the next status you pick</span>
      </label>
      <p role="status" aria-live="polite" className="mt-2 min-h-6 text-[15px] text-bad">{error}</p>
    </div>
  );
}

export function StationPanel({ selected, mode, gates, onSaveGate, onOpenFinding }: Props) {
  const station = STATIONS.find((s) => s.id === selected);
  const gate = GATES.find((g) => g.id === selected);

  if (!station && !gate) {
    return (
      <div className="py-10 max-w-2xl">
        <p className="sign text-3xl font-semibold">Pick a stop.</p>
        <p className="mt-2 text-ink-2">
          Click any station or gate square on the line. Each shows what the repo does today, what v2 would change, and the finding behind the change. Gate squares are also where you can record your own run.
        </p>
      </div>
    );
  }

  if (gate) {
    const hiddenInV1 = mode === "v1" && !gate.inV1;
    return (
      <div className="py-6">
        <div className="flex flex-wrap items-baseline gap-4">
          <h3 className="sign text-5xl font-bold leading-none">Gate {gate.id.slice(1)}</h3>
          <span className={`sign text-[15px] font-semibold px-3 py-1 ${TAG[gate.v2Change].cls}`}>{TAG[gate.v2Change].text}</span>
        </div>
        <div className="mt-5 grid gap-8 md:grid-cols-2">
          <section>
            <h4 className="rule-head text-v1">v1 · the repo today</h4>
            <p>{gate.v1Check ?? <span className="text-ink-2 italic">No such gate in v1.</span>}</p>
          </section>
          <section>
            <h4 className="rule-head text-v2">v2 · amended</h4>
            <p>{gate.v2Check}</p>
          </section>
        </div>
        {hiddenInV1 && <p className="mt-3 text-ink-2 italic">Hidden on the map in the v1 view because v1 has no such gate.</p>}
        <GateEditor key={gate.id} gate={gate.id} record={gates[gate.id]} onSave={onSaveGate} />
      </div>
    );
  }

  const s = station!;
  return (
    <div className="py-6">
      <div className="flex flex-wrap items-baseline gap-4">
        <h3 className="sign text-5xl font-bold leading-none">
          <span className="mono text-3xl font-medium text-ink-2 mr-3">{s.minor ? "·" : s.id}</span>
          {s.label}
        </h3>
        <span className={`sign text-[15px] font-semibold px-3 py-1 ${TAG[s.change].cls}`}>{TAG[s.change].text}</span>
      </div>
      <div className="mt-5 grid gap-8 md:grid-cols-2">
        <section>
          <h4 className="rule-head text-v1">v1 · the repo today</h4>
          {s.v1 ? (
            <>
              <p>{s.v1.does}</p>
              <p className="mt-2 mono text-[13px] text-ink-2 leading-snug">Produces: {s.v1.outputs}</p>
            </>
          ) : (
            <p className="text-ink-2 italic">Doesn&apos;t exist in v1.</p>
          )}
        </section>
        <section>
          <h4 className="rule-head text-v2">v2 · amended</h4>
          <p>{s.v2.does}</p>
          {s.v2.adds.length > 0 && (
            <ul className="mt-3 space-y-1.5 text-[16.5px]">
              {s.v2.adds.map((a) => (
                <li key={a} className="pl-5 relative before:content-[''] before:absolute before:left-0 before:top-[0.6em] before:w-3 before:h-[3px] before:bg-v2">{a}</li>
              ))}
            </ul>
          )}
          {s.v2.refs.length > 0 && (
            <p className="mt-3 flex flex-wrap items-center gap-2">
              <span className="sign text-[14px] text-ink-2">Because of</span>
              {s.v2.refs.map((r) => (
                <button key={r} type="button" onClick={() => onOpenFinding(r)} className="mono text-[13px] font-medium border-2 border-ink px-2 py-0.5 hover:bg-ink hover:text-paper">{r}</button>
              ))}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
