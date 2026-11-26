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
export function recordRound(progress, phaseId, findingsPath, { coverageVerified = null } = {}) {
  if (!ROUND_PHASES.includes(String(phaseId))) return null;
  let mode = null;
  try {
    mode = JSON.parse(fs.readFileSync(findingsPath, "utf8")).mode ?? null;
  } catch {
    return null;
  }
  if (!MODES.includes(mode)) return null;
  // `mode` is what the findings file says, and the findings file is written by the red team.
  // A FULL round means every entry point was hunted, so it needs the coverage evidence: without
  // it the round is DIFF, and the log says why (SECOND-OPINION-3 G-13).
  let note = null;
  if (mode === "FULL" && coverageVerified !== true) {
    note =
      coverageVerified === false
        ? "findings claim FULL, but coverage-gate did not pass over every entry point"
        : "findings claim FULL, but there is no coverage evidence for this round";
    mode = "DIFF";
  }
  // Keyed by {phase, runDir}: making 08 and 09 the key meant a second pass through either phase
  // replaced the first, so `rounds.full` could never exceed 2 and the stop-at-3 rule was
  // unreachable (SECOND-OPINION-3 G-13). `--run` names the directory the round wrote.
  const runDir = progress.runDir ?? null;
  const log = (progress.roundLog ?? []).filter((r) => !(r.phase === String(phaseId) && (r.runDir ?? null) === runDir));
  log.push({ phase: String(phaseId), runDir, mode, at: new Date().toISOString(), ...(note ? { note } : {}) });
  progress.roundLog = log;
  progress.rounds = {
    full: log.filter((r) => r.mode === "FULL").length,
    diff: log.filter((r) => r.mode === "DIFF").length,
  };
  return progress;
}
