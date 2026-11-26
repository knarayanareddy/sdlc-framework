// `progress.rounds` used to be a literal `{ full: 0, diff: 0 }` that nothing incremented, so the
// stop rule ("at most 3 FULL rounds") could never trigger and every report said zero rounds.
// A round is a fact about an artifact, not a number someone types: it is the `mode` of the
// findings file the phase just produced. This module keeps that derivation in one place so it
// can be tested without running a whole pipeline.
import fs from "node:fs";

export const ROUND_PHASES = ["08", "09"];
export const MODES = ["FULL", "DIFF"];

/**
 * Record the round implied by `findingsPath` on `progress`. Mutates and returns progress,
 * or returns null when the phase is not a round or the evidence is not there (so the caller
 * can stay quiet rather than invent a round).
 */
export function recordRound(progress, phaseId, findingsPath) {
  if (!ROUND_PHASES.includes(String(phaseId))) return null;
  let mode = null;
  try {
    mode = JSON.parse(fs.readFileSync(findingsPath, "utf8")).mode ?? null;
  } catch {
    return null;
  }
  if (!MODES.includes(mode)) return null;
  const log = (progress.roundLog ?? []).filter((r) => r.phase !== String(phaseId));
  log.push({ phase: String(phaseId), mode, at: new Date().toISOString() });
  progress.roundLog = log;
  progress.rounds = {
    full: log.filter((r) => r.mode === "FULL").length,
    diff: log.filter((r) => r.mode === "DIFF").length,
  };
  return progress;
}
