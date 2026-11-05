import { and, asc, count, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { PRICE_LIST_BULK_MAX } from "@my-app/shared";
import { db } from "../config/database.js";
import {
  priceLists, priceListItems, clientPriceLists, productVariants, productFamilies, users, memberships, accounts,
} from "../db/schema/index.js";
import { createId } from "../lib/id.js";
import * as auditService from "./audit.service.js";

// Named price lists (piece 10): CRUD, items, a client's ordered assignment and
// the Users-table bulk assign. Prices resolve through pricing.service.js
// loadEffectiveClientPrices, never here. Every write is audited with ids,
// counts and cents only.

export class PriceListError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const STATUS = { NOT_FOUND: 404, NAME_TAKEN: 409, INVALID: 422 };

/** PriceListError → HTTP reply ({ status, body }); anything else is not ours (null). */
export function priceListErrorReply(err) {
  if (!(err instanceof PriceListError)) return null;
  const status = STATUS[err.code] ?? 422;
  return { status, body: { error: { code: err.code, status, message: err.message } } };
}

const UNIQUE_VIOLATION = "23505";
const nameTaken = () => new PriceListError("NAME_TAKEN", "A price list with that name already exists.");
const NOT_A_CLIENT = "Not a client";

async function requireList(tx, listId) {
  const [list] = await tx.select({ id: priceLists.id, name: priceLists.name, archivedAt: priceLists.archivedAt })
    .from(priceLists).where(eq(priceLists.id, listId));
  if (!list) throw new PriceListError("NOT_FOUND", "Price list not found.");
  return list;
}

async function assertNameFree(tx, name, exceptId = null) {
  const [clash] = await tx.select({ id: priceLists.id }).from(priceLists)
    .where(and(sql`lower(${priceLists.name}) = lower(${name})`, exceptId ? ne(priceLists.id, exceptId) : undefined));
  if (clash) throw nameTaken();
}

/** Inserts/updates race the pre-check; the unique index on lower(name) is the final word. */
async function withNameGuard(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err?.code === UNIQUE_VIOLATION) throw nameTaken();
    throw err;
  }
}

const audit = (tx, byUserId, action, targetType, targetId, metadata) =>
  auditService.log({ userId: byUserId, action, targetType, targetId, metadata }, tx);

export async function listPriceLists({ includeArchived = false } = {}, database = db) {
  const q = database.select().from(priceLists);
  const lists = await (includeArchived ? q : q.where(isNull(priceLists.archivedAt))).orderBy(asc(sql`lower(${priceLists.name})`));
  const itemCounts = await database.select({ listId: priceListItems.priceListId, n: count() })
    .from(priceListItems).groupBy(priceListItems.priceListId);
  const clientCounts = await database.select({ listId: clientPriceLists.priceListId, n: count() })
    .from(clientPriceLists).groupBy(clientPriceLists.priceListId);
  const items = new Map(itemCounts.map((r) => [r.listId, Number(r.n)]));
  const clients = new Map(clientCounts.map((r) => [r.listId, Number(r.n)]));
  return lists.map((l) => ({
    id: l.id, name: l.name, description: l.description, archivedAt: l.archivedAt, updatedAt: l.updatedAt,
    itemCount: items.get(l.id) ?? 0, clientCount: clients.get(l.id) ?? 0,
  }));
}

export function createPriceList({ name, description = null, byUserId }, database = db) {
  return withNameGuard(() => database.transaction(async (tx) => {
    await assertNameFree(tx, name);
    const row = { id: createId(), name, description: description ?? null, createdBy: byUserId ?? null };
    await tx.insert(priceLists).values(row);
    await audit(tx, byUserId, "price_list.created", "price_list", row.id, { listId: row.id });
    return row;
  }));
}

