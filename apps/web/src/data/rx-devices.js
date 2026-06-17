/**
 * Rx device catalog — used by the Digital Rx wizard (CaseSubmission page).
 *
 * Each device describes:
 *   - key          : unique id used everywhere in the form
 *   - name         : short display name
 *   - fullName     : long display name
 *   - category     : "tmd" | "sleep" | "guard" | "sport" | "remake"
 *   - tagline      : one-line summary shown on the card
 *   - image        : /images/<asset>.webp
 *   - options      : schema describing the device-specific sub-panel
 *
 * `options` is the rough port of the legacy JotForm's 67 conditional rules.
 * Instead of spraying show/hide rules across the form, each device declares
 * its own option matrix up-front: occlusal contact, design preference,
 * materials, modifications, vertical-titration placement, etc. The renderer
 * walks this schema to build the correct sub-form for the selected device.
 *
 * Field shapes:
 *   { type: "radio",    label, required?, options: [string | {value,label}] }
 *   { type: "checkbox", label, required?, options: [...] }
 *   { type: "select",   label, required?, options: [...] }
 *   { type: "text",     label, required?, placeholder?, unit? }
 *   { type: "textarea", label, required?, placeholder? }
 *   { type: "matrix",   label, rows: [...], columns: [...] }
 *
 * A field may also carry `showIf: { key: "...", equals: "..." | prefix: "..." }`
 * for inline conditional visibility (e.g. "show tripod-only titration options
 * when occlusal contact = Tripod").
 */

const OCCLUSAL_CONTACT = ["Posterior", "Anterior", "Full", "Tripod"];
const DESIGN_PREFERENCES = ["Standard", "Lingual-Free", "Buccal-Free", "Full Coverage"];
const COMMON_MODIFICATIONS = [
  "Anterior ramp",
  "Posterior pads",
  "Labial bow",
  "Relief over bony prominences",
  "Soft liner",
  "Lingual bar",
];
const TRIPOD_TITRATION_SITES = [
  "Right posterior",
  "Left posterior",
  "Anterior",
  "Anterior & posterior",
];

/* ─── OLMOS SERIES — TMD ─── */
const OLMOS_DAY_OPTIONS = {
  baseMaterial: {
    type: "radio",
    label: "(OD) Olmos Day — Base material",
    required: true,
    options: ["OD (PMT)", "OD BIOFLEX", "Printed Nylon", "Acrylic w/clasps", "Dual-Laminate", "Milled"],
  },
  occlusalContact: {
    type: "radio",
    label: "Occlusal contact",
    required: true,
    options: OCCLUSAL_CONTACT,
  },
  designPreference: {
    type: "select",
    label: "Design preference",
    options: DESIGN_PREFERENCES,
  },
  tripodTitration: {
    type: "checkbox",
    label: "Place vertical titration on (Tripod only)",
    showIf: { key: "occlusalContact", equals: "Tripod" },
    options: TRIPOD_TITRATION_SITES,
  },
  modifications: {
    type: "checkbox",
    label: "Select modifications",
    options: COMMON_MODIFICATIONS,
  },
  vdoMatrix: {
    type: "matrix",
    label: "Vertical Dimensions / Articulation changes (Daytime)",
    rows: ["Vertical (mm)", "Protrusion (mm)", "Lateral right (mm)", "Lateral left (mm)"],
    columns: ["Current", "Requested"],
  },
  comments: {
    type: "textarea",
    label: "OD Device — Additional comments / instructions",
    placeholder: "Instructions specific to the Day device only…",
  },
};

const OLMOS_NIGHT_OPTIONS = {
  variant: {
    type: "radio",
    label: "(ON) Olmos Night — Please select one design",
    required: true,
    options: [
      "Deprogrammer ON-D (Anterior)",
      "Positioner ON-P (Anterior)",
      "Titration ON-T (Nylon only)",
      "Ramp ON-R (Anterior)",
    ],
  },
  modifications: {
    type: "checkbox",
    label: "ON specifications",
    options: [
      "Anterior ring (positioner)",
      "Tongue space",
      "Lingual ramp",
      "Occlusal pad",
      "Soft liner",
    ],
  },
  vdoMatrix: {
    type: "matrix",
    label: "Vertical Dimensions / Articulation changes (Night)",
    rows: ["Vertical (mm)", "Protrusion (mm)"],
    columns: ["Current", "Requested"],
  },
  comments: {
    type: "textarea",
    label: "ON Device — Additional comments / instructions",
    placeholder: "Instructions specific to the Night device only…",
  },
};

