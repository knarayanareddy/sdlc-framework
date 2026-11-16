import type { Catch, Defect } from "./pipeline-data";

export const PHASE_ORDER = ["00", "01", "02", "H1", "03", "04", "FZ", "05", "06", "07", "08", "09", "10", "11", "12"] as const;

export const pos = (id: string) => PHASE_ORDER.indexOf(id as (typeof PHASE_ORDER)[number]);

export interface Outcome {
  kind: "prevented" | "stopped" | "escapes";
  at?: string;
  catchRef?: Catch;
}

// What happens to a defect in a given version of the pipeline.
// - a "prevent" control at or before the origin stops it from ever entering
// - otherwise the first non-late control at or after the origin stops it
// - a "late" control only counts as a catch after the harm is done, so the defect still escapes
export function outcome(d: Defect, catches: Catch[]): Outcome {
  const prevent = catches.find((c) => c.kind === "prevent" && pos(c.at) <= pos(d.origin));
  if (prevent) return { kind: "prevented", at: prevent.at, catchRef: prevent };
  const after = catches.filter((c) => pos(c.at) >= pos(d.origin)).sort((a, b) => pos(a.at) - pos(b.at));
  const firstReal = after.find((c) => c.kind !== "late");
  if (firstReal) return { kind: "stopped", at: firstReal.at, catchRef: firstReal };
  if (after.length) return { kind: "escapes", at: after[0].at, catchRef: after[0] };
  return { kind: "escapes" };
}

export const strength = (o: Outcome) => (o.kind === "escapes" ? 0 : o.kind === "stopped" ? 1 : 2);