/** patch: { name?, description?, archived? }. Archiving stops the list applying; it stays assigned. */
export function updatePriceList(id, patch, byUserId, database = db) {
  return withNameGuard(() => database.transaction(async (tx) => {
    const list = await requireList(tx, id);
    const set = { updatedAt: new Date() };
    if (patch.name !== undefined && patch.name !== list.name) {
      await assertNameFree(tx, patch.name, id);
      set.name = patch.name;
    }
    if (patch.description !== undefined) set.description = patch.description ?? null;
    if (patch.archived !== undefined) set.archivedAt = patch.archived ? (list.archivedAt ?? new Date()) : null;
    const [row] = await tx.update(priceLists).set(set).where(eq(priceLists.id, id)).returning();
    const fields = Object.keys(patch).filter((k) => patch[k] !== undefined);
    const metadata = { fields, ...(patch.archived !== undefined ? { archived: patch.archived } : {}) };
    await audit(tx, byUserId, "price_list.updated", "price_list", id, metadata);
    return row;
  }));
}

/** Every variant with the list's price, or null where the list has none (the editor's rows). */
export async function listItems(listId, database = db) {
  await requireList(database, listId);
  const rows = await database
    .select({
      variantId: productVariants.id, code: productVariants.code, name: productVariants.name,
      active: productVariants.active, basePriceCents: productVariants.basePriceCents,
      familyName: productFamilies.name, listPriceCents: priceListItems.priceCents,
    })
    .from(productVariants)
    .innerJoin(productFamilies, eq(productFamilies.id, productVariants.familyId))
    .leftJoin(priceListItems, and(eq(priceListItems.variantId, productVariants.id), eq(priceListItems.priceListId, listId)))
    .orderBy(asc(productFamilies.name), asc(productVariants.name));
  return rows.map((r) => ({ ...r, listPriceCents: r.listPriceCents ?? null }));
}

function assertItems(items) {
  if (!Array.isArray(items) || items.length === 0 || items.length > PRICE_LIST_BULK_MAX) {
    throw new PriceListError("INVALID", `Send between 1 and ${PRICE_LIST_BULK_MAX} prices.`);
  }
  if (items.some((i) => !Number.isInteger(i.priceCents) || i.priceCents < 0)) {
    throw new PriceListError("INVALID", "Prices are whole cents and never negative.");
  }
  if (new Set(items.map((i) => i.variantId)).size !== items.length) {
    throw new PriceListError("INVALID", "Each variant may appear once.");
  }
}

/** Upsert up to 500 prices in one transaction (paste, or fill-from-base). */
export async function setItems(listId, items, byUserId, database = db) {
  assertItems(items);
  return database.transaction(async (tx) => {
    await requireList(tx, listId);
    const ids = items.map((i) => i.variantId);
    const found = await tx.select({ id: productVariants.id }).from(productVariants).where(inArray(productVariants.id, ids));
    const known = new Set(found.map((v) => v.id));
    const unknown = ids.filter((v) => !known.has(v));
    if (unknown.length) throw new PriceListError("INVALID", `${unknown.length} variant(s) not found.`);
    const now = new Date();
    await tx.insert(priceListItems).values(items.map((i) => ({
      id: createId(), priceListId: listId, variantId: i.variantId, priceCents: i.priceCents, updatedAt: now, updatedBy: byUserId ?? null,
    }))).onConflictDoUpdate({
      target: [priceListItems.priceListId, priceListItems.variantId],
      set: { priceCents: sql`excluded.price_cents`, updatedAt: now, updatedBy: byUserId ?? null },
    });
    await tx.update(priceLists).set({ updatedAt: now }).where(eq(priceLists.id, listId));
    await audit(tx, byUserId, "price_list.items_set", "price_list", listId, { listId, count: items.length });
    return { count: items.length };
  });
}

