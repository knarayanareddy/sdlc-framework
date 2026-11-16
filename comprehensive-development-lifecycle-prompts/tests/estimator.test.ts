import { describe, expect, it } from "vitest";
import { chapman } from "../src/lib/estimator";

describe("chapman capture–recapture estimator (v2 stop rule)", () => {
  it("matches the hand-computed Chapman value for 6, 5, 4", () => {
    // ((6+1)*(5+1))/(4+1) - 1 = 42/5 - 1 = 7.4 ; union = 6+5-4 = 7 ; remaining = 0.4
    const r = chapman({ nA: 6, nB: 5, m: 4 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.total).toBeCloseTo(7.4, 10);
      expect(r.union).toBe(7);
      expect(r.remaining).toBeCloseTo(0.4, 10);
      expect(r.stop).toBe(true);
    }
  });

  it("says keep going when the runs barely overlap", () => {
    // ((4+1)*(4+1))/(1+1) - 1 = 11.5 ; union = 7 ; remaining 4.5
    const r = chapman({ nA: 4, nB: 4, m: 1 });
    expect(r.ok && r.stop).toBe(false);
    expect(r.ok && r.remaining).toBeCloseTo(4.5, 10);
  });

  it("refuses to estimate when there is no overlap", () => {
    const r = chapman({ nA: 3, nB: 2, m: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/no overlap/i);
  });

  it("does not treat two empty runs as proof of a clean codebase", () => {
    const r = chapman({ nA: 0, nB: 0, m: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/not evidence/i);
  });

  it("rejects an overlap larger than either run, negatives, fractions and NaN", () => {
    expect(chapman({ nA: 2, nB: 5, m: 3 }).ok).toBe(false);
    expect(chapman({ nA: -1, nB: 5, m: 0 }).ok).toBe(false);
    expect(chapman({ nA: 1.5, nB: 5, m: 1 }).ok).toBe(false);
    expect(chapman({ nA: Number.NaN, nB: 5, m: 1 }).ok).toBe(false);
  });

  it("never reports negative remaining", () => {
    const r = chapman({ nA: 5, nB: 5, m: 5 });
    expect(r.ok && r.remaining).toBeGreaterThanOrEqual(0);
  });
});
