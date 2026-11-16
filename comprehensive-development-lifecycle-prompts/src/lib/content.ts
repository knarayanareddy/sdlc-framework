import "server-only";
import fs from "node:fs";
import path from "node:path";
import { CONTENT_FILES, type ContentSlug } from "./content-manifest";

export { CONTENT_FILES, isContentSlug, type ContentSlug } from "./content-manifest";

// Slugs are checked against the allowlist before they get here and are never joined into a path.
export function readContent(slug: ContentSlug): string {
  return fs.readFileSync(path.join(process.cwd(), "content", CONTENT_FILES[slug].file), "utf8");
}
