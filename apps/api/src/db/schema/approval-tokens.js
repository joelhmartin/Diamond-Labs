import { pgTable, varchar, timestamp, index } from "drizzle-orm/pg-core";
import { users } from "./users.js";

export const approvalTokens = pgTable("approval_tokens", {
  id: varchar("id", { length: 128 }).primaryKey(),
  userId: varchar("user_id", { length: 128 }).notNull().references(() => users.id),
  token: varchar("token", { length: 255 }).notNull().unique(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("approval_tokens_token_idx").on(table.token),
  index("approval_tokens_user_id_idx").on(table.userId),
]);
