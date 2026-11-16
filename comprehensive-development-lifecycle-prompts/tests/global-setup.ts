import { Client } from "pg";
import { adminUrl, testDatabaseUrl } from "./test-db";

// Creates the throwaway test database and its table. Mirrors src/db/schema.ts; tests/gates.test.ts
// checks the two haven't drifted apart.
export default async function setup() {
  const base = process.env.DATABASE_URL;
  const testUrl = testDatabaseUrl(base);
  const dbName = new URL(testUrl).pathname.slice(1);

  const admin = new Client({ connectionString: adminUrl(base!) });
  await admin.connect();
  const exists = await admin.query("select 1 from pg_database where datname = $1", [dbName]);
  if (exists.rowCount === 0) await admin.query(`create database "${dbName.replace(/"/g, "")}"`);
  await admin.end();

  const c = new Client({ connectionString: testUrl });
  await c.connect();
  await c.query(
    `create table if not exists gate_status (
       gate text primary key,
       status text not null,
       note text not null default '',
       updated_at timestamptz not null default now()
     )`,
  );
  await c.end();
}
