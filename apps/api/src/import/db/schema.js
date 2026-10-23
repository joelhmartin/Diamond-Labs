import { pgTable, varchar, text, integer, boolean, jsonb, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";

// The piece-5 raw store: diamond_labs_import ONLY (drizzle.import.config.js,
// migrations in ./migrations). Never exported from src/db/schema/index.js and
// never migrated into the app DB. Payloads, files and the key check are sealed
// with PHI_ENCRYPTION_KEY (lib/crypto.js); everything else here is ids, counts,
// statuses and Seazona's own lastModified strings — no PHI.

export const RAW_ENTITIES = ["client", "product", "user", "invoice", "invoice_detail", "order", "order_detail"];

const created = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const seazonaRecords = pgTable("seazona_records", {
  id: varchar("id", { length: 128 }).primaryKey(),
  // RAW_ENTITIES
  entity: varchar("entity", { length: 20 }).notNull(),
  seazonaId: varchar("seazona_id", { length: 128 }).notNull(),
  // encryptJson(the record exactly as Seazona returned it)
  payload: text("payload").notNull(),
  // Seazona's lastModified for a summary; for a detail, its summary's lastModified at fetch time.
  lastModified: varchar("last_modified", { length: 40 }),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  fetchRunId: varchar("fetch_run_id", { length: 128 }).notNull(),
}, (t) => [
  uniqueIndex("seazona_records_entity_id_idx").on(t.entity, t.seazonaId),
  index("seazona_records_run_idx").on(t.fetchRunId),
]);

export const fetchRuns = pgTable("fetch_runs", {
  id: varchar("id", { length: 128 }).primaryKey(),
  entity: varchar("entity", { length: 20 }).notNull(),
  // summary | detail
  mode: varchar("mode", { length: 10 }).notNull(),
  // running | done | blocked | failed
  status: varchar("status", { length: 10 }).notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  requestCount: integer("request_count").notNull().default(0),
  errorCount: integer("error_count").notNull().default(0),
  // A detail run's Seazona ids, in fetch order (resume replays from `cursor`).
  plannedIds: jsonb("planned_ids"),
  cursor: integer("cursor").notNull().default(0),
  lastStatus: integer("last_status"),
  note: text("note"),
});

export const importFiles = pgTable("import_files", {
  id: varchar("id", { length: 128 }).primaryKey(),
  // balances_invoice | balances_client
  kind: varchar("kind", { length: 30 }).notNull(),
  sha256: varchar("sha256", { length: 64 }).notNull(),
  // encryptField(base64 of the uploaded bytes)
  content: text("content").notNull(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("import_files_kind_sha_idx").on(t.kind, t.sha256)]);

export const keyCheck = pgTable("key_check", {
  id: varchar("id", { length: 20 }).primaryKey(),
  value: text("value").notNull(),
  createdAt: created(),
});

export const parityReports = pgTable("parity_reports", {
  id: varchar("id", { length: 128 }).primaryKey(),
  // rehearsal | production
  target: varchar("target", { length: 20 }).notNull(),
  clean: boolean("clean").notNull(),
  // ids, counts and cents only (import/parity.js)
  report: jsonb("report").notNull(),
  createdAt: created(),
});
