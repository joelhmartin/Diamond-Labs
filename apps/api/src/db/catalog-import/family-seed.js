// Rx device families, written out by hand from the lab-confirmed rows of
// services/rx/catalog-map/devices.table.js. plan-catalog.test.js fails if a
// code here is not a confirmed row there. Everything not listed imports as a
// one-variant family; admins group the rest in the Catalog page.
export const FAMILY_SEED = [
  {
    slug: "olmos-day", name: "Olmos Day", channel: "rx", options: ["Material"],
    variants: [
      { code: "2102", values: { Material: "PMT" } },
      { code: "2527", values: { Material: "BioFlex" } },
      { code: "2108", values: { Material: "Nylon" } },
      { code: "2103", values: { Material: "Acrylic w/Clasps" } },
      { code: "2105", values: { Material: "Dual Laminate" } },
      { code: "2106", values: { Material: "Milled" } },
    ],
  },
  {
    slug: "olmos-night", name: "Olmos Night", channel: "rx", options: ["Design", "Material"],
    variants: [
      { code: "2144", values: { Design: "ON-T Titration", Material: "Nylon" } },
      { code: "2119", values: { Design: "ON-D Deprogrammer", Material: "Nylon" } },
      { code: "2114", values: { Design: "ON-D Deprogrammer", Material: "PMT" } },
      { code: "2118", values: { Design: "ON-D Deprogrammer", Material: "Biomed" } },
      { code: "2117", values: { Design: "ON-D Deprogrammer", Material: "Dual Laminate" } },
      { code: "2115", values: { Design: "ON-D Deprogrammer", Material: "Acrylic w/Clasps" } },
      { code: "2130", values: { Design: "ON-P Positioner", Material: "Nylon" } },
      { code: "2125", values: { Design: "ON-P Positioner", Material: "PMT" } },
      { code: "2129", values: { Design: "ON-P Positioner", Material: "Biomed" } },
      { code: "2128", values: { Design: "ON-P Positioner", Material: "Dual Laminate" } },
      { code: "2126", values: { Design: "ON-P Positioner", Material: "Acrylic w/Clasps" } },
      { code: "2142", values: { Design: "ON-R Ramp", Material: "Nylon" } },
      { code: "2137", values: { Design: "ON-R Ramp", Material: "PMT" } },
      { code: "2141", values: { Design: "ON-R Ramp", Material: "Biomed" } },
      { code: "2140", values: { Design: "ON-R Ramp", Material: "Dual Laminate" } },
      { code: "2138", values: { Design: "ON-R Ramp", Material: "Acrylic w/Clasps" } },
    ],
  },
  {
    slug: "ddso", name: "DDSO", channel: "rx", options: ["Material"],
    variants: [
      { code: "2608", values: { Material: "Nylon" } },
      { code: "2146", values: { Material: "Biomed" } },
    ],
  },
  {
    slug: "sport-guard", name: "Sport-Guard", channel: "rx", options: ["Tier"],
    variants: [
      { code: "2173", values: { Tier: "Trainer (mandibular only)" } },
      { code: "2172", values: { Tier: "Pro" } },
      { code: "2174", values: { Tier: "CAD/CAM" } },
    ],
  },
];
