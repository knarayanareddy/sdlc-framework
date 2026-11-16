// Shared, dependency-free gate vocabulary + input validation (used by the API and the tests).

export const GATE_IDS = ["G0", "G1", "G2", "G3", "G4", "G5", "G7", "G9", "G10", "G11", "G12"] as const;
export type GateId = (typeof GATE_IDS)[number];

export const GATE_STATUSES = ["passed", "failed", "NOT_VERIFIED"] as const;
export type GateState = (typeof GATE_STATUSES)[number];

export const MAX_NOTE = 280;
export const MAX_BODY_BYTES = 2048;

export interface GateUpdate {
  gate: GateId;
  status: GateState | null; // null clears the gate
  note: string;
}

export type ParseResult = { ok: true; value: GateUpdate } | { ok: false; error: string };

// Strict allowlist parser: unknown keys are rejected rather than ignored (no mass assignment).
export function parseGateUpdate(input: unknown): ParseResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, error: "Body must be a JSON object." };
  }
  const obj = input as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (key !== "gate" && key !== "status" && key !== "note") return { ok: false, error: `Unknown field: ${key.slice(0, 40)}` };
  }
  if (typeof obj.gate !== "string" || !(GATE_IDS as readonly string[]).includes(obj.gate)) {
    return { ok: false, error: "Unknown gate." };
  }
  let status: GateState | null = null;
  if (obj.status !== null && obj.status !== undefined) {
    if (typeof obj.status !== "string" || !(GATE_STATUSES as readonly string[]).includes(obj.status)) {
      return { ok: false, error: "Status must be passed, failed, NOT_VERIFIED or null." };
    }
    status = obj.status as GateState;
  }
  let note = "";
  if (obj.note !== undefined) {
    if (typeof obj.note !== "string") return { ok: false, error: "Note must be text." };
    note = obj.note.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
    if (note.length > MAX_NOTE) return { ok: false, error: `Note is limited to ${MAX_NOTE} characters.` };
  }
  return { ok: true, value: { gate: obj.gate as GateId, status, note } };
}
