import { resolveLineItems } from "./catalog-map/index.js";

/**
 * A "device line" is any emitted line that is not a modification or a design
 * attribute. Detect it by EXCLUSION, not by a "primary:" prefix — resolver
 * devices emit their own prefixes (guard rows are `guard:<row>:<material>`),
 * so a prefix check would reject every valid nightguard order. Shared by
 * both builders below so the `mod:`/`attr:` exclusion set can't drift.
 */
const isDeviceLine = (mapKey) =>
  typeof mapKey === "string" && !mapKey.startsWith("mod:") && !mapKey.startsWith("attr:");

/**
 * Pure function: rxCase + { codeToId, userId } → { payload, warnings, unmapped, ok }.
 *
 * @param {object} rxCase        — stored Rx case record
 * @param {object} opts
 * @param {Record<string,string>} opts.codeToId — Seazona product code → catalog id
 *                                               (built from listProducts() by the caller)
 * @param {string}  opts.userId  — lab-staff Seazona user id to attach to the order
 * @returns {{ payload: object, warnings: string[], unmapped: string[], ok: boolean }}
 *   ok is false when no device line resolved (isDeviceLine) or any selection
 *   was unmapped — callers MUST refuse to push the order in that case.
 */
export function buildSeazonaOrderPayload(rxCase, { codeToId = {}, userId, overrides = {} } = {}) {
  const { items: lineItems, unmapped } = resolveLineItems(rxCase, { overrides });

  const items = [];
  // Seed warnings from unmapped device/option selections that resolveLineItems already flagged.
  const warnings = unmapped.map((u) => `unmapped ${u}`);

  let deviceLineEmitted = false;
  for (const li of lineItems) {
    const id = codeToId[li.code];
    if (!id) {
      warnings.push(`no catalog id for code ${li.code} (${li.name})`);
      continue;
    }
    if (isDeviceLine(li.mapKey)) deviceLineEmitted = true;
    items.push({ id, arch: normalizeArch(li.arch) });
  }

  const ok = deviceLineEmitted && unmapped.length === 0;

  return {
    payload: {
      clientId: rxCase.seazonaClientId,
      patientName: `${rxCase.patientFirst ?? ""} ${rxCase.patientLast ?? ""}`.trim(),
      due: rxCase.dueDate || null,
      items,
      notes: compileNotes(rxCase),
      userId,
    },
    warnings,
    unmapped,
    ok,
  };
}

/**
 * Normalize wizard arch strings → Seazona numeric codes.
 *   "Upper" → 1, "Lower" → 2, anything else (incl. "Both", null, undefined) → null.
 * Also passes through numeric 1/2 unchanged (already normalized).
 */
function normalizeArch(arch) {
  if (arch === 1 || arch === 2) return arch;
  if (typeof arch === "string") {
    const a = arch.toLowerCase();
    if (a === "upper") return 1;
    if (a === "lower") return 2;
  }
  return null; // covers "Both", null, undefined, and any other string
}

/**
 * Format a single device's structured options into readable note fragments.
 * Shared by compileNotes (single device) and compileNotesMulti (per device).
 *
 * Matches how the lab actually builds orders in Seazona (verified against live
 * orders, e.g. inv 10601): device + material/variant and each modification are
 * PRODUCT LINE ITEMS (resolved by catalog-map/index.js), NOT notes. So material,
 * variant, and modifications are deliberately excluded here. Notes carry only
 * free-text clinical detail that has no product code — occlusal contact, design
 * preference, VDO/titration, and device-specific instructions.
 */
function deviceOptionLines(o = {}) {
  const lines = [];
  if (o.occlusalContact)  lines.push(`Occlusal Contact: ${o.occlusalContact}`);
  if (o.designPreference) lines.push(`Design Preference: ${o.designPreference}`);
  if (o.titration)        lines.push(`VDO/Titration: ${JSON.stringify(o.titration)}`);
  if (o.comments)         lines.push(`Device notes: ${o.comments}`);
  return lines;
}

/**
 * Order-level (shared) note fragments — emitted ONCE per order. Records method,
 * physical bite, and first-device are NOT noted on real orders (records are
 * conveyed via the uploaded scan files). Rush is the only operational flag with
 * no other home in the createOrder payload, so it stays.
 */
