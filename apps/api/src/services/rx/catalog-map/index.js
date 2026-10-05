import { DEVICE_ROWS } from "./devices.table.js";
import { MODIFICATION_ROWS } from "./modifications.table.js";
import { ATTRIBUTE_ROWS } from "./attributes.table.js";
import { resolveGuard } from "./resolvers/guard.js";
import { resolveOrtho } from "./resolvers/ortho.js";

/** Human-readable device names for admin tooling that cannot import the frontend. */
export const DEVICE_LABELS = {
  ddso: "DDSO",
  "olmos-day": "Olmos Day (OD)",
  "olmos-night": "Olmos Night",
  "cadcam-d-pro": "CAD/CAM D-Pro (Dorsal Pro)",
  "shirazi-hybrid": "Shirazi Hybrid",
  snorehook: "SnoreHook",
  guard: "Nightguard",
  "sport-guard": "Sport-Guard",
  mora: "MORA",
  ara: "ARA",
  "ortho-expander": "Orthodontic Appliance",
};

export const LAB_SERVICE_CODES = {
  modelFabPerArch: { code: "2367", name: "Digital Model Fabrication (Per Arch)" },
  articulate:      { code: "2368", name: "Articulate Models" },
};

const RESOLVERS = { guard: resolveGuard, "ortho-expander": resolveOrtho };

/**
 * The device's primary product row. A row with a `material` list is keyed on
 * BOTH the design (`variant`) and `baseMaterial` — Olmos Night, where the
 * design alone names six products. Other rows match whichever of
 * baseMaterial / variant / "default" the form supplied.
 */
function findPrimaryRow(deviceKey, o) {
  const rows = DEVICE_ROWS.filter((r) => r.device === deviceKey);
  const paired = rows.find((r) => r.material && r.match.includes(o.variant) && r.material.includes(o.baseMaterial));
  if (paired) return paired;
  // Most specific answer first, so "Manta" beats D-Pro's "default" fallback.
  for (const key of [o.baseMaterial, o.variant, "default"].filter(Boolean)) {
    const row = rows.find((r) => !r.material && r.match.includes(key));
    if (row) return row;
  }
  return undefined;
}

/** First row whose match[] contains `literal`. */
function findRow(rows, literal, device) {
  return rows.find(
    (r) => (device === undefined || r.device === device) && r.match.includes(literal)
  );
}

/**
 * Turn a DB override into a line item, or signal that it can't be one.
 *
 * Two shapes an override can represent:
 * - A confirmed product: `code` is set. Emits a normal, priced line.
 * - A confirmed noteOnly ruling: the lab decided this selection is a build
 *   instruction, not a charged product (see admin-rx-cases.routes.js's
 *   overrideRowFor). Emits a line with `noteOnly: true` and no code — never
 *   a phantom "confirmed" product line, because canPush and the order-payload
 *   builder both key off `noteOnly` to keep this out of priced/sendable
 *   items (see admin-rx-cases.routes.js's canPush and case-lines.service.js).
 *
 * A third, invalid shape — no code AND not noteOnly — claims a resolved
 * mapping to nothing. Returns null so the caller falls back to `unmapped`
 * instead of emitting a codeless "confirmed" line.
 */
function itemFromOverride(override, mapKey, arch) {
  if (override.noteOnly) {
    return {
      code: null,
      seazonaProductId: null,
      name: override.name ?? null,
      mapKey,
      arch,
      status: "confirmed",
      noteOnly: true,
      overridden: true,
    };
  }
  if (!override.code) return null;
  return {
    code: override.code,
    seazonaProductId: override.seazonaProductId ?? null,
    name: override.name,
    mapKey,
    arch,
    status: "confirmed",
    noteOnly: false,
    overridden: true,
  };
}

/** Push a row as a line item, honouring an override and skipping `open`. */
function emit(row, { items, unmapped }, overrides, arch = null) {
  const override = overrides[row.mapKey];
  if (override) {
    const item = itemFromOverride(override, row.mapKey, arch);
    if (item) {
      items.push(item);
    } else {
      unmapped.push(row.mapKey);
    }
    return;
  }
  if (row.status === "none") return; // deliberately no line item — not a gap, don't flag it
  if (row.status === "open" || !row.code) {
    unmapped.push(row.mapKey);
    return;
  }
  items.push({ code: row.code, name: row.name, mapKey: row.mapKey, arch, status: row.status, overridden: false });
}

/**
 * No row matched `mapKey` at all (unrecognized literal, or a resolver-reported
 * gap like a guard slot with no catalog match). The bare-mapKey convention
 * means an admin can still resolve this via `rx_code_overrides` keyed on
 * exactly this string — so check overrides here too, not just on known rows.
 * Only truly unresolved selections fall through to `unmapped`.
 */
function emitOverrideOrUnmapped(mapKey, { items, unmapped }, overrides, arch = null) {
  const override = overrides[mapKey];
  const item = override ? itemFromOverride(override, mapKey, arch) : null;
  if (item) {
    items.push(item);
  } else {
    unmapped.push(mapKey);
  }
}

export function resolveLineItems({ deviceKey, deviceOptions = {} } = {}, { overrides = {} } = {}) {
  const acc = { items: [], unmapped: [] };

  const custom = RESOLVERS[deviceKey];
  if (custom) {
    const { items, unmapped } = custom(deviceOptions);
    for (const it of items) {
      const override = overrides[it.mapKey];
      if (!override) {
        acc.items.push({ ...it, overridden: false });
        continue;
      }
      const item = itemFromOverride(override, it.mapKey, it.arch);
      if (item) {
        acc.items.push(item);
      } else {
        // Incoherent override (no code, not noteOnly) — fall back to
        // unmapped rather than emit a codeless "confirmed" line.
        acc.unmapped.push(it.mapKey);
      }
    }
    // Plain passthrough — NOT emitOverrideOrUnmapped. A resolver's unmapped
    // mapKey (e.g. a guard slider-type slot) can correspond to MULTIPLE
    // physical line items when several arches were ordered on that row, but
    // the resolver only reports the mapKey once (arch isn't attached to it).
    // Recovering it into a single override item would silently collapse a
    // two-arch order into one line. Leave these in `unmapped`; the admin
    // resolves the ambiguity at the resolver/table level, not per-order.
    acc.unmapped.push(...unmapped);
  } else {
    // Primary line: keyed by baseMaterial, variant, or the literal "default".
    const literal = deviceOptions.baseMaterial || deviceOptions.variant || "default";
    const row = findPrimaryRow(deviceKey, deviceOptions);
    if (row) emit(row, acc, overrides, deviceOptions.arch ?? null);
    else emitOverrideOrUnmapped(`primary:${deviceKey}:${literal}`, acc, overrides, deviceOptions.arch ?? null);
  }

  // Modifications — shared across devices.
  for (const mod of deviceOptions.modifications || []) {
    const row = findRow(MODIFICATION_ROWS, mod);
    if (row) emit(row, acc, overrides);
    else emitOverrideOrUnmapped(`mod:${mod}`, acc, overrides);
  }

  // Design attributes → $0 line items.
  for (const literal of [deviceOptions.occlusalContact, deviceOptions.designPreference]) {
    if (!literal) continue;
    const row = findRow(ATTRIBUTE_ROWS, literal);
    if (row) emit(row, acc, overrides);
    else emitOverrideOrUnmapped(`attr:${literal}`, acc, overrides);
  }

  return acc;
}
