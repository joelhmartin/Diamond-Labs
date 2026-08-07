/**
 * Occlusal-contact and design-preference selections → $0 Seazona products.
 * These exist in the catalog precisely so design intent lands on the order as
 * structured lines rather than prose in the notes field.
 *
 * `match` holds EVERY form literal that resolves to a row. The consolidated Rx
 * form and the older wizard at /app/cases/new word these differently
 * ("Posterior Contact" vs "Posterior"); the wizard is live and is the only
 * producer that populates rx_cases.deviceKey/deviceOptions, so its wording must
 * resolve here or every wizard order fails the ok gate. Wizard literals come
 * from OCCLUSAL_CONTACT / DESIGN_PREFERENCES in apps/web/src/data/rx-devices.js.
 * (DESIGN_PREFERENCES already matches the new wording exactly.)
 */
export const ATTRIBUTE_ROWS = [
  { mapKey: "attr:occlusal:posterior", match: ["Posterior Contact", "Posterior"],     code: "2293", name: "Posterior Contact",   status: "confirmed" },
  { mapKey: "attr:occlusal:anterior",  match: ["Anterior Contact", "Anterior"],       code: "2289", name: "Anterior Contact",    status: "confirmed" },
  { mapKey: "attr:occlusal:full",      match: ["FULL Occlusal Contact", "Full"],      code: "2292", name: "Full Contact",        status: "confirmed" },
  { mapKey: "attr:occlusal:tripod",    match: ["TRIPOD Occlusion", "Tripod"],         code: "2291", name: "TRIPOD Contact",      status: "confirmed" },
  { mapKey: "attr:design:lingual-free", match: ["Lingual-Free"],         code: "2314", name: "Lingual-Free Design", status: "confirmed" },
  { mapKey: "attr:design:buccal-free",  match: ["Buccal-Free"],          code: "2308", name: "Buccal-Free Design",  status: "confirmed" },

  // "Standard" means no special design; it correctly emits nothing. status
  // "none" (not "open") — this is a deliberate no-op, not an unresolved gap,
  // so it must never surface as an `unmapped` flag (it's the most common
  // design-preference selection; flagging it would be permanent noise).
  { mapKey: "attr:design:standard",      match: ["Standard"],      code: null, name: "Standard (no line item)", status: "none" },
  // Ambiguous against attr:occlusal:full (2292) — lab must disambiguate.
  { mapKey: "attr:design:full-coverage", match: ["Full Coverage"], code: null, name: "Full Coverage",           status: "open", reason: "Ambiguous against 2292 Full Contact — are these the same thing?" },
];
