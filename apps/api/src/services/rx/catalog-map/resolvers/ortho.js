/**
 * Orthodontic appliance resolver.
 *
 * An ortho Rx is not one product: the lab bills an appliance per arch (chosen
 * by retention × expansion screw), the bands that anchor a fixed arch, the
 * tandem bow and its tubes, and priced add-ons. Every ruling below was read off
 * the order history — JotForm ortho prescriptions (Jan 2025–Oct 2026) matched
 * to the Seazona orders the lab actually built from them. `evidence` records
 * how strong each one is; the status follows from it:
 *
 *   confirmed — ≥ 90% of ≥ 8 matched prescriptions carried this product
 *   proposed  — the history points here but thinly, or with a catalog sibling
 *               the lab should rule out
 *   open      — history split or silent; NEVER emits a line, the order is held
 *
 * Anything this module cannot place — a combination with no ruling, an answer
 * the form never offered (a typed "other" from a legacy case) — is reported in
 * `unmapped`, never dropped and never guessed. Lines carry `arch` as
 * "upper"/"lower" (the order builder normalises those to Seazona's 1/2).
 * Quantities are emitted as repeated lines (2 × Ortho Band), which is how the
 * lab's own orders look.
 *
 * Field keys and option literals are the ortho form's
 * (apps/web/src/data/forms/ortho.sections.js) as carried by the shared adapter
 * (packages/shared/src/rx/form-devices.js → buildOrthoDevice); a coverage test
 * reads the live form so a renamed option fails a test, not an order.
 */

const DEVICE = "ortho-expander";

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const asList = (v) => (Array.isArray(v) ? v : v ? [v] : []);

// ── Form literals ───────────────────────────────────────────────────────────

const RETENTION = {
  "Fixed (Banded)": "fixed",
  "Fixed [3D Printed] Bands": "fixed",
  "Acrylic w/ clasp retention": "acrylic",
  "Printed NYLON w/ composite retention": "nylon",
};
const RETENTION_LABEL = {
  fixed: "Fixed (banded or 3D-printed bands)",
  acrylic: "Acrylic w/ clasp retention",
  nylon: "Printed NYLON w/ composite retention",
};

const UPPER_SCREW = {
  "No Expansion": "no-expansion",
  "Slim-Line Screw": "slim-line",
  "Standard Transverse Screw": "standard-transverse",
  'Slim-line "Variety-Click" (Fixed ONLY)': "variety-click",
  "Memory Screw (Fixed ONLY)": "memory",
  "Standard Hyrax RPE (Fixed ONLY)": "hyrax",
  "NiTi - Nickel Titanium (Fixed ONLY)": "niti",
};
const LOWER_SCREW = {
  "No Expansion": "no-expansion",
  "Slim-Line Screw": "slim-line",
  "Standard Transverse Screw": "standard-transverse",
  'Slim-line "Variety-Click"': "variety-click",
  "Memory Screw (Removable Only)": "memory",
};
const FIXED_MANDIBULAR = {
  "Mandibular E-Arch": "e-arch",
  "Mandibular Williams": "williams",
  "Mandibular Slim-line 'Variety Click' Expander": "variety-click",
};
const REMOVABLE_MANDIBULAR = {
  "Mandibular Schwarz": "schwarz",
  "Mandibular Memory Screw": "memory",
  "Mandibular Slim-line": "slim-line",
};

// Add-ons that change which band product a banded arch gets instead of being a
// line of their own.
const TUBE_ADDONS = {
  upper: new Set(["Buccal tubes to bands"]),
  lower: new Set(["Buccal tubes to bands", "Headgear tubes for tandem to bands"]),
};
const SHEATH_ADDONS = new Set(["Sheaths for Tandem Bow (Removable)", "Add buccal sheath for tandem bow"]);
const TRANSFER_TRAY = "Transfer tray for composite buttons";

// ── Rulings ─────────────────────────────────────────────────────────────────

