"use client";

import { useState } from "react";

export interface LibraryItem {
  slug: string;
  title: string;
  kind: "doc" | "prompt" | "tool";
  text: string;
}

const GROUPS: { kind: LibraryItem["kind"]; label: string }[] = [
  { kind: "doc", label: "The new README section" },
  { kind: "prompt", label: "v2 prompts" },
  { kind: "tool", label: "Built and tested" },
];

export function PromptLibrary({ items }: { items: LibraryItem[] }) {
  const [slug, setSlug] = useState(items.find((i) => i.kind === "prompt")?.slug ?? items[0].slug);
  const [copied, setCopied] = useState<"idle" | "ok" | "fail">("idle");
  const cur = items.find((i) => i.slug === slug) ?? items[0];

  async function copy() {
    try {
      await navigator.clipboard.writeText(cur.text);
      setCopied("ok");
    } catch {
      setCopied("fail");
    }
    setTimeout(() => setCopied("idle"), 2200);
  }

  return (
    <div className="grid gap-10 lg:grid-cols-[300px_1fr] py-8">
      <nav aria-label="Prompt library">
        {GROUPS.map((g) => (
          <div key={g.kind} className="mb-6">
            <h3 className="rule-head">{g.label}</h3>
            <ul>
              {items.filter((i) => i.kind === g.kind).map((i) => (
                <li key={i.slug}>
                  <button type="button" aria-current={i.slug === slug} onClick={() => { setSlug(i.slug); setCopied("idle"); }} className={`w-full text-left py-2 px-3 leading-snug border-l-[6px] ${i.slug === slug ? "border-v2 bg-paper-2 font-semibold" : "border-transparent hover:bg-paper-2"}`}>
                    {i.title}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <p className="text-[14px] text-ink-2 leading-snug">
          Prompts amend the repo&apos;s <span className="mono text-[12px]">pipeline/prompts/</span> files. Everything marked SPECIFIED inside is a contract, not yet a built tool.
        </p>
      </nav>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="sign text-3xl font-bold mr-auto">{cur.title}</h3>
          <button type="button" onClick={copy} className="sign px-4 py-2 text-[17px] font-semibold border-2 border-ink bg-ink text-paper hover:bg-ink-2">
            {copied === "ok" ? "Copied" : copied === "fail" ? "Copy blocked: select the text" : "Copy"}
          </button>
          <a href={`/api/content/${cur.slug}`} download className="sign px-4 py-2 text-[17px] font-semibold border-2 border-ink hover:bg-paper-2">Download</a>
        </div>
        <pre tabIndex={0} aria-label={`${cur.title} source`} className="mono mt-4 max-h-[72vh] overflow-auto whitespace-pre-wrap break-words border-2 border-ink bg-paper-2 p-5 text-[13.5px] leading-relaxed">{cur.text}</pre>
      </div>
    </div>
  );
}
