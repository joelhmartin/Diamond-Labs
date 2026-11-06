import { pgTable, varchar, boolean, timestamp, jsonb, pgEnum, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
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
  // Practice groups: a client practice (shopper and staff personal accounts stay false).
  isClient: boolean("is_client").notNull().default(false),
  // The lab's account number (copied from the owner doctor's Seazona account number); unique when set.
  accountNumber: varchar("account_number", { length: 100 }),
  // The Seazona client id: the import's join key; unique when set.
  legacyClientKey: varchar("legacy_client_key", { length: 100 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("accounts_slug_idx").on(table.slug),
  index("accounts_owner_id_idx").on(table.ownerId),
  uniqueIndex("accounts_account_number_idx").on(table.accountNumber).where(sql`${table.accountNumber} is not null`),
  uniqueIndex("accounts_legacy_client_key_idx").on(table.legacyClientKey).where(sql`${table.legacyClientKey} is not null`),
]);
