import { z } from "zod";

/**
 * Validates the non-file fields of a Digital Rx case submission.
 * Used server-side on the multipart route after JSON fields are pre-parsed
 * (deviceOptions / shipTo arrive as JSON strings and are parsed before
 * this schema is applied; rush is coerced to a boolean by the route).
 */
export const rxCaseSubmitSchema = z.object({
  // Patient
  patientFirst: z.string().min(1, "Patient first name is required").max(120),
  patientLast: z.string().min(1, "Patient last name is required").max(120),
  dob: z.string().max(20).optional(),
  gender: z.string().max(20).optional(),
  contactPhone: z.string().max(30).optional(),

  // Practice — max matches the rx_cases.practice_name varchar(200) column so an
  // overlength value is rejected at validation, not at insert time.
  practiceName: z.string().max(200).optional(),

  // Device
  deviceKey: z.string().min(1, "Device key is required").max(60),
  deviceCategory: z.string().min(1, "Device category is required").max(30),
  // deviceOptions is free-form: values vary per device type and include "Other"
  // catch-all fields, so no hard enum — validate shape downstream per deviceKey.
  deviceOptions: z.record(z.unknown()).default({}),

  // Clinical
  firstDevice: z.string().max(40).optional(),
  recordsMethod: z.string().max(40).optional(),
  physicalBite: z.string().max(40).optional(),

  // Scheduling
  dueDate: z.string().max(30).optional(),
  rush: z.boolean().default(false),
  // Only two tiers exist; constrained here so the route never persists an
  // arbitrary string. Free-form device-choice fields are NOT constrained
  // because they include "Other" options.
  rushTier: z.enum(["nylon", "biomedPmtAcrylic"]).optional(),

  // Shipping / delivery
  shipTo: z.record(z.unknown()).optional(),

  // Extras
  generalComments: z.string().optional(),
  signatureUrl: z.string().optional(),
}).refine(
  (data) => !data.rush || !!data.rushTier,
  { message: "rushTier is required when rush is true", path: ["rushTier"] }
);

/**
 * Validates the non-file fields of a generic faithful-form submission
 * (POST /rx/form-submissions). These intake-only forms (digital / ortho)
 * carry all of their answers in a free-form `formData` object rather
 * than the device-wizard's structured columns. No Seazona mapping is involved.
 *
 * The route assembles this object from multipart text fields after parsing
 * `formData` (a JSON string) into an object.
 */
export const rxFormSubmitSchema = z.object({
  formType: z.enum(["digital", "ortho"]),
  patientFirst: z.string().min(1).max(120),
  patientLast: z.string().min(1).max(120),
  formData: z.record(z.unknown()).default({}),
  dueDate: z.string().max(30).optional(),
  signatureUrl: z.string().optional(),
});
