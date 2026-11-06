import { sql } from "drizzle-orm";
import { pgTable, varchar, jsonb, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

// Named groups of accounts, with admins who act across the whole group. No DB
// foreign keys to the host's accounts/users (repo convention, like record_tags):
// ids are opaque strings and the host checks they exist. An account belongs to
// at most one organization (unique account_id).

export const organizations = pgTable("organizations", {
  id: varchar("id", { length: 128 }).primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  settings: jsonb("settings").notNull().default({}),
  status: varchar("status", { length: 10 }).notNull().default("active"), // active | archived
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("organizations_name_lower_idx").on(sql`lower(${t.name})`)]);

export const organizationAccounts = pgTable("organization_accounts", {
  organizationId: varchar("organization_id", { length: 128 }).notNull().references(() => organizations.id, { onDelete: "cascade" }),
  accountId: varchar("account_id", { length: 128 }).notNull(),
  addedBy: varchar("added_by", { length: 128 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("organization_accounts_account_idx").on(t.accountId),
  index("organization_accounts_org_idx").on(t.organizationId),
]);

export const organizationAdmins = pgTable("organization_admins", {
  id: varchar("id", { length: 128 }).primaryKey(),
  organizationId: varchar("organization_id", { length: 128 }).notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: varchar("user_id", { length: 128 }).notNull(),
  status: varchar("status", { length: 10 }).notNull().default("active"), // active | removed
  addedBy: varchar("added_by", { length: 128 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("organization_admins_org_user_idx").on(t.organizationId, t.userId),
  index("organization_admins_user_idx").on(t.userId),
]);