const P = {
  2180: "Fixed Williams Appliance",
  2181: "Acrylic Palatal Pads",
  2186: "Lingual E Arch Expander",
  2189: "Lower Fixed Expander",
  2190: "Lower Fixed Variety Click Expander",
  2191: "Lower Lingual Holding Appliance",
  2192: "Lower Removable Variety Click Expander With Acrylic Overlay",
  2195: "Mx. Buccal Hooks For Tandem",
  2198: "Ortho Band",
  2199: "Ortho Bands With Tubes (Each)",
  2217: "Tandem Bow",
  2219: "Tubes For Tandem",
  2222: "Upper Fixed Memory Expander",
  2225: "Upper Fixed Slim-Line Hyrax",
  2226: "Upper Fixed Slim-Line W/ Variety Click",
  2313: "Composite Transfer Tray",
  2412: "Removable Md. Expander w/acrylic overlay [Std. Screw]",
  2569: "Lower Removable Memory Expander With Acrylic Overlay",
  2572: "3D Printed Bands",
};

const mapped = (code, status, evidence) => ({ code: String(code), name: P[code], status, evidence });
const open = (reason) => ({ code: null, status: "open", reason });

const REMOVABLE_UPPER_REASON =
  "Removable upper appliances (acrylic or printed nylon) were too rare and too mixed in the order history to infer a product. Which appliance does this combination bill?";
const NYLON_LOWER_REASON =
  "A Printed NYLON lower billed 2203 (Md. Printed Tandem, Std. screw) on only half of 14 prescriptions, and the catalog prices nylon tandems by screw. Which product does each screw choice bill?";

/** retention × screw → ruling, per arch. Combinations the form disables are absent. */
const APPLIANCE = {
  upper: {
    "fixed:variety-click": mapped(2226, "confirmed", "110 Rx, 95%"),
    "fixed:memory": mapped(2222, "confirmed", "28 Rx, 96%"),
    "fixed:hyrax": mapped(2225, "proposed", "slim-line + hyrax on fixed retention: 17 Rx, 82%"),
    "fixed:slim-line": mapped(2225, "proposed", "slim-line + hyrax on fixed retention: 17 Rx, 82% (slim-line alone 3 of 3)"),
    "fixed:standard-transverse": open(
      "Five prescriptions billed three different appliances — 2225 Slim-Line Hyrax, 2222 Memory Expander, 2178 Haas Expander. Which is a fixed upper with a standard transverse screw?"
    ),
    "fixed:no-expansion": open(
      "No upper appliance product recurs on these orders (8 Rx; a Transpalatal Arch 2218 on 3). What does a fixed, non-expanding upper bill?"
    ),
    "fixed:niti": open("No NiTi upper appears in the order history and the catalog has no NiTi product. What does it bill?"),
    "acrylic:no-expansion": open(REMOVABLE_UPPER_REASON),
    "acrylic:slim-line": open(REMOVABLE_UPPER_REASON),
    "acrylic:standard-transverse": open(REMOVABLE_UPPER_REASON),
    "nylon:no-expansion": open(REMOVABLE_UPPER_REASON),
    "nylon:slim-line": open(REMOVABLE_UPPER_REASON),
    "nylon:standard-transverse": open(REMOVABLE_UPPER_REASON),
  },
  lower: {
    "acrylic:variety-click": mapped(2192, "confirmed", "62 Rx, 94%"),
    "fixed:variety-click": mapped(2190, "confirmed", "43 Rx, 98%"),
    "acrylic:standard-transverse": mapped(2412, "confirmed", "acrylic + standard transverse or slim-line: 21 Rx, 95%"),
    "acrylic:slim-line": mapped(
      2412,
      "proposed",
      "history billed 2412 [Std. Screw] (21 Rx, 95%), but the catalog also has 2639 [Slim-line] — confirm which"
    ),
    "acrylic:memory": mapped(2569, "confirmed", "8 Rx, 100%"),
    "fixed:no-expansion": mapped(2191, "proposed", "3 Rx, 100%"),
    "fixed:slim-line": mapped(2189, "proposed", "3 Rx"),
    "fixed:standard-transverse": open(
      "No consistent product for a fixed lower with a standard transverse screw in the order history. Which appliance is it?"
    ),
    "acrylic:no-expansion": open(
      "An acrylic lower with no expansion shows no consistent appliance product in the history. What does it bill — or is it part of the tandem?"
    ),
    "nylon:no-expansion": open(NYLON_LOWER_REASON),
    "nylon:slim-line": open(NYLON_LOWER_REASON),
    "nylon:standard-transverse": open(NYLON_LOWER_REASON),
    "nylon:variety-click": open(NYLON_LOWER_REASON),
    "nylon:memory": open(NYLON_LOWER_REASON),
  },
};

