/**
 * Nightguard resolver. The guard section is a matrix, not a single choice:
 * each row is an appliance, each row carries its own arch checkboxes and a
 * Base Material dropdown, and one submission may order several rows at once.
 */

// row label → { material literal → code }, or { "*": code } when the appliance
// exists in exactly one form regardless of material.
const GUARD_MATRIX = {
  "Nightguard - Full Occlusion": {
    "PMT (Diamoform)": { code: "2164", name: "Nightguard-Single Arch PMT",    status: "confirmed" },
    "BIOMED (Printed)": { code: "2165", name: "Nightguard-Single Arch Biomed", status: "confirmed" },
    "Nylon (Printed)":  { code: "2166", name: "Nightguard-Single Arch Nylon",  status: "confirmed" },
    "Dual-Laminate":    { code: "2167", name: "Nightguard Dual Laminate",      status: "confirmed" },
    "Acrylic w/clasps": { code: "2428", name: "Nightguard (All-Acrylic)",      status: "proposed"  },
  },
  "Occlusal Guard - NTI Type": {
    "BIOMED (Printed)": { code: "2175", name: "NTI Slider-Type (Dual Arch) Biomed", status: "confirmed" },
    "Nylon (Printed)":  { code: "2176", name: "NTI Slider-Type (Dual Arch) Nylon",  status: "confirmed" },
  },
  "Michigan Splint - Anterior Guidance": {
    "BIOMED (Printed)": { code: "2169", name: "Michigan Splint Biomed", status: "confirmed" },
    "Nylon (Printed)":  { code: "2170", name: "Michigan Splint Nylon",  status: "confirmed" },
  },
  "Dual Arch - FLATPLANE": {
    "BIOMED (Printed)": { code: "2162", name: "FLATPLANE (Dual Arch) Biomed",  status: "confirmed" },
    "Nylon (Printed)":  { code: "2163", name: "FLATPLANE (Dual Arch) Nylon",   status: "confirmed" },
    "BioFlex":          { code: "2531", name: "FLATPLANE (Dual Arch) BioFlex", status: "confirmed" },
  },
  "Essix Tray":          { "*": { code: "2161", name: "Essix Tray Non Printed (per arch)", status: "confirmed" } },
  "Bleaching Trays":     { "*": { code: "2155", name: "Bleaching Tray (per arch)",         status: "confirmed" } },
  "Neurosensory Stent":  { "*": { code: "2597", name: "Neurostent BioFlex",                status: "proposed"  } },
  // Ambiguous: the catalog has both NTI Slider-Type (2175/2176) and FLATPLANE
  // (2162/2163/2531). Never guess — the lab must disambiguate.
  "Occlusal Guard - Slider Type": {},
};

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

export function resolveGuard(deviceOptions = {}) {
  const items = [];
  const unmapped = [];
  const matrix = deviceOptions.standardGuards || {};

  for (const [rowLabel, cells] of Object.entries(matrix)) {
    if (!cells) continue;
    const arches = [];
    if (cells["UPPER ARCH"]) arches.push("upper");
    if (cells["LOWER ARCH"]) arches.push("lower");
    if (arches.length === 0) continue; // row not ordered

    const options = GUARD_MATRIX[rowLabel];
    if (!options || Object.keys(options).length === 0) {
      unmapped.push(`guard:${slug(rowLabel)}`);
      continue;
    }

    const starRow = Boolean(options["*"]);
    const chosen = options["*"] || options[cells["Base Material"]];
    if (!chosen) {
      unmapped.push(`guard:${slug(rowLabel)}:${slug(cells["Base Material"] || "no-material")}`);
      continue;
    }

    const materialKey = starRow ? "any" : slug(cells["Base Material"]);
    for (const arch of arches)
      items.push({
        mapKey: `guard:${slug(rowLabel)}:${materialKey}`,
        code: chosen.code,
        name: chosen.name,
        arch,
        status: chosen.status,
      });
  }

  return { items, unmapped };
}
