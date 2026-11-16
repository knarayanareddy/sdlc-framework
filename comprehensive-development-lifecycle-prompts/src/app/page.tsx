import { db } from "@/db";
import { gateStatus } from "@/db/schema";
import { CONTENT_FILES, readContent, type ContentSlug } from "@/lib/content";
import { Atlas, type LibraryItem, type GateRecord } from "@/components/Atlas";

export const dynamic = "force-dynamic";

async function loadGates(): Promise<Record<string, GateRecord>> {
  try {
    const rows = await db.select().from(gateStatus);
    return Object.fromEntries(rows.map((r) => [r.gate, { status: r.status, note: r.note }]));
  } catch {
    return {};
  }
}

export default async function HomePage() {
  const gates = await loadGates();
  const library: LibraryItem[] = (Object.keys(CONTENT_FILES) as ContentSlug[]).map((slug) => ({
    slug,
    title: CONTENT_FILES[slug].title,
    kind: CONTENT_FILES[slug].kind,
    text: readContent(slug),
  }));
  return <Atlas initialGates={gates} library={library} />;
}
