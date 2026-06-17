/**
 * Maps wizard device + option selections → Seazona product line items (code + name).
 *
 * Codes are resolved to ids by the payload builder against the live catalog.
 * UNMAPPED selections are returned as flags in `unmapped`; we NEVER guess a code.
 *
 * Seed values marked with a real numeric Seazona code have been confirmed by
 * catalog fuzzy-match (Task 3.2); entries marked `// TODO verify` are best-guess
 * placeholders pending lab sign-off (see docs/rx-forms/rx-map-draft.md).
 * The dry-run (Task 8.2) will surface any remaining gaps before any live order.
 *
 * `resolveLineItems` returns:
 *   { items: [{ code, name, arch, source }], unmapped: [string] }
 */

// ---------------------------------------------------------------------------
// DEVICE LABELS
// Human-readable names for each device key — mirrors the frontend wizard labels.
// Used by admin tooling that cannot import the frontend's rx-devices.js.
// ---------------------------------------------------------------------------
export const DEVICE_LABELS = {
  ddso: "DDSO",
  "olmos-day": "Olmos Day (OD)",
  "olmos-night": "Olmos Night (ON)",
  onp: "ONP",
  "cadcam-d-pro": "CAD/CAM D-Pro",
  "shirazi-hybrid": "Shirazi Hybrid",
  snorehook: "SnoreHook",
  guard: "Guard / Nightguard",
  "sport-guard": "Sport-Guard",
  mora: "MORA",
  ara: "ARA",
  "ortho-expander": "Orthodontic Appliance",
  remake: "Remake / Repair",
};

// ---------------------------------------------------------------------------
// DEVICE MAP
// Each entry:
//   arch    — "upper" | "lower" | "both" | null (null = determined by form field)
//   primary — keyed by baseMaterial or variant value; "default" used as fallback
//             for devices with no material/variant selector.
// ---------------------------------------------------------------------------
export const DEVICE_MAP = {
  // ── TMD ─────────────────────────────────────────────────────────────────
  "olmos-day": {
    arch: null,
    primary: {
      "OD (PMT)":          { code: "2102",          name: "Olmos Day OD (PMT)" },
      "OD BIOFLEX":        { code: "OD_BIOFLEX",    name: "Olmos Day OD Bioflex" },          // TODO verify
      "Printed Nylon":     { code: "OD_NYLON",      name: "Olmos Day Printed Nylon" },        // TODO verify
      "Acrylic w/clasps":  { code: "OD_ACRYLIC",    name: "Olmos Day Acrylic w/clasps" },     // TODO verify
      "Dual-Laminate":     { code: "OD_DUAL_LAM",   name: "Olmos Day Dual-Laminate" },        // TODO verify
      "Milled":            { code: "OD_MILLED",     name: "Olmos Day Milled" },               // TODO verify
    },
  },
  "olmos-night": {
    arch: null,
    primary: {
      "Deprogrammer ON-D (Anterior)":    { code: "ON_DEPROG",   name: "Olmos Night ON-D Deprogrammer" },        // TODO verify
      "Positioner ON-P (Anterior)":      { code: "ON_POS",      name: "Olmos Night ON-P Positioner" },          // TODO verify
      "Titration ON-T (Nylon only)":     { code: "ON_TITRATE",  name: "Olmos Night ON-T Titration (Nylon)" },   // TODO verify
      "Ramp ON-R (Anterior)":            { code: "ON_RAMP",     name: "Olmos Night ON-R Ramp" },                // TODO verify
    },
  },
  "onp": {
    arch: null,
    primary: {
      "Deprogrammer ON-D (Anterior)":    { code: "ONP_DEPROG",  name: "ONP Deprogrammer" },        // TODO verify
      "Positioner ON-P (Anterior)":      { code: "ONP_POS",     name: "ONP Positioner" },           // TODO verify
      "Titration ON-T (Nylon only)":     { code: "ONP_TITRATE", name: "ONP Titration (Nylon)" },    // TODO verify
      "Ramp ON-R (Anterior)":            { code: "ONP_RAMP",    name: "ONP Ramp" },                 // TODO verify
    },
  },
  "mora": {
    arch: null,
    primary: {
      default: { code: "MORA", name: "MORA — Mandibular Orthopedic Repositioning Appliance" },      // TODO verify
    },
  },
  "ara": {
    arch: null,
    primary: {
      default: { code: "ARA", name: "ARA — Anterior Repositioning Appliance" },                     // TODO verify
    },
  },

  // ── SLEEP ────────────────────────────────────────────────────────────────
  "ddso": {
    arch: null,
    primary: {
      "Nylon":  { code: "2147", name: "DDSO Nylon" },
      "Biomed": { code: "2146", name: "DDSO Biomed" },
    },
  },
  "cadcam-d-pro": {
    arch: null,
    primary: {
      default: { code: "CADCAM_D_PRO", name: "CAD/CAM D-Pro" },    // TODO verify
    },
  },
  "shirazi-hybrid": {
    arch: null,
    primary: {
      default: { code: "SHIRAZI_HYBRID", name: "Shirazi Hybrid — CPAP Pro" },    // TODO verify
    },
  },
  "snorehook": {
    arch: null,
    primary: {
      "SnoreHook":                 { code: "2154",              name: "SnoreHook" },
      "SomnoDent Classic":         { code: "SOMNODENT_CLASSIC", name: "SomnoDent Classic" },          // TODO verify
      "SomnoDent Flex":            { code: "SOMNODENT_FLEX",    name: "SomnoDent Flex" },             // TODO verify
      "SomnoDent Herbst Advance":  { code: "SOMNODENT_HERBST",  name: "SomnoDent Herbst Advance" },   // TODO verify
    },
  },

  // ── GUARDS ───────────────────────────────────────────────────────────────
  "guard": {
    arch: null,  // arch comes from deviceOptions.arch at runtime
    primary: {
      "Hard Nightguard":               { code: "GUARD_HARD",     name: "Hard Nightguard" },               // TODO verify
      "Soft Nightguard":               { code: "GUARD_SOFT",     name: "Soft Nightguard" },               // TODO verify
      "Dual-Laminate Nightguard":      { code: "2167",           name: "Dual-Laminate Nightguard" },
      "Essix retainer (tray)":         { code: "ESSIX",          name: "Essix Retainer (Tray)" },         // TODO verify
      "Whitening tray":                { code: "WHITE_TRAY",     name: "Whitening Tray" },                // TODO verify
      "Sports mouthguard (standard)":  { code: "SPORT_STD",      name: "Sports Mouthguard (Standard)" },  // TODO verify
    },
  },

  // ── SPORT ────────────────────────────────────────────────────────────────
  "sport-guard": {
    arch: null,
    primary: {
      default: { code: "SPORT_GUARD_CUSTOM", name: "Diamond Orthotic Sport-Guard (Custom)" },    // TODO verify
    },
  },

  // ── ORTHO ────────────────────────────────────────────────────────────────
  "ortho-expander": {
    arch: null,
    primary: {
      default: { code: "ORTHO_EXPANDER", name: "Orthodontic Appliance (Expander / Tandem / Twin Block)" },    // TODO verify
    },
  },

  // ── REMAKE ───────────────────────────────────────────────────────────────
  "remake": {
    arch: null,
    primary: {
      default: { code: "REMAKE", name: "Remake / Repair / Redesign" },    // TODO verify
    },
  },
};

