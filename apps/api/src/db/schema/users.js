import { pgTable, varchar, timestamp, boolean, pgEnum, index, text } from "drizzle-orm/pg-core";

export const userStatusEnum = pgEnum("user_status", ["active", "suspended", "deleted"]);
export const userRoleEnum = pgEnum("user_role", ["user", "doctor", "admin"]);
export const approvalStatusEnum = pgEnum("approval_status", ["not_required", "pending", "approved", "rejected"]);

export const users = pgTable("users", {
  id: varchar("id", { length: 128 }).primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  passwordHash: varchar("password_hash", { length: 255 }),
  name: varchar("name", { length: 100 }).notNull(),
  avatarUrl: varchar("avatar_url", { length: 500 }),
  mfaSecret: varchar("mfa_secret", { length: 500 }),
  mfaEnabled: boolean("mfa_enabled").notNull().default(false),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  status: userStatusEnum("status").notNull().default("active"),
  role: userRoleEnum("role").notNull().default("user"),
  approvalStatus: approvalStatusEnum("approval_status").notNull().default("not_required"),
  seazonaClientId: varchar("seazona_client_id", { length: 100 }),
  seazonaAccountNumber: varchar("seazona_account_number", { length: 100 }),
  authorizeNetCustomerProfileId: varchar("authorize_net_customer_profile_id", { length: 100 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("users_email_idx").on(table.email),
]);