/* ─── SLEEP ─── */
const DDSO_OPTIONS = {
  design: {
    type: "radio",
    label: "DDSO design",
    required: true,
    options: ["Anterior contact", "Posterior full-arch"],
  },
  baseMaterial: {
    type: "radio",
    label: "Base material for DDSO",
    required: true,
    options: ["Nylon", "Biomed"],
  },
  occlusalContact: {
    type: "radio",
    label: "Occlusal contact",
    required: true,
    options: OCCLUSAL_CONTACT,
  },
  designPreference: {
    type: "select",
    label: "Design preference",
    options: DESIGN_PREFERENCES,
  },
  tripodTitration: {
    type: "checkbox",
    label: "Place vertical titration on (Tripod only)",
    showIf: { key: "occlusalContact", equals: "Tripod" },
    options: TRIPOD_TITRATION_SITES,
  },
  titration: {
    type: "matrix",
    label: "Additional titration (bands)",
    rows: ["Wide (Rigid)", "Blue (Medium)", "Orange (Soft)"],
    columns: ["17", "18", "19", "20", "21", "Qty"],
  },
  vdoMatrix: {
    type: "matrix",
    label: "Vertical Dimensions / Articulation — DDSO",
    rows: ["Vertical (mm)", "Protrusion (mm)"],
    columns: ["Current", "Requested"],
  },
  comments: {
    type: "textarea",
    label: "DDSO — Additional comments / instructions",
    placeholder: "Instructions specific to the DDSO device only…",
  },
};

const CAD_CAM_D_PRO_OPTIONS = {
  occlusalContact: {
    type: "radio",
    label: "Occlusal contact",
    required: true,
    options: OCCLUSAL_CONTACT,
  },
  designPreference: {
    type: "select",
    label: "Design preference",
    options: DESIGN_PREFERENCES,
  },
  modifications: {
    type: "checkbox",
    label: "Modifications",
    options: COMMON_MODIFICATIONS,
  },
  tripodTitration: {
    type: "checkbox",
    label: "Place vertical titration on (Tripod only)",
    showIf: { key: "occlusalContact", equals: "Tripod" },
    options: TRIPOD_TITRATION_SITES,
  },
  vdoMatrix: {
    type: "matrix",
    label: "Vertical Dimensions / Articulation",
    rows: ["Vertical (mm)", "Protrusion (mm)"],
    columns: ["Current", "Requested"],
  },
  comments: {
    type: "textarea",
    label: "CAD/CAM D-Pro — Additional comments",
  },
};

const SHIRAZI_HYBRID_OPTIONS = {
  occlusalContact: {
    type: "radio",
    label: "Occlusal contact",
    required: true,
    options: OCCLUSAL_CONTACT,
  },
  designPreference: {
    type: "select",
    label: "Design preference",
    options: DESIGN_PREFERENCES,
  },
  modifications: {
    type: "checkbox",
    label: "Modifications",
    options: [
      ...COMMON_MODIFICATIONS,
      "Opposing Trutaine only",
      "CPAP-Pro coupler",
    ],
  },
  tripodTitration: {
    type: "checkbox",
    label: "Place vertical titration on (Tripod only)",
    showIf: { key: "occlusalContact", equals: "Tripod" },
    options: TRIPOD_TITRATION_SITES,
  },
  vdoMatrix: {
    type: "matrix",
    label: "Vertical Dimensions / Articulation — SPIR",
    rows: ["Vertical (mm)", "Protrusion (mm)"],
    columns: ["Current", "Requested"],
  },
  nasalOffset: {
    type: "text",
    label: "Nasal midline offset",
    placeholder: "e.g. 2",
    unit: "mm",
  },
  nasalOffsetSide: {
    type: "radio",
    label: "Offset direction",
    options: ["Left of dental midline", "Right of dental midline"],
  },
  nasalPillowSize: {
    type: "radio",
    label: "Nasal pillow size",
    options: ["Small", "Medium", "Large"],
  },
  comments: {
    type: "textarea",
    label: "Hybrid — Additional comments",
  },
};

