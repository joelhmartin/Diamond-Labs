import { z } from "zod";

export const ORGANIZATION_NAME_MAX = 120;
export const ORGANIZATION_ACCOUNTS_MAX_IDS = 500;
export const ORGANIZATION_STATUSES = ["active", "archived"];

/** Unknown keys are refused (422), so a typo never silently stores nothing. */
export const organizationSettingsSchema = z.object({ combinedStatement: z.boolean().default(false) }).strict();

const name = z.string().trim().min(1, "Name is required.").max(ORGANIZATION_NAME_MAX);

export const createOrganizationSchema = z.object({
  name,
  settings: organizationSettingsSchema.optional(),
});

export const updateOrganizationSchema = z
  .object({
    name: name.optional(),
    settings: organizationSettingsSchema.partial().strict().optional(),
    status: z.enum(ORGANIZATION_STATUSES).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to change.");

export const organizationAccountsSchema = z.object({
  accountIds: z.array(z.string().min(1).max(128)).min(1).max(ORGANIZATION_ACCOUNTS_MAX_IDS),
});

export const listOrganizationsQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.enum(ORGANIZATION_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

export const organizationAdminSchema = z.object({ userId: z.string().min(1).max(128) });
