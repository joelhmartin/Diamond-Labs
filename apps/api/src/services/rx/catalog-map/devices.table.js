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

  // ── Olmos Night — onDesign × onMaterial (JotForm qid 197 × 270). One SKU per
  // pair; confirmed against 1,400+ JotForm prescriptions matched to the orders
  // the lab built from them (2025–26). ONT exists only in Nylon, so it needs
  // no material. A design with no material answered stays open (held).
  { mapKey: "primary:olmos-night:ont-nylon", device: "olmos-night", match: ["TITRATION (ON-T) - NYLON Only", "Titration ON-T (Nylon only)"], code: "2144", name: "ONT Nylon", status: "confirmed" },
  { mapKey: "primary:olmos-night:ond-nylon", device: "olmos-night", match: ["DEPROGRAMMER (ON-D) - Anterior Occlusion", "Deprogrammer ON-D (Anterior)"], material: ["NYLON", "Nylon"], code: "2119", name: "OND Nylon", status: "confirmed" },
  { mapKey: "primary:olmos-night:ond-pmt", device: "olmos-night", match: ["DEPROGRAMMER (ON-D) - Anterior Occlusion", "Deprogrammer ON-D (Anterior)"], material: ["PMT (Diamoform)", "PMT"], code: "2114", name: "OND PMT", status: "confirmed" },
  { mapKey: "primary:olmos-night:ond-biomed", device: "olmos-night", match: ["DEPROGRAMMER (ON-D) - Anterior Occlusion", "Deprogrammer ON-D (Anterior)"], material: ["BIOMED", "Biomed"], code: "2118", name: "OND Biomed", status: "confirmed" },
  { mapKey: "primary:olmos-night:ond-dual-laminate", device: "olmos-night", match: ["DEPROGRAMMER (ON-D) - Anterior Occlusion", "Deprogrammer ON-D (Anterior)"], material: ["DUAL-LAMINATE", "Dual-Laminate"], code: "2117", name: "OND Dual Laminate", status: "confirmed" },
  { mapKey: "primary:olmos-night:ond-acrylic-clasps", device: "olmos-night", match: ["DEPROGRAMMER (ON-D) - Anterior Occlusion", "Deprogrammer ON-D (Anterior)"], material: ["ACRYLIC W/CLASPS", "Acrylic w/clasps"], code: "2115", name: "OND Acrylic W/Clasps", status: "confirmed" },
  { mapKey: "primary:olmos-night:onp-nylon", device: "olmos-night", match: ["POSITIONER (ON-P) - Anterior Occlusion", "Positioner ON-P (Anterior)"], material: ["NYLON", "Nylon"], code: "2130", name: "ONP Nylon", status: "confirmed" },
  { mapKey: "primary:olmos-night:onp-pmt", device: "olmos-night", match: ["POSITIONER (ON-P) - Anterior Occlusion", "Positioner ON-P (Anterior)"], material: ["PMT (Diamoform)", "PMT"], code: "2125", name: "ONP PMT", status: "confirmed" },
  { mapKey: "primary:olmos-night:onp-biomed", device: "olmos-night", match: ["POSITIONER (ON-P) - Anterior Occlusion", "Positioner ON-P (Anterior)"], material: ["BIOMED", "Biomed"], code: "2129", name: "ONP Biomed", status: "confirmed" },
  { mapKey: "primary:olmos-night:onp-dual-laminate", device: "olmos-night", match: ["POSITIONER (ON-P) - Anterior Occlusion", "Positioner ON-P (Anterior)"], material: ["DUAL-LAMINATE", "Dual-Laminate"], code: "2128", name: "ONP Dual Laminate", status: "confirmed" },
  { mapKey: "primary:olmos-night:onp-acrylic-clasps", device: "olmos-night", match: ["POSITIONER (ON-P) - Anterior Occlusion", "Positioner ON-P (Anterior)"], material: ["ACRYLIC W/CLASPS", "Acrylic w/clasps"], code: "2126", name: "ONP Acrylic W/Clasps", status: "confirmed" },
  { mapKey: "primary:olmos-night:onr-nylon", device: "olmos-night", match: ["RAMP (ON-R) - Anterior Occlusion", "Ramp ON-R (Anterior)"], material: ["NYLON", "Nylon"], code: "2142", name: "ONR Nylon", status: "confirmed" },
  { mapKey: "primary:olmos-night:onr-pmt", device: "olmos-night", match: ["RAMP (ON-R) - Anterior Occlusion", "Ramp ON-R (Anterior)"], material: ["PMT (Diamoform)", "PMT"], code: "2137", name: "ONR PMT", status: "confirmed" },
  { mapKey: "primary:olmos-night:onr-biomed", device: "olmos-night", match: ["RAMP (ON-R) - Anterior Occlusion", "Ramp ON-R (Anterior)"], material: ["BIOMED", "Biomed"], code: "2141", name: "ONR Biomed", status: "confirmed" },
  { mapKey: "primary:olmos-night:onr-dual-laminate", device: "olmos-night", match: ["RAMP (ON-R) - Anterior Occlusion", "Ramp ON-R (Anterior)"], material: ["DUAL-LAMINATE", "Dual-Laminate"], code: "2140", name: "ONR Dual Laminate", status: "confirmed" },
  { mapKey: "primary:olmos-night:onr-acrylic-clasps", device: "olmos-night", match: ["RAMP (ON-R) - Anterior Occlusion", "Ramp ON-R (Anterior)"], material: ["ACRYLIC W/CLASPS", "Acrylic w/clasps"], code: "2138", name: "ONR Acrylic W/Clasps", status: "confirmed" },
  { mapKey: "primary:olmos-night:ond", device: "olmos-night", match: ["DEPROGRAMMER (ON-D) - Anterior Occlusion", "Deprogrammer ON-D (Anterior)"], code: null, name: "OND (no material)", status: "open", reason: "No base material answered. Each Night design is a different product per material." },
  { mapKey: "primary:olmos-night:onp", device: "olmos-night", match: ["POSITIONER (ON-P) - Anterior Occlusion", "Positioner ON-P (Anterior)"], code: null, name: "ONP (no material)", status: "open", reason: "No base material answered. Each Night design is a different product per material." },
  { mapKey: "primary:olmos-night:onr", device: "olmos-night", match: ["RAMP (ON-R) - Anterior Occlusion", "Ramp ON-R (Anterior)"], code: null, name: "ONR (no material)", status: "open", reason: "No base material answered. Each Night design is a different product per material." },

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

  // ── Material not captured by the form ───────────────────────────────────
  // Shirazi: 2152 on 98% of real Shirazi orders (n=55) — the only Shirazi SKU billed.
  { mapKey: "primary:shirazi-hybrid:nylon", device: "shirazi-hybrid", match: ["default"], code: "2152", name: "Shirazi Hybrid Nylon", status: "confirmed" },
  { mapKey: "primary:cadcam-d-pro:nylon",   device: "cadcam-d-pro",   match: ["D-Pro", "default"], code: "2539", name: "Dorsal Pro Nylon", status: "confirmed" },
  { mapKey: "primary:cadcam-d-pro:manta",   device: "cadcam-d-pro",   match: ["Manta"],            code: "2149", name: "Manta Nylon",      status: "confirmed" },
  // MORA stays proposed: in 3,600 real orders MORA - PMT (2593) was billed once
  // and MORA - ClearSplint (2594) once, and the form captures no material.
  { mapKey: "primary:mora:pmt",             device: "mora",           match: ["default"], code: "2593", name: "MORA - PMT",           status: "proposed" },
];
