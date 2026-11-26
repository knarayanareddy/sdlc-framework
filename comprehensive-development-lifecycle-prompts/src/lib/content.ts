import "server-only";
import fs from "node:fs";
import path from "node:path";
import { CONTENT_FILES, type ContentSlug } from "./content-manifest";

export { CONTENT_FILES, isContentSlug, type ContentSlug } from "./content-manifest";

// Build-time roots. Literal bases keep the bundler from tracing the whole repo, and
// turbopackIgnore stops the "dynamic filesystem access" trace: every path here comes from
// the allowlist above, never from user input, and nothing is read at request time.
const CONTENT_ROOT = path.join(process.cwd(), "content");
const PIPELINE_ROOT = path.resolve(process.cwd(), "..", "pipeline");

// Slugs are checked against the allowlist before they get here and are never joined into a path.
export function readContent(slug: ContentSlug): string {
  const meta = CONTENT_FILES[slug];
  const base = meta.root === "content" ? CONTENT_ROOT : path.join(PIPELINE_ROOT, meta.root.replace("../pipeline/", ""));
  return fs.readFileSync(path.resolve(/* turbopackIgnore: true */ base, meta.file), "utf8");
}
