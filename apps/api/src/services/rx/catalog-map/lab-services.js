/**
 * Case-level lab services: model fabrication, pour-ups, scanning, duplication,
 * articulation. They are not a doctor's device selection — the lab adds them
 * from HOW the records arrived and WHAT the devices are made on — so they are
 * resolved once per case, not per device.
 *
 * Rules are taken from the orders the lab actually built: JotForm
 * prescriptions matched to their Seazona orders (Jan 2025–Oct 2026, 3,519
 * new-device orders read line by line), then checked by replaying 437 recent
 * prescriptions through the portal (apps/api/scripts/rx-replay). Every one of
 * these products is billed per arch, as two lines (arch 1 and arch 2).
 *
 * The rules, as the lab would say them:
 *   1. Scanned records are fabricated digitally (2367); previous records are a
 *      remake model (2393); PVS is poured up (2369).
 *   2. A device pressed on a stone model — PMT, acrylic or dual-laminate, a
 *      PRO / Trainer sport-guard, an ortho appliance on an acrylic arch — is
 *      mounted on an articulator (2368), whatever else is on the case.
 *   3. When the case also carries a second device, that stone model is
 *      duplicated (2372) — unless physical records were scanned (2371) for a
 *      printed device, in which case the scan is the copy.
 *   4. An ortho appliance on one arch only gets that arch's model.
 *
 * Pure: formData + devices in, line items out. Seeding and re-resolve both
 * call this through catalog-map/index.js's resolveCaseServices, so the two can
 * never disagree about what a case is charged.
 */
import { nestGuardMatrix } from "./resolvers/guard.js";

// The records picker's intraoral-scanner options (digital-rx.form.js
// RECORDS_OPTIONS). lab-services.form-coverage.test.js fails if the form gains
// a records option this module does not classify.
export const SCANNER_RECORDS = [
  "3SHAPE", "CARESTREAM", "CEREC", "ITERO", "MEDIT", "MIDMARK", "SHINING 3D", "PLANMECA", "ALL OTHER SCANNERS",
];
export const PVS_RECORDS = "PVS Impressions";
export const MODEL_RECORDS = "Stone/Resin Models";
// A bite registration is not a model source — real orders with it are billed
// by whatever else was sent (66% of them also carried a scan).
export const BITE_RECORDS = "Physical Bite Registration";
export const PREVIOUS_RECORDS = "No, use PREVIOUS RECORDS";

/** Table-shaped rows, for the mapping report and for override lookups. */
export const LAB_SERVICE_ROWS = [
  // 93–100% of orders for every scanner brand (3SHAPE 95% n=1,045; ITERO 95% n=796).
  { mapKey: "service:model-fab",        match: ["Records sent as an intraoral scan (any scanner)"],          code: "2367", name: "Digital Model Fabrication (Per Arch)", status: "confirmed" },
  // PVS Impressions: 2369 on 90% of orders (n=71).
  { mapKey: "service:impression-pour-up", match: ["Records sent as PVS Impressions"],                         code: "2369", name: "Impression Pour Up (Per Arch)",       status: "confirmed" },
  // PVS 63% (n=71), Stone/Resin Models 60% (n=48); replay: billed on 8 of 9
  // physical-records cases with a printed device, and on none (0 of 4) whose
  // only devices were pressed on stone.
  { mapKey: "service:scan-models",      match: ["Physical records (PVS or Stone/Resin Models) and a printed device on the case"], code: "2371", name: "Scan/Digitize Models (Per Arch)", status: "proposed" },
  // "No, use PREVIOUS RECORDS": 82% (n=119); fabrication 2367 drops to 9%.
  { mapKey: "service:remake-model-fab", match: ["First device? \"No, use PREVIOUS RECORDS\""],                code: "2393", name: "Remake Model Fabrication",            status: "confirmed" },
  // OD PMT: 2372 89% (n=1,143), and the OD carries a second device on ~90% of
  // those orders; a digital OD's duplication falls to 29% (BioFlex) or less.
  { mapKey: "service:model-duplication", match: ["A device pressed on a stone model, and a second device on the case"], code: "2372", name: "Model Duplication (Per Arch)", status: "confirmed" },
  // 2368 by material: OD PMT 97% (n=1,143), ON PMT 98% (n=147), nightguard
  // PMT 88% (n=25), OD acrylic 83% / ON acrylic 87%, OD dual-laminate 89%;
  // printed materials 0–17%. PRO sport-guard 100% (n=11), Trainer 91% (n=22).
  // Ortho: an acrylic, clasp-retained lower 96% (n=103).
  { mapKey: "service:articulate",       match: ["A device pressed on a stone model (PMT, acrylic, dual-laminate, PRO/Trainer sport-guard, acrylic ortho arch)"], code: "2368", name: "Articulate Models", status: "confirmed" },
];

