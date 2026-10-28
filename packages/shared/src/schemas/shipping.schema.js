import { z } from "zod";
import { id, isoDate, pageQueryShape, searchText } from "./common.schema.js";
import { CARRIERS, SHIPMENT_STATUSES, PARCEL_PRESET_KEYS } from "../shipping/shipping.js";

/**
 * Shipping request bodies. Address limits are the carriers' own (UPS and
 * FedEx both cap a street line and a name at 35 characters, UPS a city at 30),
 * so a bad address is refused here with a message staff can act on, before
 * any carrier is called.
 */
export const MAX_ORDERS_PER_SHIPMENT = 20;

const required = (max, message) => z.string().trim().min(1, message).max(max, `Keep it to ${max} characters.`);
/** "" or whitespace → null; otherwise trimmed and capped. */
const optional = (max) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().trim().max(max, `Keep it to ${max} characters.`).nullable().optional(),
  );

export const shippingAddressSchema = z.object({
  name: required(35, "A name is required."),
  company: optional(35),
  phone: optional(20).refine((v) => v == null || /^[0-9()+\-.\s]{7,20}$/.test(v), "Use a phone number."),
  address1: required(35, "A street address is required."),
  address2: optional(35),
  city: required(30, "A city is required."),
  state: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "Use the two-letter state code."),
  postalCode: z.string().trim().regex(/^\d{5}(-\d{4})?$/, "Use a 5-digit ZIP (or ZIP+4)."),
  country: z.literal("US").default("US"),
  residential: z.boolean().optional(),
});

const inches = z.number().positive("Must be more than 0.").max(108, "UPS and FedEx take at most 108 in.");

export const parcelSchema = z.object({
  preset: z.enum(PARCEL_PRESET_KEYS).optional(),
  weightOz: z.number().int("Use whole ounces.").min(1, "Weigh the box.").max(2400, "150 lb is the carriers' limit."),
  lengthIn: inches,
  widthIn: inches,
  heightIn: inches,
});

export const shipmentRatesSchema = z.object({ shipTo: shippingAddressSchema, parcel: parcelSchema });

export const shipmentBuySchema = z
  .object({
    orderIds: z.array(id).min(1, "Pick at least one order.").max(MAX_ORDERS_PER_SHIPMENT, `At most ${MAX_ORDERS_PER_SHIPMENT} orders per box.`),
    shipTo: shippingAddressSchema,
    parcel: parcelSchema,
    carrier: z.enum(CARRIERS),
    serviceCode: z.string().trim().min(1).max(40).optional(),
    manual: z
      .object({
        carrierName: required(40, "Type the carrier's name."),
        trackingNumber: optional(40).transform((v) => v ?? null),
      })
      .optional(),
  })
  .superRefine((b, ctx) => {
    if (new Set(b.orderIds).size !== b.orderIds.length) ctx.addIssue({ code: "custom", path: ["orderIds"], message: "An order appears twice." });
    if (b.carrier === "manual" && !b.manual) ctx.addIssue({ code: "custom", path: ["manual"], message: "Type the carrier's name." });
    if (b.carrier !== "manual" && !b.serviceCode) ctx.addIssue({ code: "custom", path: ["serviceCode"], message: "Pick a service." });
  });

export const shipmentListQuerySchema = z.object({
  status: z.enum(SHIPMENT_STATUSES).optional(),
  carrier: z.enum(CARRIERS).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  q: searchText.optional(),
  ...pageQueryShape,
});
