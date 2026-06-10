import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";

/**
 * Ephemeral key/value store backing the small set of Redis operations the app
 * uses (auth tokens, login-attempt counters, OAuth state). Kept in Postgres so
 * everything stays under the existing Cloud SQL / Google Cloud BAA — no
 * third-party Redis vendor. TTL is enforced via expires_at (lazy on read +
 * a periodic sweep in config/redis.js). Holds NO PHI.
 */
export const kvStore = pgTable("kv_store", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
}, (table) => [
  index("kv_store_expires_at_idx").on(table.expiresAt),
]);
