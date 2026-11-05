import { inArray } from "drizzle-orm";
import { db } from "../config/database.js";
import { accounts, users } from "../db/schema/index.js";
import { createOrganizationsService } from "../modules/organizations/index.js";
import { logSafe } from "./audit.service.js";

/** The app's organizations service: the generic module with this app's audit writer injected. */
export const organizationsService = createOrganizationsService({ audit: logSafe });

/** Labels for the organization detail view; an id with no account row is simply absent. */
export async function describeAccounts(ids) {
  if (!ids?.length) return [];
  const rows = await db.select({ id: accounts.id, name: accounts.name }).from(accounts).where(inArray(accounts.id, ids));
  return rows.map((r) => ({ id: r.id, label: r.name }));
}

export async function userExists(userId) {
  const rows = await db.select({ id: users.id }).from(users).where(inArray(users.id, [userId]));
  return rows.length > 0;
}
