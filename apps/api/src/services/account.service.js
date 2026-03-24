import { db } from "../config/database.js";
import { accounts, memberships } from "../db/schema/index.js";
import { eq, and } from "drizzle-orm";
import { createId } from "../lib/id.js";
import { ERROR_CODES, slugify } from "@my-app/shared";

function createAppError(errorDef) {
  const err = new Error(errorDef.message);
  err.statusCode = errorDef.status;
  err.code = errorDef.code;
  return err;
}

export async function createAccount({ name, slug, userId }) {
  const accountSlug = slug || slugify(name) || `account-${createId().slice(0, 8)}`;

  // Check slug uniqueness
  const [existing] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.slug, accountSlug))
    .limit(1);

  if (existing) throw createAppError(ERROR_CODES.ACCOUNT_SLUG_TAKEN);

  const accountId = createId();
  await db.insert(accounts).values({
    id: accountId,
    name,
    slug: accountSlug,
    ownerId: userId,
    status: "active",
  });

  // Create owner membership
  await db.insert(memberships).values({
    id: createId(),
    userId,
    accountId,
    role: "owner",
    status: "active",
  });

  return { id: accountId, name, slug: accountSlug };
}

export async function getAccount(accountId) {
  const [account] = await db
    .select()
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);

  if (!account) throw createAppError(ERROR_CODES.ACCOUNT_NOT_FOUND);
  return account;
}

export async function updateAccount(accountId, data) {
  if (data.slug) {
    const [existing] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.slug, data.slug)))
      .limit(1);

    if (existing && existing.id !== accountId) {
      throw createAppError(ERROR_CODES.ACCOUNT_SLUG_TAKEN);
    }
  }

  await db
    .update(accounts)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(accounts.id, accountId));

  return getAccount(accountId);
}

export async function deleteAccount(accountId, userId) {
  const [account] = await db
    .select()
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);

  if (!account) throw createAppError(ERROR_CODES.ACCOUNT_NOT_FOUND);
  if (account.ownerId !== userId) {
    throw createAppError({ ...ERROR_CODES.FORBIDDEN, message: "Only the owner can delete this account." });
  }

  // Soft delete
  await db
    .update(accounts)
    .set({ status: "deleted", updatedAt: new Date() })
    .where(eq(accounts.id, accountId));
}
