import { pgTable, varchar, text, jsonb, boolean, timestamp, index } from "drizzle-orm/pg-core";

// A submitted Digital Rx case. Local-first authoritative record; status gates the
// (later) Seazona push. seazonaClientId is captured from the doctor's account at
// submit — never client-supplied.
export const rxCases = pgTable("rx_cases", {
  id: varchar("id", { length: 128 }).primaryKey(),
  caseNumber: varchar("case_number", { length: 32 }).notNull(),
  userId: varchar("user_id", { length: 128 }).notNull(),
  seazonaClientId: varchar("seazona_client_id", { length: 100 }),
  seazonaAccountNumber: varchar("seazona_account_number", { length: 50 }),
  practiceName: varchar("practice_name", { length: 200 }),
  patientFirst: varchar("patient_first", { length: 120 }).notNull(),
  patientLast: varchar("patient_last", { length: 120 }).notNull(),
  dob: varchar("dob", { length: 20 }),
  gender: varchar("gender", { length: 20 }),
  firstDevice: varchar("first_device", { length: 40 }),
  contactPhone: varchar("contact_phone", { length: 30 }),
  shipTo: jsonb("ship_to"),
  recordsMethod: varchar("records_method", { length: 40 }),
  physicalBite: varchar("physical_bite", { length: 40 }),
  deviceKey: varchar("device_key", { length: 60 }).notNull(),
  deviceCategory: varchar("device_category", { length: 30 }).notNull(),
  deviceOptions: jsonb("device_options").notNull().default({}),
  dueDate: varchar("due_date", { length: 30 }),
  rush: boolean("rush").notNull().default(false),
  rushTier: varchar("rush_tier", { length: 40 }),
  signatureUrl: text("signature_url"),
  generalComments: text("general_comments"),
  status: varchar("status", { length: 40 }).notNull().default("pending_approval"),
  seazonaPushStatus: varchar("seazona_push_status", { length: 40 }),
  seazonaOrderId: varchar("seazona_order_id", { length: 128 }),
  seazonaPushError: text("seazona_push_error"),
  payloadSnapshot: jsonb("payload_snapshot"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("rx_cases_user_id_idx").on(t.userId),
  index("rx_cases_status_idx").on(t.status),
  index("rx_cases_case_number_idx").on(t.caseNumber),
]);

export const rxCaseFiles = pgTable("rx_case_files", {
  id: varchar("id", { length: 128 }).primaryKey(),
  caseId: varchar("case_id", { length: 128 }).notNull(),
  kind: varchar("kind", { length: 30 }).notNull(), // scan|photo|prescription|sleep_study|artboard
  originalName: varchar("original_name", { length: 255 }),
  gcsUrl: text("gcs_url").notNull(),
  contentType: varchar("content_type", { length: 120 }),
  size: varchar("size", { length: 20 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("rx_case_files_case_id_idx").on(t.caseId)]);
