import { pgTable, varchar, timestamp, index } from "drizzle-orm/pg-core";
import { users } from "./users.js";

export const approvalTokens = pgTable("approval_tokens", {
  id: varchar("id", { length: 128 }).primaryKey(),
  userId: varchar("user_id", { length: 128 }).notNull().references(() => users.id),
  token: varchar("token", { length: 255 }).notNull().unique(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  // The Seazona client this approval CONFIRMS, fixed when the token is minted
  // (the email-matched suggestion the admin is shown). "Approve" links exactly
  // this client id and only if it still equals the user's pending suggestion;
  // it cannot be swapped after the admin saw it. Null = nothing to confirm.
  seazonaClientId: varchar("seazona_client_id", { length: 100 }),
  // What the admin is shown for that client (Seazona's own record, not form input).
  seazonaClientLabel: varchar("seazona_client_label", { length: 255 }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("approval_tokens_token_idx").on(table.token),
  index("approval_tokens_user_id_idx").on(table.userId),
]);