const SNOREHOOK_OPTIONS = {
  variant: {
    type: "radio",
    label: "Select device",
    required: true,
    options: ["SnoreHook", "SomnoDent Classic", "SomnoDent Flex", "SomnoDent Herbst Advance"],
  },
  titration: {
    type: "matrix",
    label: "Additional titration (if needed)",
    rows: ["Advancement (mm)", "Vertical (mm)"],
    columns: ["Current", "Requested"],
  },
  comments: {
    type: "textarea",
    label: "Somnodent / SnoreHook — Additional comments",
  },
};

/* ─── NIGHTGUARDS / MOUTHGUARDS / ESSIX ─── */
const GUARD_OPTIONS = {
  variant: {
    type: "radio",
    label: "Device type",
    required: true,
    options: [
      "Hard Nightguard",
      "Soft Nightguard",
      "Dual-Laminate Nightguard",
      "Essix retainer (tray)",
      "Whitening tray",
      "Sports mouthguard (standard)",
    ],
  },
  arch: {
    type: "radio",
    label: "Arch",
    required: true,
    options: ["Upper", "Lower", "Both"],
  },
  thickness: {
    type: "radio",
    label: "Thickness",
    options: ["1 mm", "1.5 mm", "2 mm", "3 mm"],
  },
  modifications: {
    type: "checkbox",
    label: "Modifications",
    options: [
      "Anterior ramp",
      "Soft liner",
      "Labial bow",
      "Trim to gumline",
      "Trim to occlusal plane",
    ],
  },
  comments: {
    type: "textarea",
    label: "Mouthguards — Additional comments",
  },
};

/* ─── SPORT-GUARDS ─── */
const SPORT_COLORS = [
  { name: "Navy Blue",   hex: "#1e3a8a" },
  { name: "Royal Blue",  hex: "#1d4ed8" },
  { name: "Sky Blue",    hex: "#38bdf8" },
  { name: "Teal",        hex: "#0d9488" },
  { name: "Emerald",     hex: "#10b981" },
  { name: "Lime",        hex: "#84cc16" },
  { name: "Yellow",      hex: "#eab308" },
  { name: "Gold",        hex: "#ca8a04" },
  { name: "Orange",      hex: "#f97316" },
  { name: "Red",         hex: "#dc2626" },
  { name: "Crimson",     hex: "#991b1b" },
  { name: "Pink",        hex: "#ec4899" },
  { name: "Magenta",     hex: "#c026d3" },
  { name: "Purple",      hex: "#7c3aed" },
  { name: "Indigo",      hex: "#4338ca" },
  { name: "Black",       hex: "#18181b" },
  { name: "Charcoal",    hex: "#374151" },
  { name: "White",       hex: "#f9fafb" },
  { name: "Silver",      hex: "#9ca3af" },
  { name: "Clear",       hex: "#e5e7eb" },
];

const SPORT_GUARD_OPTIONS = {
  arch: {
    type: "radio",
    label: "Arch",
    required: true,
    options: ["Upper", "Lower"],
  },
  primaryColor: {
    type: "colorPalette",
    label: "Primary sports-guard color",
    required: true,
    palette: SPORT_COLORS,
  },
  secondaryColor: {
    type: "colorPalette",
    label: "Secondary color (optional)",
    palette: SPORT_COLORS,
  },
  pattern: {
    type: "radio",
    label: "Color pattern",
    options: ["Solid", "Two-tone split", "Stripes", "Marbled"],
  },
  strapRetention: {
    type: "radio",
    label: "Helmet strap retention",
    options: ["Yes", "No"],
  },
  specifications: {
    type: "matrix",
    label: "Sports-guard specifications",
    rows: ["Thickness (mm)", "Trim line"],
    columns: ["Value"],
  },
  logoUpload: {
    type: "fileUpload",
    label: "Upload images for logo addition",
    accept: "image/*",
    maxFiles: 4,
  },
  comments: {
    type: "textarea",
    label: "Sport-Guards — Additional comments",
  },
};

