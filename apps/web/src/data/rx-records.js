// Canonical option lists shared across the wizard. Sourced from the JotForm
// Rx 2025 defs (docs/rx-forms/jotform-api/rx-2025-220598308432154-questions.json).
export const RECORDS_METHODS = [
  { value: "physical_bite", label: "Physical Bite Registration", img: "/images/rx/options/bite_150.png" },
  { value: "pvs", label: "PVS Impressions", img: "/images/rx/options/PVS_150.png" },
  { value: "stone_resin", label: "Stone/Resin Models", img: "/images/rx/options/model_150.png" },
  { value: "3shape", label: "3SHAPE", img: "/images/rx/options/3shape.png" },
  { value: "carestream", label: "CARESTREAM", img: "/images/rx/options/carestream.png" },
  { value: "cerec", label: "CEREC", img: "/images/rx/options/cerec.png" },
  { value: "itero", label: "ITERO", img: "/images/rx/options/itero.png" },
  { value: "medit", label: "MEDIT", img: "/images/rx/options/medit.png" },
  { value: "midmark", label: "MIDMARK", img: "/images/rx/options/midmark.png" },
  { value: "shining3d", label: "SHINING 3D", img: "/images/rx/options/shining.png" },
  { value: "planmeca", label: "PLANMECA", img: "/images/rx/options/planmeca.png" },
  { value: "other_scanner", label: "ALL OTHER SCANNERS", img: "/images/rx/options/all.png" },
];
export const PHYSICAL_BITE = [
  { value: "no_digital", label: "No — start case now with digital bite" },
  { value: "wait_physical", label: "Yes — wait until physical bite is received (production won't start until received)" },
  { value: "start_verify", label: "Yes — start with digital bite; verify with physical bite" },
];
export const FIRST_DEVICE = ["Yes", "No, use PREVIOUS RECORDS", "No, use NEW RECORDS"];
export const RUSH_TIERS = {
  nylon: { label: "Nylon devices", price: 150 },
  biomedPmtAcrylic: { label: "Biomed / PMT / Acrylic", price: 75 },
};