export async function setItem(listId, variantId, priceCents, byUserId, database = db) {
  assertItems([{ variantId, priceCents }]);
  return database.transaction(async (tx) => {
    await requireList(tx, listId);
    const [v] = await tx.select({ id: productVariants.id }).from(productVariants).where(eq(productVariants.id, variantId));
    if (!v) throw new PriceListError("NOT_FOUND", "Variant not found.");
    const now = new Date();
    await tx.insert(priceListItems).values({
      id: createId(), priceListId: listId, variantId, priceCents, updatedAt: now, updatedBy: byUserId ?? null,
    }).onConflictDoUpdate({
      target: [priceListItems.priceListId, priceListItems.variantId],
      set: { priceCents, updatedAt: now, updatedBy: byUserId ?? null },
    });
    await tx.update(priceLists).set({ updatedAt: now }).where(eq(priceLists.id, listId));
    await audit(tx, byUserId, "price_list.item_set", "price_list", listId, { listId, variantId, priceCents });
  });
}

export async function removeItem(listId, variantId, byUserId, database = db) {
  return database.transaction(async (tx) => {
    const removed = await tx.delete(priceListItems)
      .where(and(eq(priceListItems.priceListId, listId), eq(priceListItems.variantId, variantId)))
      .returning({ id: priceListItems.id });
    if (removed.length === 0) throw new PriceListError("NOT_FOUND", "No price to remove.");
    await tx.update(priceLists).set({ updatedAt: new Date() }).where(eq(priceLists.id, listId));
    await audit(tx, byUserId, "price_list.item_removed", "price_list", listId, { listId, variantId });
  });
}

/** A client's assigned lists, highest precedence first. Archived ones are included (shown struck through; they do not apply). */
export function clientLists(clientUserId, database = db) {
  return database
    .select({
      listId: priceLists.id, name: priceLists.name, archivedAt: priceLists.archivedAt,
      position: clientPriceLists.position, assignedAt: clientPriceLists.assignedAt,
    })
    .from(clientPriceLists)
    .innerJoin(priceLists, eq(priceLists.id, clientPriceLists.priceListId))
    .where(eq(clientPriceLists.clientUserId, clientUserId))
    .orderBy(asc(clientPriceLists.position), asc(clientPriceLists.id));
}

/**
 * The clients assigned to a list, in assignment order. `practice` is the client's first active
 * account; ids, names and account numbers only (no PHI).
 */
export async function listClients(listId, database = db) {
  await requireList(database, listId);
  const rows = await database
    .select({
      id: users.id, name: users.name, email: users.email, accountNumber: users.seazonaAccountNumber,
      position: clientPriceLists.position, assignedAt: clientPriceLists.assignedAt,
    })
    .from(clientPriceLists)
    .innerJoin(users, eq(users.id, clientPriceLists.clientUserId))
    .where(eq(clientPriceLists.priceListId, listId))
    .orderBy(asc(sql`lower(coalesce(${users.name}, ${users.email}))`));
  if (rows.length === 0) return [];
  const accountRows = await database
    .select({ userId: memberships.userId, practice: accounts.name })
    .from(memberships)
    .innerJoin(accounts, eq(accounts.id, memberships.accountId))
    .where(and(inArray(memberships.userId, rows.map((r) => r.id)), eq(memberships.status, "active")));
  const practice = new Map();
  for (const a of accountRows) if (!practice.has(a.userId)) practice.set(a.userId, a.practice);
  return rows.map((r) => ({ ...r, name: r.name || r.email, practice: practice.get(r.id) ?? null }));
}

async function requireClient(tx, clientUserId) {
  const [u] = await tx.select({ id: users.id, role: users.role }).from(users).where(eq(users.id, clientUserId));
  if (!u || u.role !== "doctor") throw new PriceListError("INVALID", NOT_A_CLIENT);
}

/**
 * Replace a client's whole assignment; positions follow array order (0 first).
 * An archived list may stay where it already is but cannot be newly added.
 */
