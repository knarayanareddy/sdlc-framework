import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { DEFECTS, FINDINGS, GATES, RULES, STATIONS } from "../src/lib/pipeline-data";
import { PHASE_ORDER, outcome, pos, strength } from "../src/lib/outcome";
import { GATE_IDS } from "../src/lib/gates";
import { CONTENT_FILES } from "../src/lib/content-manifest";

const CONTENT_META = CONTENT_FILES as Record<string, { file: string; root?: string }>;

const review = fs.readFileSync(path.join(__dirname, "..", "content", "REVIEW-AND-V2.md"), "utf8");

describe("map data integrity", () => {
  it("has unique station and gate ids and no collisions between them", () => {
    const ids = [...STATIONS.map((s) => s.id), ...GATES.map((g) => g.id)];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gate ids on the map equal the ids the API accepts", () => {
    expect(GATES.map((g) => g.id).sort()).toEqual([...GATE_IDS].sort());
  });

  it("every new station has no v1 entry, and every other station has one", () => {
    for (const s of STATIONS) {
      if (s.change === "new") expect(s.v1, s.id).toBeUndefined();
      else expect(s.v1, s.id).toBeDefined();
    }
  });

  it("v1 has exactly the gates the framework defines (G1-G5, G7, G9, G10)", () => {
    expect(GATES.filter((g) => g.inV1).map((g) => g.id).sort()).toEqual(["G1", "G10", "G2", "G3", "G4", "G5", "G7", "G9"]);
  });

  it("every v1 gate has v1 text and every gate has v2 text", () => {
    for (const g of GATES) {
      if (g.inV1) expect(g.v1Check?.length ?? 0, g.id).toBeGreaterThan(10);
      expect(g.v2Check.trim().length, g.id).toBeGreaterThan(0);
    }
  });
});

describe("findings stay in sync with the written review", () => {
  it("every finding id in the app appears as a heading in REVIEW-AND-V2.md, and vice versa", () => {
    const inDoc = [...review.matchAll(/^### (R-\d+)\b/gm)].map((m) => m[1]);
    expect(inDoc.sort()).toEqual(FINDINGS.map((f) => f.id).sort());
  });

  it("severity and built status agree with the document where it states them", () => {
    for (const f of FINDINGS) {
      const m = review.match(new RegExp(`^### ${f.id} · ([^·]+) · (.*?)(?: — \\*\\*BUILT\\*\\*)?$`, "m"));
      expect(m, f.id).not.toBeNull();
      expect(m![1].trim(), f.id).toBe(f.sev);
      expect(/BUILT/.test(m![0]), `${f.id} built flag`).toBe(f.status === "built");
    }
  });

  it("every ref used by a station or defect is a real finding", () => {
    const known = new Set(FINDINGS.map((f) => f.id));
    for (const s of STATIONS) for (const r of s.v2.refs) expect(known.has(r), `${s.id} → ${r}`).toBe(true);
    for (const d of DEFECTS) expect(known.has(d.ref), `${d.id} → ${d.ref}`).toBe(true);
  });

  it("every finding points at stations that exist", () => {
    const ids = new Set(STATIONS.map((s) => s.id));
    for (const f of FINDINGS) for (const s of f.stations) expect(ids.has(s), `${f.id} → ${s}`).toBe(true);
  });

  it("the review document's file allowlist points at files that exist", () => {
    for (const [slug, meta] of Object.entries(CONTENT_META)) {
      const base = path.resolve(__dirname, "..", meta.root ?? "content", meta.file);
      expect(fs.existsSync(base), `${slug} → ${base}`).toBe(true);
    }
  });
});

describe("defect tracer rules", () => {
  it("every catch location and origin is a known phase", () => {
    for (const d of DEFECTS) {
      expect(pos(d.origin), `${d.id} origin`).toBeGreaterThanOrEqual(0);
      for (const c of [...d.v1, ...d.v2]) expect(PHASE_ORDER as readonly string[], `${d.id} ${c.at}`).toContain(c.at);
    }
  });

  it("v1 only uses phases that exist in v1", () => {
    const v1 = new Set(["01", "02", "03", "04", "05", "06", "07", "08", "09", "10"]);
    for (const d of DEFECTS) for (const c of d.v1) expect(v1.has(c.at), `${d.id} v1 at ${c.at}`).toBe(true);
  });

  it("a catch placed before the defect's origin must be a 'prevent' control", () => {
    for (const d of DEFECTS) {
      for (const c of [...d.v1, ...d.v2]) {
        if (pos(c.at) < pos(d.origin)) expect(c.kind, `${d.id} at ${c.at}`).toBe("prevent");
      }
    }
  });

  it("v2 is never weaker than v1 for any defect (this app claims improvement, so check it)", () => {
    for (const d of DEFECTS) expect(strength(outcome(d, d.v2)), d.id).toBeGreaterThanOrEqual(strength(outcome(d, d.v1)));
  });

  it("a late catch alone does not count as a stop", () => {
    const d = DEFECTS.find((x) => x.id === "d8")!;
    expect(outcome(d, d.v1).kind).toBe("escapes");
    expect(outcome(d, d.v2).kind).toBe("prevented");
  });

  it("at least one defect escapes v1 entirely and none escapes v2 entirely", () => {
    expect(DEFECTS.some((d) => outcome(d, d.v1).kind === "escapes")).toBe(true);
    expect(DEFECTS.every((d) => outcome(d, d.v2).kind !== "escapes")).toBe(true);
  });
});

describe("enforcement ladder", () => {
  it("never claims v2 is weaker than v1, and 'built' is only used where the review says BUILT", () => {
    for (const r of RULES) expect(r.v2, r.id).toBeGreaterThanOrEqual(r.v1);
    expect(RULES.filter((r) => r.built === "built").length).toBe(1);
  });
});
