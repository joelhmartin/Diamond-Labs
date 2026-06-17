import { authenticate } from "../middleware/authenticate.js";
import { requireAdmin } from "../middleware/require-role.js";
import { db } from "../config/database.js";
import { rxCodeOverrides } from "../db/schema/index.js";
import { createId } from "../lib/id.js";
import { eq } from "drizzle-orm";
import { ERROR_CODES } from "@my-app/shared";
import * as seazonaService from "../services/seazona.service.js";
import { DEVICE_MAP, DEVICE_LABELS, resolveLineItems } from "../services/rx/device-seazona-map.js";
import { compileNotes } from "../services/rx/build-order-payload.js";

// ─── In-process catalog cache (5-minute TTL) ──────────────────────────────────
let _catalog = null;
let _catAt = 0;

/**
 * Returns { list, byCode: Map(code→{id,name,price}) }.
 * Refreshes from Seazona if the cached copy is older than 5 minutes.
 * On empty/failed Seazona response, degrades gracefully (returns empty
 * structures without throwing and without caching the failure so the
 * next call can retry).
 */
async function getCatalog() {
  if (_catalog && Date.now() - _catAt < 5 * 60 * 1000) return _catalog;

  const list = await seazonaService.listProducts();
  if (!list || list.length === 0) {
    // Degrade — don't cache so the next request retries
    return { list: [], byCode: new Map() };
  }

  const byCode = new Map();
  for (const p of list) {
    if (p.code != null) byCode.set(String(p.code), { id: String(p.id), name: p.name, price: p.price });
  }

  _catalog = { list, byCode };
  _catAt = Date.now();
  return _catalog;
}

/**
 * Load all DB overrides and index by mapKey.
 * Returns { [mapKey]: { code: seazonaCode, name: seazonaName, seazonaProductId } }
 */
async function loadOverrides() {
  const rows = await db.select().from(rxCodeOverrides);
  const map = {};
  for (const row of rows) {
    map[row.mapKey] = {
      code: row.seazonaCode,
      name: row.seazonaName,
      seazonaProductId: row.seazonaProductId,
    };
  }
  return map;
}