/* ─── ORTHODONTIC ─── */
const ORTHO_OPTIONS = {
  applianceType: {
    type: "radio",
    label: "Appliance type",
    required: true,
    options: ["Modified Tandem", "Twin Block", "Other"],
  },
  retention: {
    type: "radio",
    label: "Arch retention / base material",
    required: true,
    options: [
      "Fixed (Banded)",
      "Fixed [3D Printed] Bands",
      "Acrylic w/ clasp retention",
      "Printed NYLON w/ composite retention",
      "Other",
    ],
  },
  expansionScrew: {
    type: "radio",
    label: "Expansion screw",
    options: [
      "No Expansion",
      "Slim-Line Screw",
      "Standard Transverse Screw",
      "Slim-Line Variety-Click",
      "Memory Screw",
      "Standard Hyrax RPE",
      "NiTi",
      "Other",
    ],
  },
  mandibularType: {
    type: "radio",
    label: "Mandibular (lower) component",
    options: ["Removable", "Fixed"],
  },
  modifications: {
    type: "checkbox",
    label: "Add modifications",
    options: [
      "Buccal tubes to bands",
      "Palatal pads",
      "Anterior lap springs",
      "Buccal hooks for tandem elastics",
      "Lingual guide arm to canines",
      "Lingual guide arm (distal)",
      "Labial bow",
      "Transfer tray for composite buttons",
      "Occlusal Rest(s)",
      "Finger Springs",
      "Sheaths for Tandem Bow",
      "Other",
    ],
  },
  nuveloSetup: {
    type: "radio",
    label: "NUVELO Digital Setup",
    options: [
      "Digital Models ONLY - Horse-shoe base",
      "Digital Models ONLY - ABO - Full Base",
    ],
  },
  artboard: {
    type: "artboard",
    label: "Design your appliance",
  },
  comments: {
    type: "textarea",
    label: "Ortho — Additional comments / instructions",
    placeholder: "Design notes, tooth numbers, special instructions…",
  },
};

/* ─── REMAKE / REPAIR / REDESIGN ─── */
const REMAKE_OPTIONS = {
  type: {
    type: "radio",
    label: "Request type",
    required: true,
    options: ["Remake (new device)", "Repair (existing device)", "Redesign (modify parameters)"],
  },
  originalDevice: {
    type: "text",
    label: "Original device / case number (if known)",
    placeholder: "e.g. DDSO-Ant #4012 — Jan 2024",
  },
  defect: {
    type: "textarea",
    label: "Nature of the defect / issue",
    required: true,
    placeholder:
      "Be specific: how did the device break? Is there no retention on the upper arch? Lower? Both?",
  },
  returnedOriginal: {
    type: "radio",
    label:
      "Did you return the original models, bite, and unaltered device(s) to Diamond within 72 hours of remake claim?",
    required: true,
    options: ["Yes", "No"],
    note: "REQUIRED for all no-cost warranty claims.",
  },
};

