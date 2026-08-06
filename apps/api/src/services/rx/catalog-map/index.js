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

/** First row whose match[] contains `literal`. */
function findRow(rows, literal, device) {
  return rows.find(
    (r) => (device === undefined || r.device === device) && r.match.includes(literal)
  );
}

/** Push a row as a line item, honouring an override and skipping `open`. */
function emit(row, { items, unmapped }, overrides, arch = null) {
  const override = overrides[row.mapKey];
  if (override) {
    items.push({ ...override, mapKey: row.mapKey, arch, status: "confirmed", overridden: true });
    return;
  }
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
  if (override) {
    items.push({ ...override, mapKey, arch, status: "confirmed", overridden: true });
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
      acc.items.push(override ? { ...override, mapKey: it.mapKey, arch: it.arch, status: "confirmed", overridden: true } : { ...it, overridden: false });
    }
    for (const mapKey of unmapped) emitOverrideOrUnmapped(mapKey, acc, overrides);
  } else {
    // Primary line: keyed by baseMaterial, variant, or the literal "default".
    const literal = deviceOptions.baseMaterial || deviceOptions.variant || "default";
    const row = findRow(DEVICE_ROWS, literal, deviceKey);
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
