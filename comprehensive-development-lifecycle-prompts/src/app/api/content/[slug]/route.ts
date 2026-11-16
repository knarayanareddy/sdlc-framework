import { CONTENT_FILES, isContentSlug, readContent } from "@/lib/content";

export const dynamic = "force-static";

export function generateStaticParams() {
  return Object.keys(CONTENT_FILES).map((slug) => ({ slug }));
}

export async function GET(_request: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  if (!isContentSlug(slug)) return new Response("Not found", { status: 404 });
  const meta = CONTENT_FILES[slug];
  const name = meta.file.split("/").pop() ?? "file.txt";
  return new Response(readContent(slug), {
    headers: {
      // text/plain + nosniff: downloaded content can never be interpreted as HTML by the browser.
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `attachment; filename="${name}"`,
    },
  });
}
