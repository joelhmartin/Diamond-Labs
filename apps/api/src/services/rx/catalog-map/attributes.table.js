/**
 * Occlusal-contact and design-preference selections → $0 Seazona products.
 * These exist in the catalog precisely so design intent lands on the order as
 * structured lines rather than prose in the notes field.
 */
export const ATTRIBUTE_ROWS = [
  { mapKey: "attr:occlusal:posterior", match: ["Posterior Contact"],     code: "2293", name: "Posterior Contact",   status: "confirmed" },
  { mapKey: "attr:occlusal:anterior",  match: ["Anterior Contact"],      code: "2289", name: "Anterior Contact",    status: "confirmed" },
  { mapKey: "attr:occlusal:full",      match: ["FULL Occlusal Contact"], code: "2292", name: "Full Contact",        status: "confirmed" },
  { mapKey: "attr:occlusal:tripod",    match: ["TRIPOD Occlusion"],      code: "2291", name: "TRIPOD Contact",      status: "confirmed" },
  { mapKey: "attr:design:lingual-free", match: ["Lingual-Free"],         code: "2314", name: "Lingual-Free Design", status: "confirmed" },
  { mapKey: "attr:design:buccal-free",  match: ["Buccal-Free"],          code: "2308", name: "Buccal-Free Design",  status: "confirmed" },

  // "Standard" means no special design; it correctly emits nothing.
  { mapKey: "attr:design:standard",      match: ["Standard"],      code: null, name: "Standard (no line item)", status: "open" },
  // Ambiguous against attr:occlusal:full (2292) — lab must disambiguate.
  { mapKey: "attr:design:full-coverage", match: ["Full Coverage"], code: null, name: "Full Coverage",           status: "open" },
];
