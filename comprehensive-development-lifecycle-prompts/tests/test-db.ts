// Tests never touch the app's real database. They derive a sibling database named <name>_test.
export function testDatabaseUrl(base: string | undefined): string {
  if (!base) throw new Error("DATABASE_URL is required to derive the test database URL");
  const u = new URL(base);
  const name = u.pathname.replace(/^\//, "");
  u.pathname = `/${name.endsWith("_test") ? name : `${name}_test`}`;
  return u.toString();
}

export function adminUrl(base: string): string {
  const u = new URL(base);
  u.pathname = "/postgres";
  return u.toString();
}
