/**
 * The orthodontic appliance questions — the ONE definition of them.
 *
 * The orthodontic Rx form (ortho-rx.form.js) composes these sections; nothing
 * else may restate them. The appliance resolver
 * (apps/api/src/services/rx/catalog-map/resolvers/ortho.js) keys on these field
 * keys and option values via the shared adapter in
 * packages/shared/src/rx/form-devices.js, and a cross-package coverage test
 * reads the options straight out of this module — so renaming an option here
 * without teaching the resolver about it fails a test instead of silently
 * holding every order that picks it.
 *
 * History: these were a standalone JotForm port, then folded into the digital
 * Rx as a ninth gated device (Aug 2026), then split back out as their own form
 * at the lab's request (Oct 2026). The sections carry no device gate.
 */

import { radio, checkbox, text, textarea, email, matrix, image, artboard, imgOpt } from "./form-fields.js";

const ORTHO_ARTBOARD_BG = "https://i.ibb.co/yqsycC6/ortho-img.png";
const ORTHO_ARTBOARD_LABEL =
  "Please use the artboard below to illustrate the design of your appliance.";
const ORTHO_DESIGN_DRAW_LABEL =
  "Check this box if you would like to design (draw) your appliance; this option is preferred";

/** Ortho-only questions about the records, appended to the shared Case Submission section. */
export const ORTHO_RECORDS_FIELDS = [
  // Head qid 119 (records / device intro).
  // qid 503 in the archived snapshot (orthodontic + olmos + rx-2025
  // JSON — all three agree) is a JotForm "Dynamic" matrix
  // (inputType: "Dynamic", mrows: "") — the respondent adds their own
  // rows client-side; there is no fixed row set to restore. Our
  // MatrixField has no add-row affordance, so `rows: []` rendered zero
  // inputs and made this field (and digitalSetupEmail, gated on it
  // being answered) permanently unreachable. GUESS pending lab
  // confirmation: added one generic row so the field is at least
  // fillable — the label "Setup Instructions" is a placeholder, not a
  // clinical option pulled from any source.
  matrix(
    "nuveloDigitalSetup",
    "NUVELO Digital Setup ONLY",
    ["Setup Instructions"],
    [
      "Orient to HIP",
      "Add occlusal overlay to bite",
      "Occlusal coverage on teeth #'s:",
      "Other",
    ]
  ),
  radio(
    "digitalStudyModels",
    "Digital 'Study' Models",
    [
      "Digital Models ONLY - Horse-shoe base",
      "Digital Models ONLY - ABO - Full Base",
    ]
  ),
  email(
    "digitalSetupEmail",
    "Email to submit digital setup once completed:",
    {
      // No point asking where to send a setup nobody ordered.
      showIf: { key: "nuveloDigitalSetup", answered: true },
    }
  ),
];

