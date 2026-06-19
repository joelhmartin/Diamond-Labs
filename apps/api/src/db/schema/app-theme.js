import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";

/**
 * Single-row global theme override. id is always "singleton". `tokens` maps
 * CSS-var keys (without leading --) to values, e.g. { "navy": "10 20 30" }.
 * Empty object = no override (app falls back to core index.css tokens).
 * Holds NO PHI.
 */
export const appTheme = pgTable("app_theme", {
  id: text("id").primaryKey().default("singleton"),
  tokens: jsonb("tokens").notNull().default({}),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});
