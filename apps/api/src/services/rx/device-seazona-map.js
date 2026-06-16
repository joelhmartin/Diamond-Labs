/**
 * Maps wizard device + option selections → Seazona product line items (code + name).
 *
 * Codes are resolved to ids by the payload builder against the live catalog.
 * UNMAPPED selections are returned as flags in `unmapped`; we NEVER guess a code.
 *
 * Seed values are best-guess placeholders — Task 3.2 fills real codes;
 * the dry-run coverage report verifies accuracy before any live order is placed.
 *
 * `resolveLineItems` returns:
 *   { items: [{ code, name, arch, source }], unmapped: [string] }
 */

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
      "OD (PMT)":          { code: "OD_PMT",          name: "Olmos Day OD (PMT)" },
      "OD BIOFLEX":        { code: "OD_BIOFLEX",       name: "Olmos Day OD Bioflex" },
      "Printed Nylon":     { code: "OD_NYLON",         name: "Olmos Day Printed Nylon" },
      "Acrylic w/clasps":  { code: "OD_ACRYLIC",       name: "Olmos Day Acrylic w/clasps" },
      "Dual-Laminate":     { code: "OD_DUAL_LAM",      name: "Olmos Day Dual-Laminate" },
      "Milled":            { code: "OD_MILLED",        name: "Olmos Day Milled" },
    },
  },
  "olmos-night": {
    arch: null,
    primary: {
      "Deprogrammer ON-D (Anterior)":    { code: "ON_DEPROG",   name: "Olmos Night ON-D Deprogrammer" },
      "Positioner ON-P (Anterior)":      { code: "ON_POS",      name: "Olmos Night ON-P Positioner" },
      "Titration ON-T (Nylon only)":     { code: "ON_TITRATE",  name: "Olmos Night ON-T Titration (Nylon)" },
      "Ramp ON-R (Anterior)":            { code: "ON_RAMP",     name: "Olmos Night ON-R Ramp" },
    },
  },
  "onp": {
    arch: null,
    primary: {
      "Deprogrammer ON-D (Anterior)":    { code: "ONP_DEPROG",  name: "ONP Deprogrammer" },
      "Positioner ON-P (Anterior)":      { code: "ONP_POS",     name: "ONP Positioner" },
      "Titration ON-T (Nylon only)":     { code: "ONP_TITRATE", name: "ONP Titration (Nylon)" },
      "Ramp ON-R (Anterior)":            { code: "ONP_RAMP",    name: "ONP Ramp" },
    },
  },
  "mora": {
    arch: null,
    primary: {
      default: { code: "MORA", name: "MORA — Mandibular Orthopedic Repositioning Appliance" },
    },
  },
  "ara": {
    arch: null,
    primary: {
      default: { code: "ARA", name: "ARA — Anterior Repositioning Appliance" },
    },
  },

  // ── SLEEP ────────────────────────────────────────────────────────────────
  "ddso": {
    arch: null,
    primary: {
      "Nylon":  { code: "DDSO_NYLON",  name: "DDSO Nylon" },
      "Biomed": { code: "DDSO_BIOMED", name: "DDSO Biomed" },
    },
  },
  "cadcam-d-pro": {
    arch: null,
    primary: {
      default: { code: "CADCAM_D_PRO", name: "CAD/CAM D-Pro" },
    },
  },
  "shirazi-hybrid": {
    arch: null,
    primary: {
      default: { code: "SHIRAZI_HYBRID", name: "Shirazi Hybrid — CPAP Pro" },
    },
  },
  "snorehook": {
    arch: null,
    primary: {
      "SnoreHook":                 { code: "SNOREHOOK",          name: "SnoreHook" },
      "SomnoDent Classic":         { code: "SOMNODENT_CLASSIC",  name: "SomnoDent Classic" },
      "SomnoDent Flex":            { code: "SOMNODENT_FLEX",     name: "SomnoDent Flex" },
      "SomnoDent Herbst Advance":  { code: "SOMNODENT_HERBST",   name: "SomnoDent Herbst Advance" },
    },
  },

  // ── GUARDS ───────────────────────────────────────────────────────────────
  "guard": {
    arch: null,  // arch comes from deviceOptions.arch at runtime
    primary: {
      "Hard Nightguard":               { code: "GUARD_HARD",      name: "Hard Nightguard" },
      "Soft Nightguard":               { code: "GUARD_SOFT",      name: "Soft Nightguard" },
      "Dual-Laminate Nightguard":      { code: "GUARD_DUAL_LAM",  name: "Dual-Laminate Nightguard" },
      "Essix retainer (tray)":         { code: "ESSIX",           name: "Essix Retainer (Tray)" },
      "Whitening tray":                { code: "WHITE_TRAY",      name: "Whitening Tray" },
      "Sports mouthguard (standard)":  { code: "SPORT_STD",       name: "Sports Mouthguard (Standard)" },
    },
  },

  // ── SPORT ────────────────────────────────────────────────────────────────
  "sport-guard": {
    arch: null,
    primary: {
      default: { code: "SPORT_GUARD_CUSTOM", name: "Diamond Orthotic Sport-Guard (Custom)" },
    },
  },

  // ── ORTHO ────────────────────────────────────────────────────────────────
  "ortho-expander": {
    arch: null,
    primary: {
      default: { code: "ORTHO_EXPANDER", name: "Orthodontic Appliance (Expander / Tandem / Twin Block)" },
    },
  },

  // ── REMAKE ───────────────────────────────────────────────────────────────
  "remake": {
    arch: null,
    primary: {
      default: { code: "REMAKE", name: "Remake / Repair / Redesign" },
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
  "Anterior ramp":                  { code: "MOD_ANT_RAMP",      name: "Anterior Ramp" },
  "Posterior pads":                 { code: "MOD_POST_PADS",     name: "Posterior Pads" },
  "Labial bow":                     { code: "MOD_LABIAL_BOW",    name: "Labial Bow" },
  "Relief over bony prominences":   { code: "MOD_BONY_RELIEF",   name: "Relief over Bony Prominences" },
  "Soft liner":                     { code: "MOD_SOFT_LINER",    name: "Soft Liner" },
  "Lingual bar":                    { code: "MOD_LINGUAL_BAR",   name: "Lingual Bar" },

  // ── Shirazi Hybrid extras ────────────────────────────────────────────────
  "Opposing Trutaine only":         { code: "MOD_TRUTAINE",      name: "Opposing Trutaine Only" },
  "CPAP-Pro coupler":               { code: "MOD_CPAP_COUPLER",  name: "CPAP-Pro Coupler" },

  // ── Olmos Night extras ───────────────────────────────────────────────────
  "Anterior ring (positioner)":     { code: "MOD_ANT_RING",      name: "Anterior Ring (Positioner)" },
  "Tongue space":                   { code: "MOD_TONGUE_SPACE",  name: "Tongue Space" },
  "Lingual ramp":                   { code: "MOD_LINGUAL_RAMP",  name: "Lingual Ramp" },
  "Occlusal pad":                   { code: "MOD_OCC_PAD",       name: "Occlusal Pad" },

  // ── Guard-specific modifications ─────────────────────────────────────────
  "Trim to gumline":                { code: "MOD_TRIM_GUM",      name: "Trim to Gumline" },
  "Trim to occlusal plane":         { code: "MOD_TRIM_OCC",      name: "Trim to Occlusal Plane" },

  // ── Ortho modifications ──────────────────────────────────────────────────
  "Buccal tubes to bands":               { code: "MOD_BUCCAL_TUBES",     name: "Buccal Tubes to Bands" },
  "Palatal pads":                        { code: "MOD_PALATAL_PADS",     name: "Palatal Pads" },
  "Anterior lap springs":                { code: "MOD_ANT_LAP_SPRINGS",  name: "Anterior Lap Springs" },
  "Buccal hooks for tandem elastics":    { code: "MOD_BUCCAL_HOOKS",     name: "Buccal Hooks for Tandem Elastics" },
  "Lingual guide arm to canines":        { code: "MOD_LINGUAL_ARM_CAN",  name: "Lingual Guide Arm to Canines" },
  "Lingual guide arm (distal)":          { code: "MOD_LINGUAL_ARM_DIST", name: "Lingual Guide Arm (Distal)" },
  "Transfer tray for composite buttons": { code: "MOD_TRANSFER_TRAY",    name: "Transfer Tray for Composite Buttons" },
  "Occlusal Rest(s)":                    { code: "MOD_OCC_RESTS",        name: "Occlusal Rest(s)" },
  "Finger Springs":                      { code: "MOD_FINGER_SPRINGS",   name: "Finger Springs" },
  "Sheaths for Tandem Bow":              { code: "MOD_TANDEM_SHEATHS",   name: "Sheaths for Tandem Bow" },
  "Other":                               { code: "MOD_OTHER",            name: "Other Modification (see notes)" },
};

// ---------------------------------------------------------------------------
// LAB SERVICE CODES
// Ancillary line items added by the payload builder based on submission type.
// ---------------------------------------------------------------------------
export const LAB_SERVICE_CODES = {
  modelFabPerArch: { code: "MODEL_FAB",  name: "Digital Model Fabrication (Per Arch)" },
  articulate:      { code: "ARTICULATE", name: "Articulate Models (Per Arch)" },
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
 * @returns {{ items: Array<{code:string,name:string,arch:string|null,source:string}>, unmapped: string[] }}
 */
export function resolveLineItems({ deviceKey, deviceOptions = {} }) {
  const items = [];
  const unmapped = [];

  const dev = DEVICE_MAP[deviceKey];
  if (!dev) {
    unmapped.push(`device:${deviceKey}`);
    return { items, unmapped };
  }

  // Primary line item: keyed by baseMaterial, variant, or "default" fallback.
  const material = deviceOptions.baseMaterial || deviceOptions.variant;
  const primary = (material && dev.primary?.[material]) || dev.primary?.default;

  if (primary) {
    items.push({
      code: primary.code,
      name: primary.name,
      arch: dev.arch ?? null,
      source: "primary",
    });
  } else {
    unmapped.push(`primary:${deviceKey}:${material || "?"}`);
  }

  // Modification line items — never guess, always flag if unknown.
  for (const mod of deviceOptions.modifications || []) {
    const m = MODIFICATION_MAP[mod];
    if (m) {
      items.push({ code: m.code, name: m.name, arch: null, source: `mod:${mod}` });
    } else {
      unmapped.push(`modifications:${mod}`);
    }
  }

  return { items, unmapped };
}
