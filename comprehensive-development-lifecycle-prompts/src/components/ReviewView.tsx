"use client";

import { useEffect, useState } from "react";
import { FINDINGS, KEEP, type Severity } from "@/lib/pipeline-data";

const SEV_CLS: Record<Severity, string> = {
  High: "bg-bad text-paper",
  Medium: "bg-ink text-paper",
  "Low–Medium": "border-2 border-ink text-ink",
  Low: "border-2 border-ink-2 text-ink-2",
};
const SEVS: Severity[] = ["High", "Medium", "Low–Medium", "Low"];

export function ReviewView({ focus }: { focus: string | null }) {
  const [open, setOpen] = useState<string | null>(focus ?? FINDINGS[0].id);
  const [filter, setFilter] = useState<Severity | "all">("all");

  // The view mounts fresh when a finding is opened from another tab, so `focus` seeds the state above.
  useEffect(() => {
    if (focus) document.getElementById(`f-${focus}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focus]);

  const shown = FINDINGS.filter((f) => filter === "all" || f.sev === filter);
  const built = FINDINGS.filter((f) => f.status === "built").length;

  return (
    <div className="py-8">
      <div className="grid gap-10 lg:grid-cols-[1fr_340px]">
        <div>
          <p className="sign text-[15px] font-semibold text-ink-2">The question</p>
          <h3 className="sign text-4xl font-bold leading-tight max-w-3xl">Does your red-team prompt work effectively?</h3>
          <div className="mt-4 max-w-2xl space-y-3">
            <p>
              <strong>As a seed, yes. As the only safeguard, no.</strong> Tracing every untrusted datum, demanding a deterministic repro and running post-patch validation are the right instincts. In one context, though, the hunter, verifier and patcher are the same agent, and nothing says when to stop or whether enough was found.
            </p>
            <p>
              The repo fixes most of that well. I read all eleven prompts, the spec template and the one tool, and ran the tool. I found {FINDINGS.length} things I would change: {FINDINGS.filter((f) => f.sev === "High").length} high severity. I fixed the one I could prove and test ({built} built), and wrote the rest as prompts.
            </p>
            <p className="text-ink-2">
              Not done: I did not run either version on a real product, so nothing here measures how well they perform. The repo&apos;s own &ldquo;6/10 → 9/10&rdquo; has no measurement behind it either; v2 adds the instrumentation to find out.
            </p>
          </div>
        </div>
        <aside aria-label="What to keep">
          <h4 className="rule-head">Keep, unchanged</h4>
          <ul className="space-y-1.5 text-[16.5px]">
            {KEEP.map((k) => (
              <li key={k} className="pl-5 relative before:content-['✓'] before:absolute before:left-0 before:text-ok before:font-bold">{k}</li>
            ))}
          </ul>
        </aside>
      </div>

      <div className="mt-10 flex flex-wrap items-center gap-2" role="group" aria-label="Filter by severity">
        <span className="sign font-semibold mr-2">Findings</span>
        {(["all", ...SEVS] as const).map((s) => (
          <button key={s} type="button" aria-pressed={filter === s} onClick={() => setFilter(s)} className={`sign px-3 py-1 text-[15px] font-semibold border-2 border-ink ${filter === s ? "bg-ink text-paper" : "hover:bg-paper-2"}`}>
            {s === "all" ? `All ${FINDINGS.length}` : `${s} ${FINDINGS.filter((f) => f.sev === s).length}`}
          </button>
        ))}
      </div>

      <ol className="mt-3 border-t-2 border-ink divide-y divide-rule">
        {shown.map((f) => {
          const isOpen = open === f.id;
          return (
            <li key={f.id} id={`f-${f.id}`}>
              <h4>
                <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : f.id)} className="w-full text-left py-3 grid grid-cols-[64px_104px_1fr_auto] items-baseline gap-3 hover:bg-paper-2 px-1">
                  <span className="mono text-[14px] font-medium">{f.id}</span>
                  <span className={`sign text-[13px] font-semibold px-2 py-0.5 text-center ${SEV_CLS[f.sev]}`}>{f.sev}</span>
                  <span className={`text-[19px] leading-snug ${isOpen ? "font-semibold" : ""}`}>{f.title}</span>
                  <span className="mono text-[12px] text-ink-2">{f.status === "built" ? "built" : "specified"}</span>
                </button>
              </h4>
              {isOpen && (
                <div className="grid gap-6 md:grid-cols-2 pb-5 pl-[68px] pr-2">
                  <div>
                    <p className="sign text-[14px] font-semibold text-ink-2">Evidence</p>
                    <p>{f.evidence}</p>
                  </div>
                  <div>
                    <p className="sign text-[14px] font-semibold text-v2">v2 change</p>
                    <p>{f.fix}</p>
                    <p className="mt-2 mono text-[12px] text-ink-2">Stations: {f.stations.join(" · ")}</p>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <section className="mt-10 max-w-2xl">
        <h4 className="rule-head">Reproduce R-01 yourself</h4>
        <pre className="mono text-[13px] bg-ink text-paper p-4 overflow-x-auto leading-relaxed">{`node content/tools/trace-check-v2.selftest.mjs\n# 7 cases. v1's trace-check passes the first three; v2 fails them.`}</pre>
        <p className="mt-2 text-[14px] text-ink-2">The self-test asserts exit codes only, so a case could in principle fail for a different reason than the intended one.</p>
      </section>
    </div>
  );
}
