import { pgTable, varchar, timestamp, text, index } from "drizzle-orm/pg-core";
import { users } from "./users.js";

export const doctorProfiles = pgTable("doctor_profiles", {
  id: varchar("id", { length: 128 }).primaryKey(),
  userId: varchar("user_id", { length: 128 }).notNull().unique().references(() => users.id),
  npiNumber: varchar("npi_number", { length: 20 }).notNull(),
  licenseNumber: varchar("license_number", { length: 100 }),
  companyName: varchar("company_name", { length: 255 }).notNull(),
  address1: varchar("address1", { length: 255 }).notNull(),
  address2: varchar("address2", { length: 255 }),
  city: varchar("city", { length: 100 }).notNull(),
  state: varchar("state", { length: 50 }).notNull(),
  zip: varchar("zip", { length: 20 }).notNull(),
  phone: varchar("phone", { length: 30 }),
  phone2: varchar("phone2", { length: 30 }),
  deliveryMethod: varchar("delivery_method", { length: 100 }),
  deliveryNotes: text("delivery_notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("doctor_profiles_user_id_idx").on(table.userId),
]);