// ---------------------------------------------------------------------------
// MODIFICATION MAP
// Keyed by the exact string value from the wizard checkbox.
// Seed values are best-guess placeholders — Task 3.2 confirms real codes.
// ---------------------------------------------------------------------------
export const MODIFICATION_MAP = {
  // ── Common modifications (shared across OD, CAD/CAM, SPIR, Guard) ───────
  "Anterior ramp":                  { code: "MOD_ANT_RAMP",      name: "Anterior Ramp" },                     // TODO verify
  "Posterior pads":                 { code: "MOD_POST_PADS",     name: "Posterior Pads" },                    // TODO verify
  "Labial bow":                     { code: "2184",              name: "Labial Bow" },
  "Relief over bony prominences":   { code: "MOD_BONY_RELIEF",   name: "Relief over Bony Prominences" },      // TODO verify
  "Soft liner":                     { code: "MOD_SOFT_LINER",    name: "Soft Liner" },                        // TODO verify
  "Lingual bar":                    { code: "MOD_LINGUAL_BAR",   name: "Lingual Bar" },                       // TODO verify

  // ── Shirazi Hybrid extras ────────────────────────────────────────────────
  "Opposing Trutaine only":         { code: "MOD_TRUTAINE",      name: "Opposing Trutaine Only" },            // TODO verify
  "CPAP-Pro coupler":               { code: "MOD_CPAP_COUPLER",  name: "CPAP-Pro Coupler" },                  // TODO verify

  // ── Olmos Night extras ───────────────────────────────────────────────────
  "Anterior ring (positioner)":     { code: "MOD_ANT_RING",      name: "Anterior Ring (Positioner)" },        // TODO verify
  "Tongue space":                   { code: "MOD_TONGUE_SPACE",  name: "Tongue Space" },                      // TODO verify
  "Lingual ramp":                   { code: "MOD_LINGUAL_RAMP",  name: "Lingual Ramp" },                      // TODO verify
  "Occlusal pad":                   { code: "MOD_OCC_PAD",       name: "Occlusal Pad" },                      // TODO verify

  // ── Guard-specific modifications ─────────────────────────────────────────
  "Trim to gumline":                { code: "MOD_TRIM_GUM",      name: "Trim to Gumline" },                   // TODO verify
  "Trim to occlusal plane":         { code: "MOD_TRIM_OCC",      name: "Trim to Occlusal Plane" },            // TODO verify

  // ── Ortho modifications ──────────────────────────────────────────────────
  "Buccal tubes to bands":               { code: "2307",                  name: "Buccal Tubes to Bands" },
  "Palatal pads":                        { code: "MOD_PALATAL_PADS",      name: "Palatal Pads" },                          // TODO verify
  "Anterior lap springs":                { code: "MOD_ANT_LAP_SPRINGS",   name: "Anterior Lap Springs" },                  // TODO verify
  "Buccal hooks for tandem elastics":    { code: "MOD_BUCCAL_HOOKS",      name: "Buccal Hooks for Tandem Elastics" },      // TODO verify
  "Lingual guide arm to canines":        { code: "MOD_LINGUAL_ARM_CAN",   name: "Lingual Guide Arm to Canines" },          // TODO verify
  "Lingual guide arm (distal)":          { code: "MOD_LINGUAL_ARM_DIST",  name: "Lingual Guide Arm (Distal)" },            // TODO verify
  "Transfer tray for composite buttons": { code: "MOD_TRANSFER_TRAY",     name: "Transfer Tray for Composite Buttons" },   // TODO verify
  "Occlusal Rest(s)":                    { code: "MOD_OCC_RESTS",         name: "Occlusal Rest(s)" },                      // TODO verify
  "Finger Springs":                      { code: "MOD_FINGER_SPRINGS",    name: "Finger Springs" },                        // TODO verify
  "Sheaths for Tandem Bow":              { code: "MOD_TANDEM_SHEATHS",    name: "Sheaths for Tandem Bow" },                // TODO verify
  "Other":                               { code: "MOD_OTHER",             name: "Other Modification (see notes)" },        // TODO verify
};

