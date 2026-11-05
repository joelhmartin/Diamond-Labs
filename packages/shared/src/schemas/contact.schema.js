import { z } from "zod";

export const CONTACT_SUBJECTS = [
  "New Case Inquiry",
  "Product Information",
  "Digital Workflow Setup",
  "Existing Case Question",
  "General Question",
];

const optionalText = (max) => z.string().trim().max(max).optional();

export const contactMessageSchema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(200),
  email: z.string().trim().email("Enter a valid email address").max(320),
  message: z.string().trim().min(1, "Enter a message").max(5000),
  practice: optionalText(200),
  phone: optionalText(50),
  subject: z.enum(CONTACT_SUBJECTS).optional(),
});
