import { barcodeLookupRoutes } from "../modules/barcode-lookup/index.js";
import { labLookups } from "../services/lab/lab-lookups.js";
import { STAFF } from "./lab.routes.js";

/**
 * The lab's production-desk glue: where the generic modules (scan lookup,
 * tags, files, ...) meet lab records. Lab staff and admins only (same guard
 * as every lab route). Later desk routes are added here.
 */
export default async function labDeskRoutes(fastify) {
  await fastify.register(barcodeLookupRoutes, { registry: labLookups, path: "/lab/lookup", guard: STAFF });
}