// ---------------------------------------------------------------------------
// LAB SERVICE CODES
// Ancillary line items added by the payload builder based on submission type.
// ---------------------------------------------------------------------------
export const LAB_SERVICE_CODES = {
  modelFabPerArch: { code: "2367", name: "Digital Model Fabrication (Per Arch)" },
  articulate:      { code: "2368", name: "Articulate Models (Per Arch)" },
};

// ---------------------------------------------------------------------------
// resolveLineItems
// ---------------------------------------------------------------------------
/**
 * Resolves a wizard selection to Seazona line items.
 *
 * @param {object} params
 * @param {string} params.deviceKey      — wizard device key (e.g. "ddso")
 * @param {object} [params.deviceOptions] — form field values for the device sub-panel
 * @param {object} [opts]
 * @param {object} [opts.overrides]      — mapKey → {code, name}; DB override wins over file-map default
 * @returns {{ items: Array<{code:string,name:string,arch:string|null,source:string,mapKey:string}>, unmapped: string[] }}
 */
export function resolveLineItems({ deviceKey, deviceOptions = {} } = {}, { overrides = {} } = {}) {
  const items = [];
  const unmapped = [];

  const dev = DEVICE_MAP[deviceKey];
  if (!dev) {
    unmapped.push(`device:${deviceKey}`);
    return { items, unmapped };
  }

  // Primary line item: keyed by baseMaterial, variant, or "default" fallback.
  const material = deviceOptions.baseMaterial || deviceOptions.variant;
  const mapKey = `primary:${deviceKey}:${material || "default"}`;
  const chosen = overrides[mapKey] || (material && dev.primary?.[material]) || dev.primary?.default;

  if (chosen) {
    items.push({
      code: chosen.code,
      name: chosen.name,
      arch: dev.arch ?? deviceOptions.arch ?? null,
      source: "primary",
      mapKey,
    });
  } else {
    // Flag with the SAME mapKey used for resolution so the override layer can key
    // on the unmapped entry directly (no "?"→"default" translation needed).
    unmapped.push(mapKey);
  }

  // Modification line items — never guess, always flag if unknown.
  for (const mod of deviceOptions.modifications || []) {
    const modKey = `mod:${mod}`;
    const m = overrides[modKey] || MODIFICATION_MAP[mod];
    if (m) {
      items.push({ code: m.code, name: m.name, arch: null, source: `mod:${mod}`, mapKey: modKey });
    } else {
      unmapped.push(`mod:${mod}`);
    }
  }

  return { items, unmapped };
}
