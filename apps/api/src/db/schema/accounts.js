import { pgTable, varchar, timestamp, jsonb, pgEnum, index } from "drizzle-orm/pg-core";
import { users } from "./users.js";

export const accountPlanEnum = pgEnum("account_plan", ["free", "starter", "pro", "enterprise"]);
export const accountStatusEnum = pgEnum("account_status", ["active", "suspended", "deleted"]);

export const accounts = pgTable("accounts", {
  id: varchar("id", { length: 128 }).primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  slug: varchar("slug", { length: 50 }).notNull().unique(),
  ownerId: varchar("owner_id", { length: 128 }).notNull().references(() => users.id),
  logoUrl: varchar("logo_url", { length: 500 }),
  settings: jsonb("settings").default({}),
  plan: accountPlanEnum("plan").notNull().default("free"),
  status: accountStatusEnum("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("accounts_slug_idx").on(table.slug),
  index("accounts_owner_id_idx").on(table.ownerId),
]);
