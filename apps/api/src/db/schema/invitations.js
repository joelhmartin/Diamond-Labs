import { pgTable, varchar, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { accounts } from "./accounts.js";
import { membershipRoleEnum } from "./memberships.js";

export const invitationStatusEnum = pgEnum("invitation_status", [
  "pending", "accepted", "declined", "expired", "revoked",
]);

export const invitations = pgTable("invitations", {
  id: varchar("id", { length: 128 }).primaryKey(),
  accountId: varchar("account_id", { length: 128 }).notNull().references(() => accounts.id),
  invitedById: varchar("invited_by_id", { length: 128 }).notNull().references(() => users.id),
  email: varchar("email", { length: 255 }).notNull(),
  role: membershipRoleEnum("role").notNull().default("member"),
  token: varchar("token", { length: 255 }).notNull().unique(),
  status: invitationStatusEnum("status").notNull().default("pending"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("invitations_token_idx").on(table.token),
  index("invitations_account_id_idx").on(table.accountId),
  index("invitations_email_idx").on(table.email),
]);
