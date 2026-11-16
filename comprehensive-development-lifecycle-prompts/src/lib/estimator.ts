// Chapman capture–recapture estimator used by the v2 red-team stop rule (content/REVIEW-AND-V2.md §7.5).
// Pure functions so they can be unit-tested without a browser.

export interface EstimateInput {
  nA: number; // distinct confirmed findings in full run A
  nB: number; // distinct confirmed findings in full run B
  m: number; // findings found by BOTH runs
}

export type EstimateResult =
  | { ok: false; reason: string }
  | { ok: true; total: number; union: number; remaining: number; stop: boolean; note: string };

const isCount = (n: number) => Number.isInteger(n) && n >= 0 && n <= 100000;

export function chapman({ nA, nB, m }: EstimateInput): EstimateResult {
  if (![nA, nB, m].every(isCount)) return { ok: false, reason: "Enter whole numbers from 0 upward." };
  if (m > Math.min(nA, nB)) return { ok: false, reason: "The overlap cannot exceed the smaller run." };
  const union = nA + nB - m;
  if (m === 0) {
    return {
      ok: false,
      reason:
        nA + nB === 0
          ? "Both runs found nothing. That is not evidence of a clean codebase. Run planted-bug calibration."
          : "No overlap means no estimate. Run another full round.",
    };
  }
  const total = ((nA + 1) * (nB + 1)) / (m + 1) - 1;
  const remaining = Math.max(0, total - union);
  const stop = remaining <= 1;
  return {
    ok: true,
    total,
    union,
    remaining,
    stop,
    note: stop
      ? "Estimated remaining is 1 or fewer. Stop only if a full round also produced 0 new confirmed findings."
      : "Estimated remaining is above 1. Run another full round, up to 3.",
  };
}
