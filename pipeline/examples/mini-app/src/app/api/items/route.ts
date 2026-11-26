// Example route so the entry-point enumerator has something real to find.
// It is never executed: the demo only reads the source.
const databaseUrl = process.env.DATABASE_URL;

export async function GET() {
  if (!databaseUrl) return Response.json({ error: "DATABASE_URL is required" }, { status: 500 });
  return Response.json({ items: [] });
}

export async function POST(request: Request) {
  const body = await request.json();
  return Response.json({ ok: Boolean(body), id: "item_1" }, { status: 201 });
}