function sharedNoteLines(c = {}) {
  const lines = [];
  if (c.rush) lines.push(`RUSH (${c.rushTier || "?"})`);
  return lines;
}

/**
 * Compile structured deviceOptions + top-level case fields into a single notes string.
 * Seazona notes are limited to 2000 characters.
 */
export function compileNotes(c) {
  const lines = [...deviceOptionLines(c.deviceOptions || {}), ...sharedNoteLines(c)];
  if (c.generalComments) lines.push(`General: ${c.generalComments}`);
  return lines.join(" | ").slice(0, 2000);
}

/**
 * Multi-device notes: one "[<label>] <opts>" fragment per device, then the
 * shared order fields ONCE. Capped at 2000 chars. Never dumps arbitrary fields.
 *
 * @param {object} shared  — order-level fields (physicalBite/recordsMethod/firstDevice/rush/rushTier)
 * @param {Array<{label?:string, deviceKey?:string, deviceOptions?:object}>} devices
 */
export function compileNotesMulti(shared = {}, devices = []) {
  const lines = [];
  for (const d of devices) {
    const opts = deviceOptionLines(d.deviceOptions || {}).join(", ");
    const label = d.label || d.deviceKey || "device";
    lines.push(opts ? `[${label}] ${opts}` : `[${label}]`);
  }
  lines.push(...sharedNoteLines(shared));
  return lines.join(" | ").slice(0, 2000);
}

/**
 * Multi-device payload builder. Loops resolveLineItems per device, aggregates
 * line items (resolving code→id against the live catalog; warns on misses), and
 * compiles a concise per-device notes string. The single-device
 * buildSeazonaOrderPayload is kept intact for the existing pipeline.
 *
 * @param {object} shared   — order-level fields incl. seazonaClientId, patientFirst/Last, dueDate
 * @param {Array<{deviceKey:string, label?:string, deviceOptions?:object}>} devices
 * @param {object} opts
 * @param {Record<string,string>} opts.codeToId — Seazona product code → catalog id
 * @param {string} opts.userId
 * @param {object} opts.overrides
 * @returns {{ payload, warnings: string[], unmapped: string[], perDevice: Array<{label,deviceKey,lineCount,ok:boolean}>, ok: boolean }}
 *   Each perDevice entry's ok mirrors buildSeazonaOrderPayload's ok for that
 *   device; the overall ok is false unless every device is ok AND at least
 *   one device was provided (an empty devices[] must never read as "ok").
 */
export function buildSeazonaOrderPayloadMulti(
  shared = {},
  devices = [],
  { codeToId = {}, userId, overrides = {} } = {}
) {
  const items = [];
  const warnings = [];
  const unmapped = [];
  const perDevice = [];

  for (const d of devices) {
    const { items: lineItems, unmapped: devUnmapped } = resolveLineItems(
      { deviceKey: d.deviceKey, deviceOptions: d.deviceOptions || {} },
      { overrides }
    );

    for (const u of devUnmapped) {
      unmapped.push(u);
      warnings.push(`unmapped ${u}`);
    }

    let lineCount = 0;
    let deviceLineEmitted = false;
    for (const li of lineItems) {
      const id = codeToId[li.code];
      if (!id) {
        warnings.push(`no catalog id for code ${li.code} (${li.name})`);
        continue;
      }
      if (isDeviceLine(li.mapKey)) deviceLineEmitted = true;
      items.push({ id, arch: normalizeArch(li.arch) });
      lineCount++;
    }

    const deviceOk = deviceLineEmitted && devUnmapped.length === 0;
    perDevice.push({ label: d.label || d.deviceKey, deviceKey: d.deviceKey, lineCount, ok: deviceOk });
  }

  // perDevice.every(...) is vacuously true for an empty array — require at
  // least one device so an empty devices[] can never read as "ok".
  const ok = devices.length > 0 && perDevice.every((d) => d.ok);

  return {
    payload: {
      clientId: shared.seazonaClientId,
      patientName: `${shared.patientFirst ?? ""} ${shared.patientLast ?? ""}`.trim(),
      due: shared.dueDate || null,
      items,
      notes: compileNotesMulti(shared, devices),
      userId,
    },
    warnings,
    unmapped,
    perDevice,
    ok,
  };
}
