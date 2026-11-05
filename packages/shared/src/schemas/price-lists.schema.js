import { z } from "zod";
import { id } from "./common.schema.js";

/** Named price lists (piece 10). Prices are integer cents, never negative. */
export const PRICE_LIST_ASSIGN_MODES = ["add", "replace"];
export const PRICE_LIST_BULK_MAX = 500;

const priceCents = z.number().int().min(0).max(10_000_000);
const name = z.string().trim().min(1).max(120);
const description = z.string().trim().max(2000);
const distinct = (ids) => new Set(ids).size === ids.length;

export const priceListCreateSchema = z.object({
  name,
  description: description.nullish(),
});

export const priceListUpdateSchema = z.object({
  name: name.optional(),
  description: description.nullable().optional(),
  archived: z.boolean().optional(),
}).refine((b) => Object.values(b).some((v) => v !== undefined), { message: "Nothing to change." });

export const priceListItemSchema = z.object({ priceCents });

export const priceListItemsBulkSchema = z.object({
  items: z.array(z.object({ variantId: id, priceCents }))
    .min(1).max(PRICE_LIST_BULK_MAX)
    .refine((items) => distinct(items.map((i) => i.variantId)), { message: "Each variant may appear once." }),
});

/** A client's whole assignment, highest precedence first. */
export const clientPriceListsSchema = z.object({
  listIds: z.array(id).max(50).refine(distinct, { message: "Each list may appear once." }),
});

/** Copy prices from one client to others (replace or merge), previewed then applied. */
export const PRICE_COPY_MODES = ["replace", "merge"];
export const PRICE_COPY_MAX_TARGETS = 200;

const copyBody = {
  fromClientUserId: id,
  toClientUserIds: z.array(id).min(1).max(PRICE_COPY_MAX_TARGETS).refine(distinct, { message: "Each client may appear once." }),
  mode: z.enum(PRICE_COPY_MODES),
};
const notSelf = (b) => !b.toClientUserIds.includes(b.fromClientUserId);
const SELF = { message: "A client cannot be copied onto itself." };

export const priceCopyPreviewSchema = z.object(copyBody).refine(notSelf, SELF);

/** The apply body is the preview body plus the hash the preview returned (a stale plan is refused, 409). */
export const priceCopySchema = z.object({ ...copyBody, previewHash: z.string().regex(/^[0-9a-f]{64}$/) }).refine(notSelf, SELF);

export const priceListAssignSchema = z.object({
  listId: id,
  clientUserIds: z.array(id).min(1).max(PRICE_LIST_BULK_MAX),
  mode: z.enum(PRICE_LIST_ASSIGN_MODES),
});