const MANDIBULAR = {
  "fixed:e-arch": mapped(2186, "confirmed", "12 Rx, 100%"),
  "fixed:williams": mapped(2180, "confirmed", "10 Rx, 90%"),
  "fixed:variety-click": open(
    "17 prescriptions: 2190 Lower Fixed Variety Click on only 35%, the rest split. Is this 2190, or a different appliance?"
  ),
  "removable:memory": mapped(2569, "proposed", "catalog name match; a removable lower memory screw billed 2569 on 8 of 9 Rx"),
  "removable:schwarz": open(
    "14 prescriptions: 2412 Removable Md. Expander on only 57%. Is a Mandibular Schwarz always 2412?"
  ),
  "removable:slim-line": open(
    "11 prescriptions with no lower product on more than a fifth of them. Is this 2412, 2639 [Slim-line], or something else?"
  ),
};

const BANDS = {
  "upper:banded": mapped(2198, "confirmed", "Ortho Band on 87–94% of 165 banded-upper Rx; 2 per banded arch on 85% of orders"),
  "upper:banded-tubes": mapped(2199, "proposed", "'Buccal tubes to bands' carried 2199 on 75–83% of 28 Rx"),
  "upper:printed": mapped(2572, "confirmed", "14 Rx, 100%"),
  "lower:banded": mapped(2198, "proposed", "2 per banded arch on 85% of orders; but most banded lowers carry tubes (see banded-tubes)"),
  "lower:banded-tubes": mapped(
    2199,
    "proposed",
    "2199 on 90% of 58 banded-lower Rx (93% of them Modified Tandems, whose bow needs lower tubes)"
  ),
  "lower:printed": mapped(2572, "proposed", "7 Rx, 100%"),
};
const BAND_QTY = 2;

const TANDEM = {
  bow: mapped(2217, "confirmed", "189 Rx, 94%"),
  tubes: mapped(2219, "confirmed", "Modified Tandem with an acrylic lower: 98% of 103 Rx"),
  "twin-block": open(
    "One Twin Block order in 21 months (2220 Twin Block - Biomed) and the form does not capture a material. Which product, by material?"
  ),
};

const ADDON = {
  "upper:buccal-hooks-for-tandem-elastics": mapped(2195, "confirmed", "163 Rx, 95–98%"),
  "upper:palatal-pads": mapped(2181, "proposed", "25 Rx, 86–89%"),
  "lower:tandem-sheaths": mapped(2219, "proposed", "sheath add-ons carried 2219 on 80–89% of 58 Rx"),
  "any:transfer-tray": mapped(2313, "confirmed", "74 Rx, 95–96%"),
};
const ADDON_OPEN_REASON =
  "No separate product recurs on orders with this add-on — it looks like a build detail included in the appliance. Should it bill (and as what), or travel as a note only?";
