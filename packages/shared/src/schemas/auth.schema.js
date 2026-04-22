import { z } from "zod";

export const registerSchema = z.object({
  email: z.string().email("Invalid email address").transform((e) => e.toLowerCase().trim()),
  password: z
    .string()
    .min(12, "Password must be at least 12 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[0-9]/, "Password must contain at least one number"),
  name: z.string().min(1, "Name is required").max(100),
});

export const loginSchema = z.object({
  email: z.string().email("Invalid email address").transform((e) => e.toLowerCase().trim()),
  password: z.string().min(1, "Password is required"),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email("Invalid email address").transform((e) => e.toLowerCase().trim()),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, "Token is required"),
  password: z
    .string()
    .min(12, "Password must be at least 12 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[0-9]/, "Password must contain at least one number"),
});

export const verifyEmailSchema = z.object({
  token: z.string().min(1, "Token is required"),
});

export const magicLinkSchema = z.object({
  email: z.string().email("Invalid email address").transform((e) => e.toLowerCase().trim()),
});

export const magicLinkVerifySchema = z.object({
  token: z.string().min(1, "Token is required"),
});

export const mfaVerifySchema = z.object({
  code: z.string().length(6, "MFA code must be 6 digits"),
  mfaToken: z.string().min(1, "MFA token is required"),
});

export const mfaEnableSchema = z.object({
  code: z.string().length(6, "MFA code must be 6 digits"),
});

export const mfaDisableSchema = z.object({
  password: z.string().min(1, "Password is required"),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z
    .string()
    .min(12, "Password must be at least 12 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[0-9]/, "Password must contain at least one number"),
});

export const doctorRegisterSchema = z.object({
  name: z.string().min(2, "Name is required").max(100),
  email: z.string().email("Invalid email address").transform((e) => e.toLowerCase().trim()),
  password: z
    .string()
    .min(12, "Password must be at least 12 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[0-9]/, "Password must contain at least one number"),
  npiNumber: z.string().min(5, "NPI Number is required").max(20),
  licenseNumber: z.string().max(100).optional(),
  companyName: z.string().min(1, "Company name is required").max(255),
  address1: z.string().min(1, "Address is required").max(255),
  address2: z.string().max(255).optional(),
  city: z.string().min(1, "City is required").max(100),
  state: z.string().min(1, "State is required").max(50),
  zip: z.string().min(3, "ZIP code is required").max(20),
  phone: z.string().max(30).optional(),
  phone2: z.string().max(30).optional(),
  deliveryMethod: z.string().max(100).optional(),
  deliveryNotes: z.string().max(1000).optional(),
});