/* ─── DEVICE LIST ─── */
export const RX_DEVICES = [
  // TMD — Olmos Series
  {
    key: "olmos-day",
    name: "OD — Olmos Day",
    fullName: "Olmos Day Orthotic",
    category: "tmd",
    image: "/images/od-pmt.webp",
    tagline: "Worn during function · phonetic-position fabrication. Chronic joint inflammation & disc displacement.",
    options: OLMOS_DAY_OPTIONS,
  },
  {
    key: "olmos-night",
    name: "ON — Olmos Night",
    fullName: "Olmos Night Orthotic",
    category: "tmd",
    image: "/images/ond-overview.webp",
    tagline: "Worn supine · built for the airway. ON-D decompressor & ON-P positioner variants.",
    options: OLMOS_NIGHT_OPTIONS,
  },
  {
    key: "onp",
    name: "ONP",
    fullName: "Olmos Neuromuscular Positioner",
    category: "tmd",
    image: "/images/onp-front.webp",
    tagline: "Full-coverage neuromuscular orthotic for TMJ repositioning and joint decompression.",
    options: OLMOS_NIGHT_OPTIONS,
  },
  {
    key: "mora",
    name: "MORA",
    fullName: "Mandibular Orthopedic Repositioning Appliance",
    category: "tmd",
    image: "/images/od-pmt.webp",
    tagline: "Mandibular repositioning orthotic (Mistry Protocol) for TMJ decompression and condylar seating.",
    options: {
      occlusalContact: {
        type: "radio",
        label: "Occlusal contact",
        required: true,
        options: OCCLUSAL_CONTACT,
      },
      designPreference: {
        type: "select",
        label: "Design preference",
        options: DESIGN_PREFERENCES,
      },
      comments: {
        type: "textarea",
        label: "MORA — Additional comments / instructions",
        placeholder: "Instructions specific to the MORA device only…",
      },
    },
  },
  {
    key: "ara",
    name: "ARA",
    fullName: "Anterior Repositioning Appliance",
    category: "tmd",
    image: "/images/onp-bioflex-new.webp",
    tagline: "Anterior repositioning orthotic (Mistry Protocol) for disc recapture and condylar repositioning.",
    options: {
      occlusalContact: {
        type: "radio",
        label: "Occlusal contact",
        required: true,
        options: OCCLUSAL_CONTACT,
      },
      designPreference: {
        type: "select",
        label: "Design preference",
        options: DESIGN_PREFERENCES,
      },
      comments: {
        type: "textarea",
        label: "ARA — Additional comments / instructions",
        placeholder: "Instructions specific to the ARA device only…",
      },
    },
  },

  // SLEEP
  {
    key: "ddso",
    name: "DDSO",
    fullName: "Diamond Digital Sleep Orthotic",
    category: "sleep",
    image: "/images/ddso-front.webp",
    tagline: "FDA-cleared mandibular advancement for snoring and OSA. Anterior or posterior.",
    options: DDSO_OPTIONS,
  },
  {
    key: "cadcam-d-pro",
    name: "D-Pro",
    fullName: "CAD/CAM D-Pro",
    category: "sleep",
    image: "/images/ddso-post-overview.webp",
    tagline: "CAD/CAM-fabricated sleep orthotic with full-arch coverage.",
    options: CAD_CAM_D_PRO_OPTIONS,
  },
  {
    key: "shirazi-hybrid",
    name: "Shirazi Hybrid",
    fullName: "Shirazi Hybrid — CPAP Pro",
    category: "sleep",
    image: "/images/onp-model.webp",
    tagline: "Printed-nylon hybrid compatible with CPAP therapy. Nasal-airflow tuning options.",
    options: SHIRAZI_HYBRID_OPTIONS,
  },
  {
    key: "snorehook",
    name: "SnoreHook",
    fullName: "SnoreHook · SomnoDent family",
    category: "sleep",
    image: "/images/ddso-ant-pair.webp",
    tagline: "SnoreHook plus SomnoDent Classic / Flex / Herbst Advance.",
    options: SNOREHOOK_OPTIONS,
  },

  // GUARDS
  {
    key: "guard",
    name: "Guard",
    fullName: "Nightguards / Mouthguards / Essix Trays",
    category: "guard",
    image: "/images/onp-bioflex-new.webp",
    tagline: "Hard, soft, dual-laminate nightguards; Essix retainers; whitening trays.",
    options: GUARD_OPTIONS,
  },

  // SPORT
  {
    key: "sport-guard",
    name: "Sport-Guard",
    fullName: "Diamond Orthotic Sport-Guards",
    category: "sport",
    image: "/images/ond-trutaine.webp",
    tagline: "Custom-colored athletic mouthguards. Logo add-ons supported.",
    options: SPORT_GUARD_OPTIONS,
  },

  // ORTHO
  {
    key: "ortho-expander",
    name: "Ortho Appliance",
    fullName: "Orthodontic Appliance (Expander / Tandem / Twin Block)",
    category: "ortho",
    image: "/images/onp-front.webp",
    tagline: "Functional orthodontics: Modified Tandem, Twin Block, and custom expanders.",
    options: ORTHO_OPTIONS,
  },

  // REMAKE
  {
    key: "remake",
    name: "Remake / Repair",
    fullName: "Remake, Repair, or Redesign",
    category: "remake",
    image: "/images/ddso-post-iso.webp",
    tagline: "Warranty remake, repair, or redesign of a previously delivered device.",
    options: REMAKE_OPTIONS,
  },
];

export const CATEGORY_LABELS = {
  tmd:    { label: "TMD / Olmos Series",   color: "bg-brand-500/10 text-brand-600" },
  sleep:  { label: "Sleep Appliances",     color: "bg-accent-500/10 text-accent-600" },
  guard:  { label: "Mouthguards",          color: "bg-emerald-500/10 text-emerald-600" },
  sport:  { label: "Sport-Guards",         color: "bg-violet-500/10 text-violet-600" },
  ortho:  { label: "Orthodontic",          color: "bg-sky-500/10 text-sky-600" },
  remake: { label: "Remake / Repair",      color: "bg-navy/10 text-navy/70" },
};

export const CATEGORY_ORDER = ["tmd", "sleep", "guard", "sport", "ortho", "remake"];