const ADDON_OPEN = {
  upper: [
    "Anterior lap springs",
    "Labial bow",
    "Acrylic labial bow",
    "Occlusal Rest(s)",
    "Buccal tubes to bands",
  ],
  lower: [
    "Anterior lap springs",
    "Labial bow",
    "Acrylic labial bow",
    "Occlusal Rest(s)",
    "Finger Springs (please specify tooth location)",
    "Buccal tubes to bands",
    "Headgear tubes for tandem to bands",
  ],
};
// Build details the lab never bills on their own: they travel in the order
// notes (orthoBuildNotes) and emit no line. Lingual guide arms: no product of
// their own recurs on the orders that asked for one — upper distal n=12/18,
// to canines n=30, to canine n=5/3, lower distal n=7/12 — the arm is part of
// the expander it is soldered to.
const ADDON_NOTE = {
  upper: ["Lingual guide arm to canines", "Lingual guide arm (distal)", "Lingual guide arm (to canine)"],
  lower: ["Lingual guide arm (distal)"],
};
const NOTE_ONLY = {
  code: null,
  status: "none",
  evidence: "no product of its own recurs across 87 answers (2025–26); built into the expander",
};

const ADDON_REASONS = {
  "Anterior lap springs":
    "2185 Lap Spring (Each) appears on these orders, but the form does not capture how many springs. How should the count be set?",
  "Buccal tubes to bands":
    "On Fixed (Banded) retention, tubes bill as 2199 Ortho Bands With Tubes. This arch is not on Ortho Bands (3D-printed bands, acrylic or nylon). What do tubes bill here?",
  "Headgear tubes for tandem to bands":
    "On a Fixed (Banded) lower, tubes bill as 2199 Ortho Bands With Tubes. This lower is not on Ortho Bands. What do they bill here?",
};

// Maxillary-only / Mandibular-only expansion matrices: every cell is typed
// text and the history is split (e.g. "Hyrax RPE / FIXED" billed 2226 and 2225
// about equally), so only the two rows with a clear signal resolve.
const UPPER_SELECTION_ROWS = [
  "Transverse Schwarz", "Sagittal Schwarz", "Quad Helix", "NiTi", "A.L.F.", "3-Way Screw",
  "Hyrax RPE", "HAAS RPE", '"W" Expansion', "TPA", "Other",
];
const LOWER_SELECTION_ROWS = [
  "Transverse Schwarz", "Sagittal Schwarz", "E-Arch", "Williams Expander", "A.L.F.", "3-Way Screw", "TPA", "Other",
];
const SELECTION = {
  "lower:e-arch": mapped(2186, "proposed", "'E-Arch / FIXED' billed 2186 on 12 of 12 Rx; cells are typed text"),
  "lower:williams-expander": mapped(2180, "proposed", "'Williams Expander / FIXED' billed 2180 on 5 of 6 Rx; cells are typed text"),
};
const SELECTION_OPEN_REASON =
  "The arch-only expansion table is typed free text and the history for this row is split across several appliances. Which product does it bill?";

// ── Table view (for the mapping report and tests) ────────────────────────────

const row = (mapKey, selection, ruling) => ({
  mapKey,
  device: DEVICE,
  match: [selection],
  code: ruling.code,
  name: ruling.name ?? selection,
  status: ruling.status,
  ...(ruling.evidence ? { evidence: ruling.evidence } : {}),
  ...(ruling.reason ? { reason: ruling.reason } : {}),
});

const screwLabel = (arch, s) =>
  Object.keys(arch === "upper" ? UPPER_SCREW : LOWER_SCREW).find((k) => (arch === "upper" ? UPPER_SCREW : LOWER_SCREW)[k] === s);
const mandibularLabel = (kind, s) => {
  const t = kind === "fixed" ? FIXED_MANDIBULAR : REMOVABLE_MANDIBULAR;
  return Object.keys(t).find((k) => t[k] === s);
};

