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

  // Device
  deviceKey: z.string().min(1, "Device key is required").max(60),
  deviceCategory: z.string().min(1, "Device category is required").max(30),
  deviceOptions: z.record(z.unknown()).default({}),

  // Clinical
  firstDevice: z.string().max(40).optional(),
  recordsMethod: z.string().max(40).optional(),
  physicalBite: z.string().max(40).optional(),

  // Scheduling
  dueDate: z.string().max(30).optional(),
  rush: z.boolean().default(false),
  rushTier: z.string().max(40).optional(),

  // Shipping / delivery
  shipTo: z.record(z.unknown()).optional(),

  // Extras
  generalComments: z.string().optional(),
  signatureUrl: z.string().optional(),
});
