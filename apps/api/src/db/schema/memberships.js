import { pgTable, varchar, timestamp, pgEnum, uniqueIndex, index } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { accounts } from "./accounts.js";

export const membershipRoleEnum = pgEnum("membership_role", ["owner", "admin", "manager", "member", "viewer"]);
export const membershipStatusEnum = pgEnum("membership_status", ["active", "suspended", "removed"]);

export const memberships = pgTable("memberships", {
  id: varchar("id", { length: 128 }).primaryKey(),
  userId: varchar("user_id", { length: 128 }).notNull().references(() => users.id),
  accountId: varchar("account_id", { length: 128 }).notNull().references(() => accounts.id),
  role: membershipRoleEnum("role").notNull().default("member"),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  status: membershipStatusEnum("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("memberships_user_account_idx").on(table.userId, table.accountId),
  index("memberships_account_id_idx").on(table.accountId),
  index("memberships_user_id_idx").on(table.userId),
]);