/** Every ruling as a table row — exported for the lab mapping report. */
export const ORTHO_ROWS = [
  row("ortho:tandem:bow", "Modified Tandem", TANDEM.bow),
  row("ortho:tandem:tubes", "Modified Tandem with an acrylic lower", TANDEM.tubes),
  row("ortho:twin-block", "Twin Block", TANDEM["twin-block"]),
  ...["upper", "lower"].flatMap((arch) =>
    Object.entries(APPLIANCE[arch]).map(([k, r]) => {
      const [ret, screw] = k.split(":");
      return row(`ortho:${arch}:${k}`, `${arch === "upper" ? "UPPER" : "Lower"}: ${RETENTION_LABEL[ret]} + ${screwLabel(arch, screw)}`, r);
    })
  ),
  ...Object.entries(MANDIBULAR).map(([k, r]) => {
    const [kind, s] = k.split(":");
    return row(`ortho:lower:mandibular:${k}`, `${kind === "fixed" ? "Fixed" : "Removable"} Mandibular Expansion: ${mandibularLabel(kind, s)}`, r);
  }),
  row("ortho:upper:bands:banded", "UPPER Fixed (Banded) — 2 bands", BANDS["upper:banded"]),
  row("ortho:upper:bands:banded-tubes", "UPPER Fixed (Banded) + Buccal tubes to bands — 2 bands", BANDS["upper:banded-tubes"]),
  row("ortho:upper:bands:printed", "UPPER Fixed [3D Printed] Bands — 2 bands", BANDS["upper:printed"]),
  row("ortho:lower:bands:banded", "Lower Fixed (Banded) — 2 bands", BANDS["lower:banded"]),
  row("ortho:lower:bands:banded-tubes", "Lower Fixed (Banded) on a Modified Tandem, or with buccal/headgear tubes — 2 bands", BANDS["lower:banded-tubes"]),
  row("ortho:lower:bands:printed", "Lower Fixed [3D Printed] Bands — 2 bands", BANDS["lower:printed"]),
  row("ortho:upper:bands:teeth-specified", "UPPER bands with 'Place bands on:' filled in", open(
    "The doctor named which teeth to band, so the band count is not the usual 2. Staff count bands from the Rx — or tell us a rule."
  )),
  row("ortho:lower:bands:teeth-specified", "Lower bands with 'Place bands on:' filled in", open(
    "The doctor named which teeth to band, so the band count is not the usual 2. Staff count bands from the Rx — or tell us a rule."
  )),
  row("ortho:upper:addon:buccal-hooks-for-tandem-elastics", "Add to Maxillary: Buccal hooks for tandem elastics", ADDON["upper:buccal-hooks-for-tandem-elastics"]),
  row("ortho:upper:addon:palatal-pads", "Add to Maxillary: Palatal pads", ADDON["upper:palatal-pads"]),
  row("ortho:lower:addon:tandem-sheaths", "Add to Mandibular: Sheaths for Tandem Bow / buccal sheath for tandem bow", ADDON["lower:tandem-sheaths"]),
  row("ortho:addon:transfer-tray", "Transfer tray for composite buttons (either arch)", ADDON["any:transfer-tray"]),
  ...["upper", "lower"].flatMap((arch) =>
    ADDON_NOTE[arch].map((label) =>
      row(`ortho:${arch}:addon:${slug(label)}`, `Add to ${arch === "upper" ? "Maxillary" : "Mandibular"}: ${label}`, { ...NOTE_ONLY, name: `${label} (note only)` })
    )
  ),
  ...["upper", "lower"].flatMap((arch) =>
    ADDON_OPEN[arch].map((label) =>
      row(`ortho:${arch}:addon:${slug(label)}`, `Add to ${arch === "upper" ? "Maxillary" : "Mandibular"}: ${label}`, open(ADDON_REASONS[label] || ADDON_OPEN_REASON))
    )
  ),
  ...[["upper", UPPER_SELECTION_ROWS], ["lower", LOWER_SELECTION_ROWS]].flatMap(([arch, rows]) =>
    rows.map((label) =>
      row(
        `ortho:${arch}-selection:${slug(label)}`,
        `${arch === "upper" ? "UPPER" : "LOWER"}- Expansion Option Selection: ${label}`,
        SELECTION[`${arch}:${slug(label)}`] || open(SELECTION_OPEN_REASON)
      )
    )
  ),
];

