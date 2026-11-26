// The calibration catalogue (v2-12 part 2). Each entry is a vulnerability that can be planted
// into real code so the red team can be measured against a known answer.
//
// `aliases` matter: a hunter describes an IDOR as "BOLA" or "object-level authorization", and
// recall must not be lost to vocabulary. `appliesTo` keeps the plan honest — do not plant a
// CSRF bug in a token-authenticated API and then call a miss a detection failure.

export const BUG_CLASSES = Object.freeze([
  {
    id: "idor",
    name: "Insecure direct object reference",
    aliases: ["bola", "object-level", "authorization", "authz", "id enumeration", "ownership"],
    appliesTo: ["route", "api"],
    plant: "drop the owner_id predicate from one :id lookup",
    observe: "another user's record is returned",
    severity: "high",
  },
  {
    id: "mass-assignment",
    name: "Mass assignment",
    aliases: ["over-posting", "overposting", "unfiltered body", "spread into update"],
    appliesTo: ["route", "api"],
    plant: "spread the request body into an update/insert without an allowlist",
    observe: "setting isAdmin/role in the body changes it",
    severity: "high",
  },
  {
    id: "open-redirect",
    name: "Open redirect",
    aliases: ["unvalidated redirect", "next= parameter", "redirect"],
    appliesTo: ["route", "web"],
    plant: "redirect to the next= query value without an allowlist",
    observe: "Location points at an external host",
    severity: "medium",
  },
  {
    id: "stored-xss",
    name: "Stored cross-site scripting",
    aliases: ["xss", "cross-site scripting", "dangerouslysetinnerhtml", "html injection"],
    appliesTo: ["web", "route"],
    plant: "render stored user content with dangerouslySetInnerHTML",
    observe: "a script tag stored in a record executes",
    severity: "high",
  },
  {
    id: "missing-rate-limit",
    name: "Missing rate limit on authentication",
    aliases: ["brute force", "rate limiting", "credential stuffing", "throttle"],
    appliesTo: ["route", "api"],
    plant: "remove the limiter from one login/reset handler",
    observe: "N attempts per minute succeed without a 429",
    severity: "medium",
  },
  {
    id: "race-unique",
    name: "Race on a uniqueness invariant",
    aliases: ["toctou", "double spend", "concurrency", "lost update"],
    appliesTo: ["api", "db"],
    plant: "check-then-insert without a unique constraint or transaction",
    observe: "two parallel requests both succeed",
    severity: "medium",
  },
  {
    id: "ssrf",
    name: "Server-side request forgery",
    aliases: ["ssrf", "url fetch", "metadata endpoint"],
    appliesTo: ["api", "route"],
    plant: "fetch a user-supplied URL with no allowlist",
    observe: "169.254.169.254 or localhost is fetched",
    severity: "high",
  },
  {
    id: "secret-in-client",
    name: "Secret exposed to the client",
    aliases: ["client bundle secret", "public env", "leaked key"],
    appliesTo: ["web", "build"],
    plant: "read a server secret through a NEXT_PUBLIC_/PUBLIC_ variable or inline it in a component",
    observe: "the value appears in the client bundle",
    severity: "high",
  },
  {
    id: "verbose-error",
    name: "Verbose error disclosure",
    aliases: ["stack trace", "error leakage", "information disclosure"],
    appliesTo: ["api", "route"],
    plant: "return err.stack or the driver message in a 500 body",
    observe: "stack/SQL text in the response",
    severity: "low",
  },
  {
    id: "csrf",
    name: "Cross-site request forgery on a cookie-authed mutation",
    aliases: ["csrf", "origin check", "samesite"],
    appliesTo: ["web", "route"],
    plant: "drop the origin check from one cookie-authenticated POST",
    observe: "a cross-origin form post succeeds",
    severity: "medium",
  },
  {
    id: "unbounded-pagination",
    name: "Unbounded pagination or list size",
    aliases: ["resource exhaustion", "limit bypass", "dos", "unbounded query"],
    appliesTo: ["api", "route"],
    plant: "read ?limit= straight into the query with no maximum",
    observe: "limit=1000000 returns everything",
    severity: "low",
  },
  {
    id: "sql-injection",
    name: "SQL injection",
    aliases: ["sqli", "string-built query", "raw sql", "injection"],
    appliesTo: ["api", "db"],
    plant: "concatenate a user value into a query",
    observe: "a quote changes the query or errors it",
    severity: "critical",
  },
  {
    id: "path-traversal",
    name: "Path traversal / arbitrary file read",
    aliases: ["lfi", "directory traversal", "file read"],
    appliesTo: ["api", "route"],
    plant: "join a user value into a filesystem path",
    observe: "../../etc/passwd is served",
    severity: "high",
  },
  {
    id: "prototype-pollution",
    name: "Prototype pollution via recursive merge",
    aliases: ["prototype pollution", "deep merge", "proto"],
    appliesTo: ["api", "web"],
    plant: "deep-merge a request body into an object",
    observe: "({}).polluted becomes true",
    severity: "medium",
  },
]);

export const classById = (id) => BUG_CLASSES.find((c) => c.id === id) ?? null;

// Map whatever a hunter wrote onto a catalogue class, or null.
export function normaliseClass(text) {
  const t = String(text ?? "").toLowerCase();
  if (!t) return null;
  for (const c of BUG_CLASSES) {
    if (t === c.id) return c.id;
  }
  for (const c of BUG_CLASSES) {
    if (t.includes(c.id) || c.aliases.some((a) => t.includes(a))) return c.id;
  }
  return null;
}

// Deterministic PRNG so a plan can be reproduced from its seed.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function selectClasses({ n, seed = 1, only = [], pool = BUG_CLASSES }) {
  const eligible = only.length ? pool.filter((c) => only.includes(c.id)) : pool;
  if (n > eligible.length) return { error: `asked for ${n} classes but only ${eligible.length} are eligible` };
  const rand = mulberry32(seed);
  const shuffled = [...eligible];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return { classes: shuffled.slice(0, n) };
}
