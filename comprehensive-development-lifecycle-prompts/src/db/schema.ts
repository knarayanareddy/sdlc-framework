import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

// One row per gate the user has marked. A missing row means "not yet evaluated".
// Mirrors the `gates` object in the framework's docs/progress.json.
export const gateStatus = pgTable("gate_status", {
  gate: text("gate").primaryKey(),
  status: text("status").notNull(), // passed | failed | NOT_VERIFIED (validated in the API layer)
  note: text("note").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
