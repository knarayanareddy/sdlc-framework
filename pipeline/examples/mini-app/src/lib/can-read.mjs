// Pure domain rule. No I/O, so it can be unit-tested without a database.
// SEC-001: ownership is a property of the data, and the query must carry the same clause.
export function canRead(item, member) {
  if (!item || !member) return false;
  return item.teamId === member.teamId;
}

export function validateItem({ url, title }) {
  if (typeof title !== "string") return { ok: false, code: "TITLE_INVALID" };
  const cleaned = title.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (cleaned.length === 0) return { ok: false, code: "TITLE_REQUIRED" };
  if (cleaned.length > 200) return { ok: false, code: "TITLE_TOO_LONG" };
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    return { ok: false, code: "URL_INVALID" };
  }
  if (!["http:", "https:"].includes(parsed.protocol)) return { ok: false, code: "URL_SCHEME" };
  if (String(url).length > 2048) return { ok: false, code: "URL_TOO_LONG" };
  return { ok: true, value: { url: String(url), title: cleaned } };
}