const ROW_BY_KEY = new Map(ORTHO_ROWS.map((r) => [r.mapKey, r]));

// ── Resolver ────────────────────────────────────────────────────────────────

function createOut(overrides = {}) {
  const out = { items: [], unmapped: [] };
  const seenCodes = new Set();
  const seenUnmapped = new Set();
  return {
    out,
    /**
     * Hold a selection for the lab, once — unless an admin has saved an
     * "always" ruling (rx_code_overrides) for exactly this key. Then emit a
     * codeless placeholder line carrying the key and arch; resolveLineItems
     * swaps it for the override (or a noteOnly line). Every ortho hold key
     * already names its arch, so unlike guard's arch-less unmapped keys a
     * placeholder never collapses a two-arch order into one line.
     * `ortho:unspecified` is a data-quality hold, never overridable.
     */
    flag(mapKey, arch = null, qty = 1) {
      if (seenUnmapped.has(mapKey)) return;
      seenUnmapped.add(mapKey);
      if (overrides[mapKey] && mapKey !== UNSPECIFIED) {
        for (let i = 0; i < qty; i++)
          out.items.push({ code: null, name: null, mapKey, arch, status: "open" });
        return;
      }
      out.unmapped.push(mapKey);
    },
    /**
     * Emit the ruling for `mapKey` `qty` times. An open ruling — or a key with
     * no ruling at all — is flagged instead. `once` drops a repeat of the same
     * product on the same arch (two controls naming one appliance).
     */
    emit(mapKey, arch = null, { qty = 1, once = true } = {}) {
      const r = ROW_BY_KEY.get(mapKey);
      if (r?.status === "none") return; // a build detail: travels as a note, never a line or a hold
      if (!r || r.status === "open" || !r.code) return this.flag(mapKey, arch, qty);
      const dedupe = `${r.code}:${arch}`;
      if (once && seenCodes.has(dedupe)) return;
      seenCodes.add(dedupe);
      for (let i = 0; i < qty; i++)
        out.items.push({ code: r.code, name: r.name, mapKey, arch, status: r.status });
    },
  };
}

/** Is a matrix row (cells keyed `${row}__${col}`) answered at all? */
function matrixRowAnswered(matrix, rowLabel) {
  if (!matrix || typeof matrix !== "object") return false;
  return Object.entries(matrix).some(
    ([k, v]) => k.startsWith(`${rowLabel}__`) && v != null && String(v).trim() !== ""
  );
}

function resolveArchAppliance(arch, o, acc) {
  const retentionLiteral = o[`${arch}ArchRetention`];
  const screwLiteral = o[`${arch}ExpansionType`];
  const screws = arch === "upper" ? UPPER_SCREW : LOWER_SCREW;
  const ret = retentionLiteral ? RETENTION[retentionLiteral] : null;
  const screw = screwLiteral ? screws[screwLiteral] : null;

  if (retentionLiteral && !ret) acc.flag(`ortho:typed:${arch}ArchRetention`, arch);
  if (screwLiteral && !screw) acc.flag(`ortho:typed:${arch}ExpansionType`, arch);
  if ((retentionLiteral && !ret) || (screwLiteral && !screw)) return;

  if (ret && screw) return acc.emit(`ortho:${arch}:${ret}:${screw}`, arch);
  if (ret) return acc.flag(`ortho:${arch}:${ret}:no-expansion-type`, arch);
  if (screw) return acc.flag(`ortho:${arch}:no-retention:${screw}`, arch);
}

