import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../config/database.js";
import {
  productVariants, productFamilies, clientPrices, priceLists, priceListItems, clientPriceLists,
} from "../db/schema/index.js";
import { liveLists, priceLines, priceLabLines, resolveClientPrices } from "../lib/pricing.js";
import { PRICING } from "../config/pricing.js";

/** Whose negotiated prices apply to a request — null means guest pricing. */
export function pricingClientFor(user) {
  if (!user || user.role !== "doctor" || user.approvalStatus !== "approved") return null;
  return user.id;
}

/** Variants by id, with `active` folding in the family's active flag and shop channel. */
export async function loadShopVariants(variantIds) {
  if (variantIds.length === 0) return new Map();
  const rows = await db
    .select({ v: productVariants, f: productFamilies })
    .from(productVariants)
    .innerJoin(productFamilies, eq(productFamilies.id, productVariants.familyId))
    .where(inArray(productVariants.id, variantIds));
  return new Map(rows.map(({ v, f }) => [v.id, { ...v, active: v.active && f.active && f.channel !== "rx" }]));
}

/** Variants by id in any channel and any active state: lab work is priced whatever its catalog status is now. */
export async function loadVariantsById(variantIds, database = db) {
  if (variantIds.length === 0) return new Map();
  const rows = await database.select().from(productVariants).where(inArray(productVariants.id, variantIds));
  return new Map(rows.map((v) => [v.id, v]));
}

/**
 * Every non-base price a client gets, resolved through the one rule
 * (lib/pricing.js resolveClientPrices): the client's overrides, then their
 * assigned, non-archived lists in position order. `variantIds` null = every
 * variant (pricing page, same-pricing). Three selects; two when no list is assigned.
 * -> Map<variantId, { cents, source: "client"|"list", listId, listName }>
 */
export async function loadEffectiveClientPrices(clientUserId, variantIds, database = db) {
  return (await loadClientPriceResolution(clientUserId, variantIds, database)).effective;
}

/**
 * The same resolution plus `listOnly`: what the client's non-archived lists alone would charge
 * (empty overrides), from the lists already loaded. The pricing page uses it to flag an override
 * that equals its list price. -> { effective, listOnly } (both Map<variantId, { cents, source, listId, listName }>)
 */
export async function loadClientPriceResolution(clientUserId, variantIds, database = db) {
  if (!clientUserId || (variantIds && variantIds.length === 0)) return { effective: new Map(), listOnly: new Map() };
  const forVariants = (col) => (variantIds ? inArray(col, variantIds) : undefined);

  const overrideRows = await database
    .select({ variantId: clientPrices.variantId, priceCents: clientPrices.priceCents })
    .from(clientPrices)
    .where(and(eq(clientPrices.clientUserId, clientUserId), forVariants(clientPrices.variantId)));

  const assigned = await database
    .select({ listId: priceLists.id, name: priceLists.name, position: clientPriceLists.position })
    .from(clientPriceLists)
    .innerJoin(priceLists, eq(priceLists.id, clientPriceLists.priceListId))
    .where(and(eq(clientPriceLists.clientUserId, clientUserId), isNull(priceLists.archivedAt)))
    .orderBy(asc(clientPriceLists.position), asc(clientPriceLists.id));

  const itemRows = assigned.length === 0 ? [] : await database
    .select({ listId: priceListItems.priceListId, variantId: priceListItems.variantId, priceCents: priceListItems.priceCents })
    .from(priceListItems)
    .where(and(inArray(priceListItems.priceListId, assigned.map((a) => a.listId)), forVariants(priceListItems.variantId)));

  const itemsByList = new Map(assigned.map((a) => [a.listId, new Map()]));
  for (const r of itemRows) itemsByList.get(r.listId)?.set(r.variantId, r.priceCents);
  const lists = assigned.map((a) => ({ listId: a.listId, name: a.name, items: itemsByList.get(a.listId) }));
  return {
    effective: resolveClientPrices({ overrides: new Map(overrideRows.map((r) => [r.variantId, r.priceCents])), lists }),
    listOnly: resolveClientPrices({ lists }),
  };
}

/**
 * Many clients at once: every override and ordered list assignment, with live-list items,
 * in three selects (two when no live list is assigned). Batched twin of loadClientPriceResolution
 * for copy and same-pricing. Each state's `liveLists` is ready for resolveClientPrices (archived
 * lists dropped by lib/pricing.js liveLists); `listIds` keeps every assignment, archived included.
 * -> { states: Map<clientId, { overrides, listIds, liveLists }>, lists: Map<listId, { listId, name, archived, items }> }
 */
export async function loadClientPriceStates(tx, ids) {
  const overrideRows = await tx
    .select({ clientUserId: clientPrices.clientUserId, variantId: clientPrices.variantId, priceCents: clientPrices.priceCents })
    .from(clientPrices).where(inArray(clientPrices.clientUserId, ids));
  const assigned = await tx
    .select({ clientUserId: clientPriceLists.clientUserId, listId: priceLists.id, name: priceLists.name, archivedAt: priceLists.archivedAt, position: clientPriceLists.position })
    .from(clientPriceLists)
    .innerJoin(priceLists, eq(priceLists.id, clientPriceLists.priceListId))
    .where(inArray(clientPriceLists.clientUserId, ids))
    .orderBy(asc(clientPriceLists.position), asc(clientPriceLists.id));
  const liveIds = [...new Set(assigned.filter((a) => !a.archivedAt).map((a) => a.listId))];
  const itemRows = liveIds.length === 0 ? [] : await tx
    .select({ listId: priceListItems.priceListId, variantId: priceListItems.variantId, priceCents: priceListItems.priceCents })
    .from(priceListItems).where(inArray(priceListItems.priceListId, liveIds));

  const lists = new Map();
  for (const a of assigned) if (!lists.has(a.listId)) lists.set(a.listId, { listId: a.listId, name: a.name, archived: Boolean(a.archivedAt), items: new Map() });
  for (const r of itemRows) lists.get(r.listId)?.items.set(r.variantId, r.priceCents);

  const states = new Map(ids.map((id) => [id, { overrides: new Map(), listIds: [], liveLists: [] }]));
  for (const r of overrideRows) states.get(r.clientUserId)?.overrides.set(r.variantId, r.priceCents);
  for (const a of assigned) states.get(a.clientUserId).listIds.push(a.listId);
  for (const s of states.values()) s.liveLists = liveLists(s.listIds, lists);
  return { states, lists };
}

/** The pricing callers' view (shop, catalog, lab invoices): Map<variantId, { cents, source }> for unitPriceFor. */
export async function loadClientPrices(clientUserId, variantIds, database = db) {
  const effective = await loadEffectiveClientPrices(clientUserId, variantIds, database);
  return new Map([...effective].map(([variantId, { cents, source }]) => [variantId, { cents, source }]));
}

/** A lab order's lines priced for its client (inside the caller's transaction when one is passed). */
export async function priceLabOrderLines(lines, clientUserId, database = db) {
  const ids = [...new Set(lines.filter((l) => !l.noteOnly && l.variantId).map((l) => l.variantId))];
  const variants = await loadVariantsById(ids, database);
  const prices = await loadClientPrices(clientUserId, ids, database);
  return priceLabLines({ lines, variants, clientPrices: prices });
}

export async function priceShopCart({ lines, clientUserId = null }) {
  const ids = [...new Set(lines.map((l) => l.variantId))];
  const [variants, prices] = await Promise.all([loadShopVariants(ids), loadClientPrices(clientUserId, ids)]);
  return priceLines({ lines, variants, clientPrices: prices, config: PRICING });
}
