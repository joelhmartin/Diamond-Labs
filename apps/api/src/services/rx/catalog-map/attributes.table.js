/**
 * Occlusal-contact and design-preference selections → NO line item.
 *
 * The catalog does carry $0 products for these (2289 Anterior / 2291 TRIPOD /
 * 2292 Full / 2293 Posterior Contact, 2308 Buccal-Free / 2314 Lingual-Free
 * Design), but the lab does not bill them: not one of those codes appears on
 * any of 3,600 real new-device orders (2025–26), although hundreds of their
 * prescriptions answered these questions (Posterior Contact n=405,
 * Anterior Contact n=346, Standard n=641). The
 * selection is design intent, so it travels in the order notes
 * (build-order-payload.js deviceOptionLines) and never as a line.
 *
 * Every row is status "none" — a deliberate no-op, not a gap — so a known
 * answer neither emits a line nor flags the order as unmapped. An answer that
 * matches no row is still flagged (`attr:<literal>`): that means the form
 * changed under this table, which someone should see.
 *
 * `match` holds EVERY form literal that resolves to a row. The consolidated Rx
 * form and the older wizard word these differently ("Posterior Contact" vs
 * "Posterior"); wizard literals come from OCCLUSAL_CONTACT /
 * DESIGN_PREFERENCES in apps/web/src/data/rx-devices.js.
 */
export const ATTRIBUTE_ROWS = [
  { mapKey: "attr:occlusal:posterior", match: ["Posterior Contact", "Posterior"], code: null, name: "Posterior Contact (note only)", status: "none" },
  { mapKey: "attr:occlusal:anterior",  match: ["Anterior Contact", "Anterior"],   code: null, name: "Anterior Contact (note only)",  status: "none" },
  { mapKey: "attr:occlusal:full",      match: ["FULL Occlusal Contact", "Full"],  code: null, name: "Full Contact (note only)",      status: "none" },
  { mapKey: "attr:occlusal:tripod",    match: ["TRIPOD Occlusion", "Tripod"],     code: null, name: "TRIPOD Contact (note only)",    status: "none" },
  { mapKey: "attr:design:lingual-free",  match: ["Lingual-Free"],  code: null, name: "Lingual-Free Design (note only)", status: "none" },
  { mapKey: "attr:design:buccal-free",   match: ["Buccal-Free"],   code: null, name: "Buccal-Free Design (note only)",  status: "none" },
  { mapKey: "attr:design:standard",      match: ["Standard"],      code: null, name: "Standard (no line item)",         status: "none" },
  { mapKey: "attr:design:full-coverage", match: ["Full Coverage"], code: null, name: "Full Coverage (note only)",       status: "none" },
];