function resolveBands(arch, o, addOns, acc) {
  const literal = o[`${arch}ArchRetention`];
  if (literal !== "Fixed (Banded)" && literal !== "Fixed [3D Printed] Bands") return;

  // "Required Selection" matrix, row Maxillary/Mandibular, column "Place bands on:".
  const placeBandsOn = o.requiredSelection?.[`${arch === "upper" ? "Maxillary" : "Mandibular"}__Place bands on:`];
  if (placeBandsOn != null && String(placeBandsOn).trim() !== "")
    return acc.flag(`ortho:${arch}:bands:teeth-specified`, arch);

  if (literal === "Fixed [3D Printed] Bands")
    return acc.emit(`ortho:${arch}:bands:printed`, arch, { qty: BAND_QTY, once: false });

  const tubes =
    addOns.some((a) => TUBE_ADDONS[arch].has(a)) || (arch === "lower" && o.applianceType === "Modified Tandem");
  acc.emit(`ortho:${arch}:bands:${tubes ? "banded-tubes" : "banded"}`, arch, { qty: BAND_QTY, once: false });
}

function resolveAddOns(arch, o, addOns, acc) {
  const bandedWithTubes = o[`${arch}ArchRetention`] === "Fixed (Banded)";
  for (const addOn of addOns) {
    if (TUBE_ADDONS[arch].has(addOn) && bandedWithTubes) continue; // priced as 2199 bands
    if (addOn === TRANSFER_TRAY) {
      acc.emit("ortho:addon:transfer-tray", null);
      continue;
    }
    if (arch === "lower" && SHEATH_ADDONS.has(addOn)) {
      acc.emit("ortho:lower:addon:tandem-sheaths", "lower");
      continue;
    }
    const key = `ortho:${arch}:addon:${slug(addOn)}`;
    if (ROW_BY_KEY.has(key)) acc.emit(key, arch);
    else acc.flag(`ortho:typed:${arch}AddOns`, arch);
  }
}

export function resolveOrtho(deviceOptions = {}, { overrides = {} } = {}) {
  const o = deviceOptions;
  const acc = createOut(overrides);
  const upperAddOns = asList(o.upperAddOns);
  const lowerAddOns = asList(o.lowerAddOns);

  // Dual-arch device.
  if (o.applianceType === "Modified Tandem") {
    acc.emit("ortho:tandem:bow");
    // The bow seats in tubes processed into an acrylic lower; a banded lower
    // carries them on the bands instead (2199, see resolveBands).
    if (o.lowerArchRetention === "Acrylic w/ clasp retention") acc.emit("ortho:tandem:tubes", "lower");
  } else if (o.applianceType === "Twin Block") {
    acc.flag("ortho:twin-block");
  } else if (o.applianceType) {
    acc.flag("ortho:typed:applianceType");
  }

  // Upper appliance.
  resolveArchAppliance("upper", o, acc);

  // Lower appliance: a Fixed / Removable Mandibular Expansion pick names the
  // appliance outright, so it takes the place of retention × screw (an E-Arch
  // order never also carried a 2190 in the history).
  const mandibular = [
    ...asList(o.fixedMandibularExpansion).map((v) => ["fixed", FIXED_MANDIBULAR[v], "fixedMandibularExpansion"]),
    ...asList(o.removableMandibularExpansion).map((v) => ["removable", REMOVABLE_MANDIBULAR[v], "removableMandibularExpansion"]),
  ];
  if (mandibular.length) {
    for (const [kind, s, field] of mandibular)
      if (s) acc.emit(`ortho:lower:mandibular:${kind}:${s}`, "lower");
      else acc.flag(`ortho:typed:${field}`, "lower");
  } else {
    resolveArchAppliance("lower", o, acc);
  }

  // Bands, then add-ons (some add-ons only change the band product).
  resolveBands("upper", o, upperAddOns, acc);
  resolveBands("lower", o, lowerAddOns, acc);
  resolveAddOns("upper", o, upperAddOns, acc);
  resolveAddOns("lower", o, lowerAddOns, acc);

  // Arch-only expansion matrices.
  for (const [arch, matrix, rows] of [
    ["upper", o.upperExpansionSelection, UPPER_SELECTION_ROWS],
    ["lower", o.lowerExpansionSelection, LOWER_SELECTION_ROWS],
  ])
    for (const label of rows)
      if (matrixRowAnswered(matrix, label)) acc.emit(`ortho:${arch}-selection:${slug(label)}`, arch);

  // Bands and add-ons are accessories: without an appliance (tandem, twin
  // block, an arch expander, a mandibular pick, an arch-only selection) —
  // resolved or held — there is nothing for them to attach to. Hold the device
  // rather than let a transfer tray alone pass as a complete ortho order.
  const { out } = acc;
  const keys = [...out.items.map((i) => i.mapKey), ...out.unmapped];
  if (!keys.some((k) => !isOrthoAccessoryKey(k))) out.unmapped.push(UNSPECIFIED);
  return out;
}

