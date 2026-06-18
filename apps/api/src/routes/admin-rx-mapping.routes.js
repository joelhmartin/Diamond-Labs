import { authenticate } from "../middleware/authenticate.js";
import { requireAdmin } from "../middleware/require-role.js";
import { db } from "../config/database.js";
import { rxCodeOverrides } from "../db/schema/index.js";
import { createId } from "../lib/id.js";
import { eq } from "drizzle-orm";
import { ERROR_CODES } from "@my-app/shared";
import * as seazonaService from "../services/seazona.service.js";
import { DEVICE_MAP, DEVICE_LABELS, resolveLineItems } from "../services/rx/device-seazona-map.js";
import { compileNotes, buildSeazonaOrderPayload } from "../services/rx/build-order-payload.js";

// ─── Test-order target (Matt Rago, internal Diamond account) ──────────────────
// "Send test order" ALWAYS targets this hardcoded client + lab user so a mapping
// test can NEVER create an order under a real doctor. Confirmed live 2026-06-17.
const TEST_ORDER_CLIENT_ID = "876bad9a-0257-49eb-bfd6-bce0a999b88a"; // Matt Rago (acct 1324)
const TEST_ORDER_USER_ID = "9cae86a4-809e-4879-8ffb-b76d39b95978";   // Matt Rago (lab user)

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
  // Body: a full (fake) case — { deviceKey, deviceOptions, patientFirst, patientLast,
  // dob, recordsMethod, physicalBite, dueDate, rush, rushTier, firstDevice,
  // generalComments }. Only deviceKey/deviceOptions drive product line items; the
  // rest flow into patientName/due/notes so the preview shows the WHOLE order a
  // doctor would produce, not just the device lines.
  // ───────────────────────────────────────────────────────────────────────────
  fastify.post("/admin/rx-mapping/preview", {
    preHandler: [authenticate, requireAdmin],
  }, async (request, reply) => {
    const body = request.body || {};
    const { deviceKey, deviceOptions = {} } = body;

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

    // Compile notes from the FULL case (records method, physical bite, occlusal/
    // design/modifications, rush, comments, etc.) — mirrors what the real payload
    // builder produces for a doctor's submission.
    const notes = compileNotes(body);
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

  // ───────────────────────────────────────────────────────────────────────────
  // POST /admin/rx-mapping/send-test
  // The ONLY live Seazona write in this feature. Creates a REAL order in Seazona
  // (no sandbox exists) so an admin can see how a filled form lands. It ALWAYS
  // targets the hardcoded Matt Rago test client + user — body-supplied client/user
  // are ignored — so it can never create an order under a real doctor. Requires
  // an explicit confirm:true. Sends only line items whose code resolves to a real
  // catalog id; reports any dropped (placeholder/unmapped) lines. Notes are
  // prefixed [MAPPING TEST] so the order is obvious in Seazona (cancel it after).
  // ───────────────────────────────────────────────────────────────────────────
  fastify.post("/admin/rx-mapping/send-test", {
    preHandler: [authenticate, requireAdmin],
  }, async (request, reply) => {
    const body = request.body || {};
    if (body.confirm !== true) {
      return reply.code(400).send({
        error: { ...ERROR_CODES.VALIDATION_ERROR, message: "confirm:true is required — this creates a real Seazona order." },
      });
    }
    if (!body.deviceKey) {
      return reply.code(422).send({
        error: { ...ERROR_CODES.VALIDATION_ERROR, message: "deviceKey is required." },
      });
    }

    const [overrides, { byCode }] = await Promise.all([loadOverrides(), getCatalog()]);
    const codeToId = {};
    for (const [code, v] of byCode.entries()) codeToId[code] = v.id;

    // Build the payload, but FORCE the client to the Matt Rago test account.
    const { payload, warnings, unmapped } = buildSeazonaOrderPayload(
      { ...body, seazonaClientId: TEST_ORDER_CLIENT_ID },
      { codeToId, userId: TEST_ORDER_USER_ID, overrides }
    );

    if (!payload.items.length) {
      return reply.code(422).send({
        error: {
          ...ERROR_CODES.VALIDATION_ERROR,
          message: "No line items resolved to a real Seazona code — confirm codes for this device before sending a test order.",
        },
        meta: { warnings, unmapped },
      });
    }

    // Mark the order unmistakably as a mapping test.
    payload.notes = `[MAPPING TEST — Matt Rago] ${payload.notes || ""}`.slice(0, 2000);
    if (!payload.patientName) payload.patientName = "Mapping Test";

    const res = await seazonaService.createOrder(payload);
    const seazonaOrderId = res?.orderId != null ? String(res.orderId) : (res?.id != null ? String(res.id) : null);

    if (!seazonaOrderId) {
      request.log.error(
        { payload, res },
        "[Seazona][RX_MAPPING_TEST_FAILED] createOrder returned no orderId for a mapping test order"
      );
      return reply.code(502).send({
        error: { code: "SEAZONA_ORDER_FAILED", status: 502, message: "Seazona createOrder did not return an order id. See server logs." },
        meta: { payloadSent: payload, warnings },
      });
    }

    request.log.info(
      { seazonaOrderId, clientId: TEST_ORDER_CLIENT_ID, items: payload.items.length, droppedLines: warnings.length },
      "[Seazona][RX_MAPPING_TEST_ORDER] created test order under Matt Rago"
    );

    return {
      data: {
        seazonaOrderId,
        clientId: TEST_ORDER_CLIENT_ID,
        patientName: payload.patientName,
        itemCount: payload.items.length,
        droppedLines: warnings, // placeholder/unmapped lines NOT sent
        payloadSent: payload,
      },
    };
  });
}
