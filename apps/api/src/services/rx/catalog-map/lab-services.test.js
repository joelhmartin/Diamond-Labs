/**
 * Case-level lab services checked against what the lab actually billed
 * (JotForm prescriptions matched to their Seazona orders, 2025–26).
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import {
  resolveLabServices, LAB_SERVICE_ROWS, SCANNER_RECORDS, PVS_RECORDS, MODEL_RECORDS, BITE_RECORDS,
} from "./lab-services.js";
import { resolveCaseServices } from "./index.js";
import { digitalRxForm } from "../../../../../web/src/data/forms/digital-rx.form.js";

const ONE = [{ deviceKey: "ddso" }];
const TWO = [{ deviceKey: "olmos-day" }, { deviceKey: "olmos-night" }];

/** "code×arches" per line, sorted — e.g. ["2367 lower", "2367 upper"]. */
const lines = (formData, devices = ONE) =>
  resolveLabServices(formData, devices).map((i) => `${i.code} ${i.arch}`).sort();
const perArch = (...codes) => codes.flatMap((c) => [`${c} lower`, `${c} upper`]).sort();

const RECORDS_EVIDENCE = [
  // [records answer, expected per-arch codes, evidence]
  [["3SHAPE"], ["2367"], "2367 95%, n=1,045"],
  [["ITERO"], ["2367"], "95%, n=796"],
  [["MEDIT"], ["2367"], "95%, n=517"],
  [["ALL OTHER SCANNERS"], ["2367"], "98%, n=262"],
  [["CEREC"], ["2367"], "93%, n=189"],
  [["CARESTREAM"], ["2367"], "97%, n=109"],
  [["SHINING 3D"], ["2367"], "100%, n=33"],
  [["PLANMECA"], ["2367"], "100%, n=11"],
  [["PVS Impressions"], ["2369", "2371"], "2369 90%, 2371 63%, n=71"],
  [["Stone/Resin Models"], ["2371"], "60%, n=48"],
  // A scan is fabricated digitally; physical records are not billed on top.
  [["Physical Bite Registration", "ITERO"], ["2367"], "bite reg is not a model source"],
  [["Physical Bite Registration"], [], "no model source sent"],
];

test("each records answer bills the model services real orders carried", () => {
  for (const [records, codes, why] of RECORDS_EVIDENCE)
    assert.deepEqual(lines({ records, firstDevice: "Yes" }), perArch(...codes), `${records} (${why})`);
});

test("previous records bill a remake model, not fabrication", () => {
  // "No, use PREVIOUS RECORDS": 2393 82%, 2367 only 9% (n=119).
  assert.deepEqual(lines({ records: ["3SHAPE"], firstDevice: "No, use PREVIOUS RECORDS" }), perArch("2393"));
  // "No, use NEW RECORDS" is an ordinary new scan: 2367 93% (n=155).
  assert.deepEqual(lines({ records: ["3SHAPE"], firstDevice: "No, use NEW RECORDS" }), perArch("2367"));
});

test("two or more devices add duplication and articulation per arch", () => {
  // Multi-device orders: 2372 88%, 2368 90% (n=1,185); single-device 2% / 14%.
  assert.deepEqual(lines({ records: ["MEDIT"] }, TWO), perArch("2367", "2368", "2372"));
  assert.deepEqual(lines({ records: ["MEDIT"] }, ONE), perArch("2367"));
});

test("every lab-service line is per arch, upper then lower", () => {
  // 2367 sat on 3,071 orders as two lines (arch 1 + arch 2); 2372 on 1,103.
  const items = resolveLabServices({ records: ["3SHAPE"] }, TWO);
  for (const code of ["2367", "2368", "2372"])
    assert.deepEqual(items.filter((i) => i.code === code).map((i) => i.arch), ["upper", "lower"]);
});

test("no form answers, no lab services — never invented", () => {
  assert.deepEqual(resolveLabServices({}, ONE), []);
  assert.deepEqual(resolveLabServices(undefined, []), []);
});

test("every row's code and name matches the live Seazona catalog", () => {
  const catalog = {
    2367: "Digital Model Fabrication (Per Arch)",
    2368: "Articulate Models",
    2369: "Impression Pour Up (Per Arch)",
    2371: "Scan/Digitize Models (Per Arch)",
    2372: "Model Duplication (Per Arch)",
    2393: "Remake Model Fabrication",
  };
  for (const r of LAB_SERVICE_ROWS) assert.equal(r.name, catalog[r.code], r.mapKey);
});

test("an override on a lab service applies to each arch's line", () => {
  const overrides = { "service:model-fab": { noteOnly: true, code: null, name: "Model fab (included)" } };
  const { items } = resolveCaseServices({ records: ["3SHAPE"] }, ONE, { overrides });
  assert.equal(items.length, 2);
  assert.ok(items.every((i) => i.noteOnly && i.overridden));
  assert.deepEqual(items.map((i) => i.arch), ["upper", "lower"]);
});

test("every records option on the live form is classified", () => {
  // Cross-package: adding a scanner to the form without telling this module
  // would silently stop billing model fabrication for it.
  const field = digitalRxForm.sections.flatMap((s) => s.fields || []).find((f) => f.key === "records");
  assert.ok(field, "the records field left the digital Rx form — update lab-services.js");
  const known = [...SCANNER_RECORDS, PVS_RECORDS, MODEL_RECORDS, BITE_RECORDS];
  for (const o of field.options) {
    const value = typeof o === "string" ? o : o.value;
    assert.ok(known.includes(value), `records option "${value}" is not classified in lab-services.js`);
  }
});

test("the first-device answer this module keys on is still on the live form", () => {
  const field = digitalRxForm.sections.flatMap((s) => s.fields || []).find((f) => f.key === "firstDevice");
  assert.ok(field, "firstDevice left the digital Rx form — update lab-services.js");
  assert.ok(field.options.map((o) => (typeof o === "string" ? o : o.value)).includes("No, use PREVIOUS RECORDS"));
});