const ROW = Object.fromEntries(LAB_SERVICE_ROWS.map((r) => [r.mapKey, r]));
const BOTH = ["upper", "lower"];

const perArch = (mapKey, arches = BOTH) => {
  const r = ROW[mapKey];
  return arches.map((arch) => ({ mapKey: r.mapKey, code: r.code, name: r.name, arch, status: r.status }));
};

// Thermoformed / processed materials, which the lab presses on a poured stone
// model. Every printed material (Nylon, Biomed, BioFlex, Milled) is not.
const STONE_MATERIAL = /pmt|acrylic|dual[- ]?laminate/i;
// Pressure-laminated sport-guards. The CAD/CAM tier is milled (2368 < 8%).
const STONE_SPORT_GUARD = /^(PRO|Trainer)\b/;

const materialsOf = (d) => {
  const o = d.deviceOptions || {};
  if (d.deviceKey === "guard")
    return Object.values(nestGuardMatrix(o.standardGuards)).map((cells) => cells["Base Material"]);
  if (d.deviceKey === "ortho-expander") return [o.upperArchRetention, o.lowerArchRetention];
  return [o.baseMaterial];
};

/** Is this device pressed on a stone model (so mounted on an articulator)? */
export function isStoneModelDevice(d = {}) {
  if (d.deviceKey === "sport-guard") return STONE_SPORT_GUARD.test(d.deviceOptions?.variant ?? "");
  return materialsOf(d).some((m) => typeof m === "string" && STONE_MATERIAL.test(m));
}

const filled = (v) =>
  Array.isArray(v) ? v.length > 0 : v && typeof v === "object" ? Object.values(v).some(filled) : v != null && String(v).trim() !== "";

/**
 * The arches an ortho appliance sits on, from the form's per-arch answers. A
 * dual-arch device (Modified Tandem, Twin Block) or no per-arch answer at all
 * means both.
 */
export function orthoArches(o = {}) {
  if (filled(o.applianceType)) return BOTH;
  const upper = ["upperArchRetention", "upperExpansionType", "upperAddOns", "upperExpansionSelection"].some((k) => filled(o[k]));
  const lower = [
    "lowerArchRetention", "lowerExpansionType", "lowerAddOns", "lowerExpansionSelection",
    "fixedMandibularExpansion", "removableMandibularExpansion",
  ].some((k) => filled(o[k]));
  if (upper && !lower) return ["upper"];
  if (lower && !upper) return ["lower"];
  return BOTH;
}

/**
 * The lab-service line items a case carries.
 *
 * @param {object} formData — the case's raw form answers (`records`, `firstDevice`)
 * @param {Array} devices  — the case's resolved device list
 * @returns {Array<{mapKey, code, name, arch, status}>}
 */
export function resolveLabServices(formData = {}, devices = []) {
  const items = [];
  const records = [].concat(formData?.records ?? []);
  // Single-arch ortho: model work for that arch only (replay: 11 of 26
  // non-tandem ortho orders billed one arch, always the appliance's).
  const arches = devices.length === 1 && devices[0].deviceKey === "ortho-expander"
    ? orthoArches(devices[0].deviceOptions)
    : BOTH;
  const stone = devices.some(isStoneModelDevice);
  const printed = devices.some((d) => !isStoneModelDevice(d));
  let scanned = false;

  if (formData?.firstDevice === PREVIOUS_RECORDS) {
    items.push(...perArch("service:remake-model-fab", arches));
  } else if (records.some((r) => SCANNER_RECORDS.includes(r))) {
    items.push(...perArch("service:model-fab", arches));
  } else {
    if (records.includes(PVS_RECORDS)) items.push(...perArch("service:impression-pour-up", arches));
    if ((records.includes(PVS_RECORDS) || records.includes(MODEL_RECORDS)) && printed) {
      items.push(...perArch("service:scan-models", arches));
      scanned = true;
    }
  }

  if (devices.length >= 2 && stone && !scanned) items.push(...perArch("service:model-duplication"));
  if (stone) items.push(...perArch("service:articulate"));
  return items;
}
