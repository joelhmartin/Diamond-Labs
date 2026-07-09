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
  // PHI (HIPAA §164.312(a)(2)(iv)) — encrypted at rest via services/rx/phi-crypto.js.
  // Ciphertext (`enc:v1:<base64>`) exceeds the old varchar limits, so these are text.
  patientFirst: text("patient_first").notNull(),
  patientLast: text("patient_last").notNull(),
  dob: text("dob"),
  gender: varchar("gender", { length: 20 }),
  firstDevice: varchar("first_device", { length: 40 }),
  contactPhone: text("contact_phone"),
  // PHI JSON blob — stored as an encrypted string (was jsonb).
  shipTo: text("ship_to"),
  recordsMethod: varchar("records_method", { length: 40 }),
  physicalBite: varchar("physical_bite", { length: 40 }),
  formType: varchar("form_type", { length: 40 }).default("digital").notNull(),
  // PHI JSON blob — stored as an encrypted string (was jsonb).
  formData: text("form_data"),
  deviceKey: varchar("device_key", { length: 60 }),
  deviceCategory: varchar("device_category", { length: 30 }),
  // PHI JSON blob — stored as an encrypted string (was jsonb notNull default {}).
  // Now nullable text; code writes an encrypted "{}" when there are no options.
  deviceOptions: text("device_options"),
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