/** The three appliance sections: dual-arch (tandem / twin block), upper only, lower only. */
export const ORTHO_SECTIONS = [
  // ---- Functional Orthodontics - Dual Arch (collapse qid 499, ex-ortho) --
  {
    id: "functionalDualArch",
    heading: "Functional Orthodontics - Dual Arch",
    fields: [
      radio("selectDevice", "Select Device", ["Modified Tandem", "Twin Block"]),
      // No Twin Block equivalent diagram exists — only relevant once the
      // doctor has actually selected Modified Tandem.
      image(
        "imgModifiedTandem",
        "/images/rx/ortho/modified-tandem-diagram.png",
        "MODIFIED TANDEM",
        { showIf: { key: "selectDevice", equals: "Modified Tandem" } }
      ),
      radio("upperArchRetention", "UPPER arch retention and base material:", [
        "Fixed (Banded)",
        "Fixed [3D Printed] Bands",
        "Acrylic w/ clasp retention",
        "Printed NYLON w/ composite retention",
      ]),
      radio("upperExpansionType", "UPPER Expansion type:", [
        "No Expansion",
        "Slim-Line Screw",
        "Standard Transverse Screw",
        'Slim-line "Variety-Click" (Fixed ONLY)',
        "Memory Screw (Fixed ONLY)",
        "Standard Hyrax RPE (Fixed ONLY)",
        "NiTi - Nickel Titanium (Fixed ONLY)",
      ], {
        // The four "(Fixed ONLY)" options are contradictory once
        // upperArchRetention is a removable type.
        disableOptionsIf: [
          {
            when: {
              key: "upperArchRetention",
              oneOf: ["Acrylic w/ clasp retention", "Printed NYLON w/ composite retention"],
            },
            options: [
              'Slim-line "Variety-Click" (Fixed ONLY)',
              "Memory Screw (Fixed ONLY)",
              "Standard Hyrax RPE (Fixed ONLY)",
              "NiTi - Nickel Titanium (Fixed ONLY)",
            ],
          },
        ],
      }),
      radio("lowerArchRetention", "Lower arch retention and base material:", [
        "Fixed (Banded)",
        "Fixed [3D Printed] Bands",
        "Acrylic w/ clasp retention",
        "Printed NYLON w/ composite retention",
      ]),
      radio("mxSelections", "Mx. Selections", [
        "Fixed (Banded)",
        "Removable (Clasp-Retention)",
      ]),
      radio("lowerExpansionType", "Lower Expansion type:", [
        "No Expansion",
        "Slim-Line Screw",
        "Standard Transverse Screw",
        'Slim-line "Variety-Click"',
        "Memory Screw (Removable Only)",
      ], {
        // "Memory Screw (Removable Only)" is contradictory once
        // lowerArchRetention is a fixed type.
        disableOptionsIf: [
          {
            when: {
              key: "lowerArchRetention",
              oneOf: ["Fixed (Banded)", "Fixed [3D Printed] Bands"],
            },
            options: ["Memory Screw (Removable Only)"],
          },
        ],
      }),
      matrix(
        "requiredSelection",
        "Required Selection",
        ["Maxillary", "Mandibular"],
        [
          "Acrylic coverage on:",
          "Occlusal rest on:",
          "Composite build up on:",
          "Place bands on:",
        ]
      ),
      // qid 252: inline (short text + radio composed template). A Twin
      // Block has no tandem bow, so this is meaningless outside Modified
      // Tandem.
      text(
        "tandemBowSetting",
        "Set tandem bow ___ mm from incisal edge of lower anterior teeth. (Lipskis Bow)",
        { showIf: { key: "selectDevice", equals: "Modified Tandem" } }
      ),
      image(
        "imgTandemLength",
        "/images/rx/ortho/tandem-length-reference.png",
        "Tandem length reference"
      ),
      checkbox("addToMaxillary", "Add to Maxillary:", [
        "Buccal tubes to bands",
        "Palatal pads",
        "Anterior lap springs",
        "Buccal hooks for tandem elastics",
        "Lingual guide arm to canines",
        "Lingual guide arm (distal)",
        "Labial bow",
        "Transfer tray for composite buttons",
        "Occlusal Rest(s)",
      ]),
      checkbox("addToMandibular", "Add to Mandibular:", [
        "Buccal tubes to bands",
        "Headgear tubes for tandem to bands",
        "Occlusal Rest(s)",
        "Anterior lap springs",
        "Lingual guide arm (distal)",
        "Labial bow",
        "Transfer tray for composite buttons",
        "Sheaths for Tandem Bow (Removable)",
      ]),
      matrix(
        "occlusalOptionsTandem",
        "Occlusal Options for tandem bow",
        ["Maxillary", "Mandibular", "Other"],
        [
          "Occlusal coverage on:",
          "Occlusal rest on:",
          "Composite build up on:",
          "Other",
        ],
        { showIf: { key: "selectDevice", equals: "Modified Tandem" } }
      ),
      textarea("dualArchComments", "Additional Comments/Instructions"),
      checkbox("dualArchDesignDraw", ORTHO_DESIGN_DRAW_LABEL, ["Diamond ORTHO Artboard"]),
      // qid 513: widget (drawOnImage artboard)
      artboard("dualArchArtboard", ORTHO_ARTBOARD_LABEL, {
        src: ORTHO_ARTBOARD_BG,
        showIf: { key: "dualArchDesignDraw", includes: "Diamond ORTHO Artboard" },
      }),
    ],
  },

  // ---- MAXILLARY (UPPER) Only SELECTION (collapse qid 154, ex-ortho) -----
  {
    id: "maxillaryUpper",
    heading: "MAXILLARY (UPPER) Only SELECTION",
    fields: [
      matrix(
        "upperExpansionSelection",
        "UPPER- Expansion Option Selection:",
        [
          "Transverse Schwarz",
          "Sagittal Schwarz",
          "Quad Helix",
          "NiTi",
          "A.L.F.",
          "3-Way Screw",
          "Hyrax RPE",
          "HAAS RPE",
          '"W" Expansion',
          "TPA",
          "Other",
        ],
        [
          "FIXED",
          "REMOVABLE",
          "Lingual Guide Wire",
          "Clasp Selection",
          "Expansion Screw",
          "Occlusal coverage on:",
          "Occlusal rest on:",
          "Composite build up on [TURBOS]:",
          "Base Material",
          "Other",
        ]
      ),
      // NOTE: this and imgMandibularReference (mandibularLower section,
      // below) point at the SAME source image in the JotForm snapshot
      // ("Untitled-1.604c0641ecde48.53101509.png"). Rescued as one local
      // file referenced from both fields, unchanged from the snapshot —
      // but one of the two placements may be the wrong diagram; that's a
      // question for the lab, not something to guess at here.
      image(
        "imgMaxillaryReference",
        "/images/rx/ortho/arch-reference-diagram.png",
        "Maxillary reference"
      ),
      checkbox("maxillaryAdd", "Add:", [
        "Buccal tubes to bands",
        "Palatal pads",
        "Anterior lap springs",
        "Buccal hooks for tandem elastics",
        "Labial bow",
        "Lingual guide arm (to canine)",
        "Acrylic labial bow",
        "Lingual guide arm (distal)",
        "Transfer tray for composite buttons",
      ]),
      checkbox("maxillaryDesignDraw", ORTHO_DESIGN_DRAW_LABEL, ["Diamond ORTHO Artboard"]),
      // qid 472: widget (drawOnImage artboard)
      artboard("maxillaryArtboard", ORTHO_ARTBOARD_LABEL, {
        src: ORTHO_ARTBOARD_BG,
        showIf: { key: "maxillaryDesignDraw", includes: "Diamond ORTHO Artboard" },
      }),
      textarea("maxillaryComments", "Additional Comments/Instructions"),
    ],
  },

  // ---- MANDIBULAR (LOWER) Only SELECTION (collapse qid 120, ex-ortho) ----
  {
    id: "mandibularLower",
    heading: "MANDIBULAR (LOWER) Only SELECTION",
    fields: [
      matrix(
        "lowerExpansionSelection",
        "LOWER- Expansion Option Selection",
        [
          "Transverse Schwarz",
          "Sagittal Schwarz",
          "E-Arch",
          "Williams Expander",
          "A.L.F.",
          "3-Way Screw",
          "TPA",
          "Other",
        ],
        [
          "FIXED",
          "REMOVABLE",
          "Lingual Guide Wire",
          "Clasp Selection",
          "Expansion Screw",
          "Acrylic Overlay on:",
          "Occlusal rest on:",
          "Composite build up on [TURBOS]:",
          "Select Base Material",
          "Other",
        ]
      ),
      // qid 496: widget (image checkbox, single select). Lower arch
      // retention's last two options ("Acrylic w/ clasp retention",
      // "Printed NYLON w/ composite retention") are removable; the first
      // two ("Fixed (Banded)", "Fixed [3D Printed] Bands") are fixed.
      checkbox("removableMandibularExpansion", "Removable Mandibular Expansion (Only)", [
        imgOpt(
          "Mandibular Schwarz",
          "https://diamondorthoticlab.com/wp-content/uploads/2023/05/mandibular-schwartz.jpg"
        ),
        imgOpt(
          "Mandibular Memory Screw",
          "https://diamondorthoticlab.com/wp-content/uploads/2023/05/mandibular-memory.jpg"
        ),
        imgOpt(
          "Mandibular Slim-line",
          "https://diamondorthoticlab.com/wp-content/uploads/2023/05/lower-fixed-expander.jpg"
        ),
      ], {
        showIf: {
          key: "lowerArchRetention",
          oneOf: ["Acrylic w/ clasp retention", "Printed NYLON w/ composite retention"],
        },
      }),
      // qid 487: widget (image checkbox, single select)
      checkbox("fixedMandibularExpansion", "Fixed Mandibular Expansion (Only)", [
        imgOpt(
          "Mandibular Williams",
          "https://diamondorthoticlab.com/wp-content/uploads/2023/05/j.i-williams-expander.jpg"
        ),
        imgOpt(
          "Mandibular Slim-line 'Variety Click' Expander",
          "https://diamondorthoticlab.com/wp-content/uploads/2023/05/lower-fixed-expander.jpg"
        ),
        imgOpt(
          "Mandibular E-Arch",
          "https://diamondorthoticlab.com/wp-content/uploads/2023/05/e-arch-lower.jpg"
        ),
      ], {
        showIf: {
          key: "lowerArchRetention",
          oneOf: ["Fixed (Banded)", "Fixed [3D Printed] Bands"],
        },
      }),
      // See imgMaxillaryReference (maxillaryUpper section, above) — same
      // source file, rescued once and referenced from both.
      image(
        "imgMandibularReference",
        "/images/rx/ortho/arch-reference-diagram.png",
        "Mandibular reference"
      ),
      checkbox("mandibularAdd", "Add:", [
        "Buccal tubes to bands",
        "Anterior lap springs",
        "Labial bow",
        "Acrylic labial bow",
        "Lingual guide arm (distal)",
        "Add buccal sheath for tandem bow",
        "Transfer tray for composite buttons",
        "Finger Springs (please specify tooth location)",
      ]),
      checkbox("mandibularDesignDraw", ORTHO_DESIGN_DRAW_LABEL, ["Diamond ORTHO Artboard"]),
      // qid 42: widget (drawOnImage artboard)
      artboard("mandibularArtboard", ORTHO_ARTBOARD_LABEL, {
        src: ORTHO_ARTBOARD_BG,
        showIf: { key: "mandibularDesignDraw", includes: "Diamond ORTHO Artboard" },
      }),
      textarea("orthoDesignComments", "Additional Comments for ORTHO Design"),
    ],
  },
];
