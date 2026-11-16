import { db } from "@/db";
import { gateStatus } from "@/db/schema";
import { eq } from "drizzle-orm";
import { MAX_BODY_BYTES, parseGateUpdate } from "@/lib/gates";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { ...NO_STORE, ...extra } });
}

export async function GET(request: Request) {
  try {
    const rows = await db.select().from(gateStatus);
    const gates: Record<string, { status: string; note: string; updatedAt: string }> = {};
    for (const r of rows) gates[r.gate] = { status: r.status, note: r.note, updatedAt: r.updatedAt.toISOString() };

    if (new URL(request.url).searchParams.get("download") === "1") {
      const progress = { phase: null, gates, exportedAt: new Date().toISOString() };
      return new Response(JSON.stringify(progress, null, 2), {
        headers: { ...NO_STORE, "Content-Type": "application/json", "Content-Disposition": 'attachment; filename="progress.json"' },
      });
    }
    return json({ gates });
  } catch {
    return json({ error: "Could not read gate status." }, 500);
  }
}

export async function PUT(request: Request) {
  // Same-origin check: a cross-site form or fetch cannot change the board.
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (origin) {
    let originHost = "";
    try {
      originHost = new URL(origin).host;
    } catch {
      return json({ error: "Bad origin." }, 403);
    }
    if (originHost !== host) return json({ error: "Cross-origin writes are not allowed." }, 403);
  }
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return json({ error: "Content-Type must be application/json." }, 415);
  }

  // Enforce the size limit on the bytes actually read, not on the (spoofable) header.
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return json({ error: "Body too large." }, 413);

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(raw);
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }
  const parsed = parseGateUpdate(parsedBody);
  if (!parsed.ok) return json({ error: parsed.error }, 422);
  const { gate, status, note } = parsed.value;

  try {
    if (status === null) {
      await db.delete(gateStatus).where(eq(gateStatus.gate, gate));
      return json({ gate, status: null });
    }
    const now = new Date();
    await db
      .insert(gateStatus)
      .values({ gate, status, note, updatedAt: now })
      .onConflictDoUpdate({ target: gateStatus.gate, set: { status, note, updatedAt: now } });
    return json({ gate, status, note, updatedAt: now.toISOString() });
  } catch {
    return json({ error: "Could not save gate status." }, 500);
  }
}