export default async function adminRxMappingRoutes(fastify) {
  // ───────────────────────────────────────────────────────────────────────────
  // GET /admin/rx-mapping/devices
  // Returns every device key with its label and primary-slot coverage counts.
  // ───────────────────────────────────────────────────────────────────────────
  fastify.get("/admin/rx-mapping/devices", {
    preHandler: [authenticate, requireAdmin],
  }, async () => {
    const [overrides, { byCode }] = await Promise.all([
      loadOverrides(),
      getCatalog(),
    ]);

    const result = Object.entries(DEVICE_MAP).map(([deviceKey, dev]) => {
      const primaryEntries = Object.entries(dev.primary);
      const total = primaryEntries.length;
      const mapped = primaryEntries.filter(([mat, item]) => {
        const mapKey = `primary:${deviceKey}:${mat}`;
        return !!(overrides[mapKey] || byCode.has(String(item.code)));
      }).length;

      return {
        deviceKey,
        name: DEVICE_LABELS[deviceKey] || deviceKey,
        coverage: { mapped, total },
      };
    });

    return { data: result };
  });

  // ───────────────────────────────────────────────────────────────────────────
  // POST /admin/rx-mapping/preview
  // Resolve a wizard selection to line items and show their mapping status.
  // READ-ONLY — no DB writes, no Seazona writes.
  // Body: { deviceKey, deviceOptions }
  // ───────────────────────────────────────────────────────────────────────────
  fastify.post("/admin/rx-mapping/preview", {
    preHandler: [authenticate, requireAdmin],
  }, async (request, reply) => {
    const { deviceKey, deviceOptions = {} } = request.body || {};

    if (!deviceKey) {
      return reply.code(422).send({
        error: { ...ERROR_CODES.VALIDATION_ERROR, message: "deviceKey is required." },
      });
    }

    const [overrides, { byCode }] = await Promise.all([
      loadOverrides(),
      getCatalog(),
    ]);

    const { items, unmapped } = resolveLineItems({ deviceKey, deviceOptions }, { overrides });

    const lines = [
      ...items.map((item) => ({
        mapKey: item.mapKey,
        code: item.code,
        name: item.name,
        arch: item.arch,
        source: item.source,
        // True when this line's code came from a saved DB override — drives the
        // admin UI "Clear override" affordance.
        overridden: Boolean(item.overridden),
        seazonaProductId:
          byCode.get(String(item.code))?.id ||
          overrides[item.mapKey]?.seazonaProductId ||
          null,
        status:
          overrides[item.mapKey] || byCode.has(String(item.code))
            ? "confirmed"
            : "placeholder",
      })),
      ...unmapped.map((mapKey) => ({
        mapKey,
        code: null,
        name: null,
        status: "unmapped",
      })),
    ];

    const notes = compileNotes({ deviceKey, deviceOptions });

    const confirmed = lines.filter((l) => l.status === "confirmed").length;
    const placeholder = lines.filter((l) => l.status === "placeholder").length;
    const unmappedCount = lines.filter((l) => l.status === "unmapped").length;
    const total = lines.length;

    return {
      data: {
        lines,
        notes,
        coverage: { confirmed, placeholder, unmapped: unmappedCount, total },
      },
    };
  });

  // ───────────────────────────────────────────────────────────────────────────
  // GET /admin/rx-mapping/catalog?q=
  // Search the live Seazona product catalog (cached 5 min). Returns up to 50.
  // ───────────────────────────────────────────────────────────────────────────
  fastify.get("/admin/rx-mapping/catalog", {
    preHandler: [authenticate, requireAdmin],
  }, async (request) => {
    const { list } = await getCatalog();
    const q = request.query.q?.trim();

    let filtered;
    if (q) {
      const lower = q.toLowerCase();
      filtered = list.filter(
        (p) =>
          String(p.name || "").toLowerCase().includes(lower) ||
          String(p.code || "").toLowerCase().includes(lower)
      );
    } else {
      filtered = list;
    }

    return {
      data: filtered.slice(0, 50).map((p) => ({
        code: p.code,
        name: p.name,
        price: p.price,
      })),
    };
  });

  // ───────────────────────────────────────────────────────────────────────────
  // GET /admin/rx-mapping/overrides
  // All rows from rx_code_overrides.
  // ───────────────────────────────────────────────────────────────────────────
  fastify.get("/admin/rx-mapping/overrides", {
    preHandler: [authenticate, requireAdmin],
  }, async () => {
    const rows = await db.select().from(rxCodeOverrides);
    return { data: rows };
  });

  // ───────────────────────────────────────────────────────────────────────────
  // PUT /admin/rx-mapping/override
  // Upsert a mapping override (keyed by mapKey, unique constraint).
  // Body: { mapKey, seazonaCode, note? }
  // Validates the code exists in the live Seazona catalog before saving.
  // ───────────────────────────────────────────────────────────────────────────
  fastify.put("/admin/rx-mapping/override", {
    preHandler: [authenticate, requireAdmin],
  }, async (request, reply) => {
    const { mapKey, seazonaCode, note } = request.body || {};

    if (!mapKey || !seazonaCode) {
      return reply.code(422).send({
        error: {
          ...ERROR_CODES.VALIDATION_ERROR,
          message: "mapKey and seazonaCode are required.",
        },
      });
    }

    const { byCode } = await getCatalog();
    const prod = byCode.get(String(seazonaCode));

    if (!prod) {
      return reply.code(422).send({
        error: {
          ...ERROR_CODES.VALIDATION_ERROR,
          message: "Seazona code not found in catalog.",
        },
      });
    }

    const [saved] = await db
      .insert(rxCodeOverrides)
      .values({
        id: createId(),
        mapKey,
        seazonaCode,
        seazonaProductId: prod.id,
        seazonaName: prod.name,
        note: note || null,
        confirmedBy: request.user.id,
      })
      .onConflictDoUpdate({
        target: rxCodeOverrides.mapKey,
        set: {
          seazonaCode,
          seazonaProductId: prod.id,
          seazonaName: prod.name,
          note: note || null,
          confirmedBy: request.user.id,
          updatedAt: new Date(),
        },
      })
      .returning();

    return { data: saved };
  });

  // ───────────────────────────────────────────────────────────────────────────
  // DELETE /admin/rx-mapping/override/:mapKey
  // Remove a single override. mapKey may contain colons (e.g. primary:ddso:Nylon).
  // ───────────────────────────────────────────────────────────────────────────
  fastify.delete("/admin/rx-mapping/override/:mapKey", {
    preHandler: [authenticate, requireAdmin],
  }, async (request) => {
    await db
      .delete(rxCodeOverrides)
      .where(eq(rxCodeOverrides.mapKey, request.params.mapKey));

    return { data: { ok: true } };
  });
}