/**
 * Lines that ride on an ortho appliance rather than being one: bands and
 * add-ons (incl. a typed add-on hold). catalog-map/index.js's isDeviceLine
 * excludes these, so an order carrying only accessories never counts as having
 * an appliance — at resolve time, at line seeding, and at the push gate.
 */
export const isOrthoAccessoryKey = (mapKey) =>
  typeof mapKey === "string" &&
  (/^ortho:(?:(?:upper|lower):)?(?:bands|addon):/.test(mapKey) || /^ortho:typed:(?:upper|lower)AddOns$/.test(mapKey));

const UNSPECIFIED = "ortho:unspecified";

// ── Order notes ─────────────────────────────────────────────────────────────

const filled = (v) => v != null && String(v).trim() !== "";

/** A `${row}__${col}` matrix → "Row: Col: value; Col: value / Row: …" (answered cells only; " | " already separates note fragments). */
function matrixNote(matrix) {
  if (!matrix || typeof matrix !== "object") return "";
  const rows = new Map();
  for (const [key, value] of Object.entries(matrix)) {
    if (!filled(value)) continue;
    const [row, col = ""] = key.split("__");
    if (!rows.has(row)) rows.set(row, []);
    rows.get(row).push(`${col.replace(/:$/, "")}: ${String(value).trim()}`);
  }
  return [...rows].map(([row, cells]) => `${row}: ${cells.join("; ")}`).join(" / ");
}

/**
 * The ortho build detail no product code carries — tandem bow setting, which
 * teeth get bands / rests / build-ups, the arch-only expansion tables (typed
 * text), digital setup and study models. One readable note fragment per
 * answered question; build-order-payload.js appends them to the order notes.
 */
export function orthoBuildNotes(o = {}) {
  const lines = [];
  const add = (label, value) => {
    if (filled(value)) lines.push(`${label}: ${String(value).trim()}`);
  };
  add("Mx. selection", o.mxSelections);
  if (filled(o.tandemBowSetting))
    lines.push(`Tandem bow: ${String(o.tandemBowSetting).trim()} mm from incisal edge of lower anteriors`);
  add("Required selection", matrixNote(o.requiredSelection));
  add("Tandem occlusal options", matrixNote(o.occlusalOptionsTandem));
  add("UPPER expansion selection", matrixNote(o.upperExpansionSelection));
  add("LOWER expansion selection", matrixNote(o.lowerExpansionSelection));
  add("NUVELO digital setup", matrixNote(o.nuveloDigitalSetup));
  add("Send digital setup to", o.digitalSetupEmail);
  add("Digital study models", o.digitalStudyModels);
  // Note-only add-ons emit no line, so this is the only place the lab sees them.
  for (const [arch, label] of [["upper", "Maxillary"], ["lower", "Mandibular"]]) {
    const notes = asList(o[`${arch}AddOns`]).filter((a) => ADDON_NOTE[arch].includes(a));
    if (notes.length) lines.push(`${label} add-ons: ${notes.join(", ")}`);
  }
  return lines;
}
