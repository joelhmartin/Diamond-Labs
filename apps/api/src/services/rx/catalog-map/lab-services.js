/**
 * Case-level lab services: model fabrication, pour-ups, duplication,
 * articulation. They are not a doctor's device selection — the lab adds them
 * from HOW the records arrived and HOW MANY devices the case carries — so they
 * are resolved once per case, not per device.
 *
 * Rules are taken from the orders the lab actually built: 15,808 JotForm
 * prescriptions matched to their Seazona orders (2025–26, 3,600 new-device
 * orders read line by line). Every one of these products is billed per arch,
 * as two lines (arch 1 and arch 2) on 85–100% of the orders that carry it.
 *
 * Pure: formData + devices in, line items out. Seeding and re-resolve both
 * call this through catalog-map/index.js's resolveCaseServices, so the two can
 * never disagree about what a case is charged.
 */

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
  // PVS 63% (n=71), Stone/Resin Models 60% (n=48) — usual, not universal.
  { mapKey: "service:scan-models",      match: ["Records sent as PVS Impressions or Stone/Resin Models"],     code: "2371", name: "Scan/Digitize Models (Per Arch)",     status: "proposed" },
  // "No, use PREVIOUS RECORDS": 82% (n=119); fabrication 2367 drops to 9%.
  { mapKey: "service:remake-model-fab", match: ["First device? \"No, use PREVIOUS RECORDS\""],                code: "2393", name: "Remake Model Fabrication",            status: "confirmed" },
  // Two or more devices: 2372 on 88%, 2368 on 90% (n=1,185); one device: 2% / 14%.
  { mapKey: "service:model-duplication", match: ["Two or more devices on the case"],                         code: "2372", name: "Model Duplication (Per Arch)",        status: "confirmed" },
  { mapKey: "service:articulate",       match: ["Two or more devices on the case"],                          code: "2368", name: "Articulate Models",                   status: "confirmed" },
];

const ROW = Object.fromEntries(LAB_SERVICE_ROWS.map((r) => [r.mapKey, r]));

const perArch = (mapKey) => {
  const r = ROW[mapKey];
  return ["upper", "lower"].map((arch) => ({ mapKey: r.mapKey, code: r.code, name: r.name, arch, status: r.status }));
};

/**
 * The lab-service line items a case carries.
 *
 * Records: previous records replace fabrication outright; otherwise a scan is
 * fabricated digitally, and only a case with NO scan is billed for pouring /
 * digitizing the physical records it sent.
 *
 * @param {object} formData — the case's raw form answers (`records`, `firstDevice`)
 * @param {Array} devices  — the case's resolved device list
 * @returns {Array<{mapKey, code, name, arch, status}>}
 */
export function resolveLabServices(formData = {}, devices = []) {
  const items = [];
  const records = [].concat(formData?.records ?? []);

  if (formData?.firstDevice === PREVIOUS_RECORDS) {
    items.push(...perArch("service:remake-model-fab"));
  } else if (records.some((r) => SCANNER_RECORDS.includes(r))) {
    items.push(...perArch("service:model-fab"));
  } else {
    if (records.includes(PVS_RECORDS)) items.push(...perArch("service:impression-pour-up"));
    if (records.includes(PVS_RECORDS) || records.includes(MODEL_RECORDS)) items.push(...perArch("service:scan-models"));
  }

  if (devices.length >= 2) {
    items.push(...perArch("service:model-duplication"), ...perArch("service:articulate"));
  }
  return items;
}
