/**
 * device × material → Seazona product code.
 *
 * `mapKey` is a STABLE SLUG — never derive it from form wording, or re-wording
 * a form option orphans the lab's confirmed override in rx_code_overrides.
 * `match` holds every form literal that resolves to this row (the newer Rx form
 * and the older wizard word some options differently).
 *
 * status: confirmed = lab signed off or unambiguous 1:1 catalog name match
 *         proposed  = strong catalog match, wants lab confirmation
 *         open      = ambiguous/absent; NEVER emits a line item
 */
export const DEVICE_ROWS = [
  // ── Olmos Day (OD) — odMaterial ──────────────────────────────────────────
  { mapKey: "primary:olmos-day:pmt",            device: "olmos-day", match: ["OD (PMT)"],                       code: "2102", name: "OD PMT",               status: "confirmed" },
  { mapKey: "primary:olmos-day:bioflex",        device: "olmos-day", match: ["OD BIOFLEX"],                     code: "2527", name: "OD Bio Flex",          status: "confirmed" },
  { mapKey: "primary:olmos-day:nylon",          device: "olmos-day", match: ["Printed NYLON", "Printed Nylon"], code: "2108", name: "OD Nylon",             status: "confirmed" },
  { mapKey: "primary:olmos-day:acrylic-clasps", device: "olmos-day", match: ["Acrylic w/clasps"],               code: "2103", name: "OD Acrylic W/Clasps",  status: "confirmed" },
  { mapKey: "primary:olmos-day:dual-laminate",  device: "olmos-day", match: ["Dual-Laminate"],                  code: "2105", name: "OD Dual Laminate",     status: "confirmed" },
  { mapKey: "primary:olmos-day:milled",         device: "olmos-day", match: ["Milled (↑ wear)", "Milled"], code: "2106", name: "OD MILLED",            status: "confirmed" },

  // ── Olmos Night — onDesign picks the family; MATERIAL IS NOT CAPTURED.
  // ONT exists only in Nylon, so it alone resolves. OND/ONP/ONR need the
  // base-material question restored (JotForm qid 270) — see Task 12.
  { mapKey: "primary:olmos-night:ont-nylon", device: "olmos-night", match: ["TITRATION (ON-T) - NYLON Only"],           code: "2144", name: "ONT Nylon", status: "confirmed" },
  { mapKey: "primary:olmos-night:ond",       device: "olmos-night", match: ["DEPROGRAMMER (ON-D) - Anterior Occlusion"], code: null,   name: "OND (material not captured)", status: "open" },
  { mapKey: "primary:olmos-night:onp",       device: "olmos-night", match: ["POSITIONER (ON-P) - Anterior Occlusion"],   code: null,   name: "ONP (material not captured)", status: "open" },
  { mapKey: "primary:olmos-night:onr",       device: "olmos-night", match: ["RAMP (ON-R) - Anterior Occlusion"],         code: null,   name: "ONR (material not captured)", status: "open" },

  // ── DDSO — ddsoMaterial. Catalog also has BioFlex (2532); form omits it.
  { mapKey: "primary:ddso:nylon",  device: "ddso", match: ["NYLON", "Nylon"],   code: "2608", name: "DDSO Nylon",  status: "confirmed" },
  { mapKey: "primary:ddso:biomed", device: "ddso", match: ["BIOMED", "Biomed"], code: "2146", name: "DDSO BIOMED", status: "confirmed" },

  // ── Single-product devices ───────────────────────────────────────────────
  { mapKey: "primary:ara:default",       device: "ara",       match: ["default"],               code: "2592", name: "ARA- Nylon", status: "confirmed" },
  { mapKey: "primary:snorehook:default", device: "snorehook", match: ["default", "SnoreHook"],  code: "2154", name: "Snorehook",  status: "confirmed" },

  // ── Sport-Guard — sportGuardDevice tier ──────────────────────────────────
  { mapKey: "primary:sport-guard:trainer", device: "sport-guard", match: ["Trainer - Non-Contact [Md. Arch Only]"],           code: "2173", name: "Sportsguard: Trainer (Md Only)", status: "confirmed" },
  { mapKey: "primary:sport-guard:pro",     device: "sport-guard", match: ["PRO - Light to Heavy Contact [Mx. or Md. Arch]"],  code: "2172", name: "Sportsguard Professional",       status: "confirmed" },
  { mapKey: "primary:sport-guard:cadcam",  device: "sport-guard", match: ["CAD/CAM - Light to Heavy Contact [Mx or Md Arch]"], code: "2174", name: "Sportsguard: CAD/CAM",          status: "confirmed" },

  // ── Material not captured by the form; single most-likely SKU proposed ───
  { mapKey: "primary:shirazi-hybrid:nylon", device: "shirazi-hybrid", match: ["default"], code: "2152", name: "Shirazi Hybrid Nylon", status: "proposed" },
  { mapKey: "primary:cadcam-d-pro:nylon",   device: "cadcam-d-pro",   match: ["default"], code: "2539", name: "Dorsal Pro Nylon",     status: "proposed" },
  { mapKey: "primary:mora:pmt",             device: "mora",           match: ["default"], code: "2593", name: "MORA - PMT",           status: "proposed" },
];
