import { pgTable, varchar, timestamp, jsonb, index } from "drizzle-orm/pg-core";

export const auditLog = pgTable("audit_log", {
  id: varchar("id", { length: 128 }).primaryKey(),
  userId: varchar("user_id", { length: 128 }),
  accountId: varchar("account_id", { length: 128 }),
  action: varchar("action", { length: 100 }).notNull(),
  targetType: varchar("target_type", { length: 50 }),
  targetId: varchar("target_id", { length: 128 }),
  metadata: jsonb("metadata").default({}),
  ipAddress: varchar("ip_address", { length: 45 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("audit_log_user_id_idx").on(table.userId),
  index("audit_log_account_id_idx").on(table.accountId),
  index("audit_log_action_idx").on(table.action),
  index("audit_log_created_at_idx").on(table.createdAt),
]);
