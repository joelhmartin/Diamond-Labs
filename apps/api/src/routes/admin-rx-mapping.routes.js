import { authenticate } from "../middleware/authenticate.js";
import { requireAdmin } from "../middleware/require-role.js";
import { db } from "../config/database.js";
import { rxCodeOverrides } from "../db/schema/index.js";
import { createId } from "../lib/id.js";
import { eq } from "drizzle-orm";
import { ERROR_CODES } from "@my-app/shared";
import * as seazonaService from "../services/seazona.service.js";
import { DEVICE_LABELS, resolveLineItems } from "../services/rx/catalog-map/index.js";
import { DEVICE_ROWS } from "../services/rx/catalog-map/devices.table.js";
import { compileNotesMulti } from "../services/rx/case-notes.js";
import { loadOverrides } from "../services/rx/code-overrides.service.js";

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

    // Enumerate from DEVICE_LABELS (the full device list), not DEVICE_ROWS —
    // guard and ortho-expander are resolver-driven and have no table rows, so
    // deriving the list from rows would silently drop them from the UI.
    const result = Object.keys(DEVICE_LABELS).map((deviceKey) => {
      const rows = DEVICE_ROWS.filter((r) => r.device === deviceKey);

      if (rows.length === 0) {
        // No table rows to count — resolver-driven device (guard, ortho-expander).
        return {
          deviceKey,
          name: DEVICE_LABELS[deviceKey] || deviceKey,
          coverage: null,
          resolver: true,
        };
      }

      const total = rows.length;
      const mapped = rows.filter(
        (row) => !!(overrides[row.mapKey] || (row.code != null && byCode.has(String(row.code))))
      ).length;

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
  // Resolve a MULTI-DEVICE wizard selection to line items and show their mapping
  // status. READ-ONLY — no DB writes, no Seazona writes.
  // Body: a full (fake) case — { devices:[{deviceKey, deviceOptions, label}],
  // patientFirst, patientLast, recordsMethod, physicalBite, dueDate, rush,
  // rushTier, firstDevice }. Only devices drive product line items; the rest
  // flow into patientName/due/notes so the preview shows the WHOLE order a
  // doctor would produce. BACK-COMPAT: a single { deviceKey, deviceOptions } body
  // (no `devices`) is wrapped into a one-device array.
  // ───────────────────────────────────────────────────────────────────────────
  fastify.post("/admin/rx-mapping/preview", {
    preHandler: [authenticate, requireAdmin],
  }, async (request, reply) => {
    const body = request.body || {};

    let devices = Array.isArray(body.devices) ? body.devices : null;
    if (!devices && body.deviceKey) {
      devices = [{ deviceKey: body.deviceKey, deviceOptions: body.deviceOptions || {}, label: body.deviceKey }];
    }
    if (!devices || !devices.length) {
      return reply.code(422).send({
        error: { ...ERROR_CODES.VALIDATION_ERROR, message: "devices (or a deviceKey) is required." },
      });
    }

    const [overrides, { byCode }] = await Promise.all([
      loadOverrides(),
      getCatalog(),
    ]);

    const lines = [];
    const deviceSummaries = [];

    for (const d of devices) {
      const label = d.label || DEVICE_LABELS[d.deviceKey] || d.deviceKey;
      const { items, unmapped } = resolveLineItems(
        { deviceKey: d.deviceKey, deviceOptions: d.deviceOptions || {} },
        { overrides }
      );

      const deviceLines = [
        ...items.map((item) => ({
          device: label,
          deviceKey: d.deviceKey,
          mapKey: item.mapKey,
          code: item.code,
          name: item.name,
          arch: item.arch,
          // True when this line's code came from a saved DB override — drives the
          // admin UI "Clear override" affordance.
          overridden: Boolean(item.overridden),
          seazonaProductId:
            byCode.get(String(item.code))?.id ||
            overrides[item.mapKey]?.seazonaProductId ||
            null,
          // A `proposed` row can carry a real catalog code (best-guess, not lab
          // sign-off) — it must render as "placeholder" so the admin still sees
          // the assign-code control, even though byCode.has() would be true.
          status: overrides[item.mapKey]
            ? "confirmed"
            : item.status === "proposed"
              ? "placeholder"
              : byCode.has(String(item.code))
                ? "confirmed"
                : "placeholder",
        })),
        ...unmapped.map((mapKey) => ({
          device: label,
          deviceKey: d.deviceKey,
          mapKey,
          code: null,
          name: null,
          status: "unmapped",
        })),
      ];

      deviceSummaries.push({
        label,
        deviceKey: d.deviceKey,
        confirmed: deviceLines.filter((l) => l.status === "confirmed").length,
        placeholder: deviceLines.filter((l) => l.status === "placeholder").length,
        unmapped: deviceLines.filter((l) => l.status === "unmapped").length,
        total: deviceLines.length,
      });

      lines.push(...deviceLines);
    }

    // Concise per-device notes + shared order fields once.
    const notes = compileNotesMulti(body, devices);
    const patientName = `${body.patientFirst || ""} ${body.patientLast || ""}`.trim() || null;
    const due = body.dueDate || null;

    const confirmed = lines.filter((l) => l.status === "confirmed").length;
    const placeholder = lines.filter((l) => l.status === "placeholder").length;
    const unmappedCount = lines.filter((l) => l.status === "unmapped").length;
    const total = lines.length;

    return {
      data: {
        patientName,
        due,
        lines,
        notes,
        coverage: { confirmed, placeholder, unmapped: unmappedCount, total },
        devices: deviceSummaries,
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
        // This route always requires a real, catalog-verified seazonaCode
        // (guarded above), so it can never represent a noteOnly ruling.
        // Explicit false — not just omitted — so re-assigning a real code to
        // a mapKey that was previously ruled noteOnly (via
        // admin-rx-cases.routes.js) actually clears that ruling instead of
        // leaving a stale noteOnly: true next to a new code, which
        // catalog-map/index.js's itemFromOverride would treat as noteOnly
        // and silently drop the code.
        noteOnly: false,
        confirmedBy: request.user.id,
      })
      .onConflictDoUpdate({
        target: rxCodeOverrides.mapKey,
        set: {
          seazonaCode,
          seazonaProductId: prod.id,
          seazonaName: prod.name,
          note: note || null,
          noteOnly: false,
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