export async function setClientLists(clientUserId, listIds, byUserId, database = db) {
  if (new Set(listIds).size !== listIds.length) throw new PriceListError("INVALID", "Each list may appear once.");
  return database.transaction(async (tx) => {
    await requireClient(tx, clientUserId);
    const lists = listIds.length === 0 ? [] : await tx.select({ id: priceLists.id, archivedAt: priceLists.archivedAt })
      .from(priceLists).where(inArray(priceLists.id, listIds));
    if (lists.length !== listIds.length) throw new PriceListError("NOT_FOUND", "Price list not found.");
    const current = await tx.select({ priceListId: clientPriceLists.priceListId })
      .from(clientPriceLists).where(eq(clientPriceLists.clientUserId, clientUserId));
    const had = new Set(current.map((c) => c.priceListId));
    if (lists.some((l) => l.archivedAt && !had.has(l.id))) {
      throw new PriceListError("INVALID", "An archived list cannot be assigned.");
    }
    await tx.delete(clientPriceLists).where(eq(clientPriceLists.clientUserId, clientUserId));
    if (listIds.length) {
      const now = new Date();
      await tx.insert(clientPriceLists).values(listIds.map((priceListId, position) => ({
        id: createId(), clientUserId, priceListId, position, assignedAt: now, assignedBy: byUserId ?? null,
      })));
    }
    await audit(tx, byUserId, "price_list.assigned", "user", clientUserId, { clientUserId, listIds });
  });
}

/**
 * Pure: the assignment rows a bulk assign inserts. `add` appends the list at
 * the lowest precedence and skips clients already on it; `replace` leaves only
 * that list (the caller deletes the targets' rows first).
 */
export function planListAssignment({ listId, clientUserIds, existing, mode }) {
  if (mode === "replace") return clientUserIds.map((clientUserId) => ({ clientUserId, position: 0 }));
  const byClient = new Map(clientUserIds.map((id) => [id, []]));
  for (const row of existing) byClient.get(row.clientUserId)?.push(row);
  const out = [];
  for (const [clientUserId, rows] of byClient) {
    if (rows.some((r) => r.priceListId === listId)) continue;
    out.push({ clientUserId, position: rows.reduce((max, r) => Math.max(max, r.position + 1), 0) });
  }
  return out;
}

/** The Users-table bulk action. Non-clients are reported in `failed`; everyone else applies. */
export async function assignListToClients({ listId, clientUserIds, mode, byUserId }, database = db) {
  const ids = [...new Set(clientUserIds)];
  return database.transaction(async (tx) => {
    const list = await requireList(tx, listId);
    if (list.archivedAt) throw new PriceListError("INVALID", "An archived list cannot be assigned.");
    const found = await tx.select({ id: users.id, role: users.role }).from(users).where(inArray(users.id, ids));
    const clients = new Set(found.filter((u) => u.role === "doctor").map((u) => u.id));
    const targets = ids.filter((id) => clients.has(id));
    const failed = ids.filter((id) => !clients.has(id)).map((id) => ({ id, message: NOT_A_CLIENT }));
    let rows = [];
    if (targets.length) {
      const existing = await tx.select({
        clientUserId: clientPriceLists.clientUserId, priceListId: clientPriceLists.priceListId, position: clientPriceLists.position,
      }).from(clientPriceLists).where(inArray(clientPriceLists.clientUserId, targets));
      rows = planListAssignment({ listId, clientUserIds: targets, existing, mode });
      if (mode === "replace") await tx.delete(clientPriceLists).where(inArray(clientPriceLists.clientUserId, targets));
      if (rows.length) {
        const now = new Date();
        await tx.insert(clientPriceLists).values(rows.map((r) => ({
          id: createId(), clientUserId: r.clientUserId, priceListId: listId, position: r.position, assignedAt: now, assignedBy: byUserId ?? null,
        })));
      }
    }
    await audit(tx, byUserId, "price_list.assigned", "price_list", listId, {
      listId, mode, clientUserIds: targets, added: rows.length, failed: failed.length,
    });
    return { ok: targets.length, failed };
  });
}
