/**
 * OLMOS - Orthodontic Rx. — faithful 1:1 port of JotForm 233543911011141.
 *
 * Ported field-for-field from
 *   docs/rx-forms/jotform-api/olmos-233543911011141-questions.json
 * sorted by integer `order`, with a new section at every
 * control_head / control_pagebreak / control_collapse boundary.
 *
 * Notes on faithful porting decisions:
 *   - JotForm "control_widget" fields have no native equivalent; each is mapped
 *     to the closest supported field type and tagged with a `// qid <n>: widget`
 *     comment naming the original widget.
 *   - Several source fields are flagged `hidden: "Yes"` in JotForm because they
 *     are revealed by conditional logic. The ones that carry meaningful,
 *     contract-required labels (Date, Due Date Requested, RUSH case request,
 *     the draw-on-image artboards, etc.) are retained so the form stays fillable;
 *     purely decorative hidden images / layout helpers are omitted.
 *   - The drawOnImage widgets ("Please use the artboard…") are mapped to the
 *     native `artboard` field type. The "design (draw) your appliance" checkbox
 *     is kept as a checkbox, matching the source.
 *   - MX / MD terminology is preserved verbatim (not rewritten to
 *     Maxillary / Mandibular) on the OLMOS-specific fields.
 *
 * OLMOS has NO contact-phone / address block, so the shared `idBlock()` helper
 * is intentionally not reused here — the identification fields are authored
 * directly from the snapshot for parity.
 */

import {
  radio,
  checkbox,
  select,
  textarea,
  date,
  heading,
  note,
  fullname,
  email,
  fileUpload,
  signature,
  matrix,
} from "./form-fields.js";

// No image()/artboard() builders exist in form-fields.js — author plain objects
// matching the canonical field contract (both types are presentational/native).
const image = (key, src, opts = {}) => ({ type: "image", key, src, ...opts });
const artboard = (key, label, opts = {}) => ({ type: "artboard", key, label, ...opts });
// Image-bearing option: keeps `value` canonical, pairs a tasteful image card.
const imgOpt = (value, image) => ({ value, label: value, image });

const DOCTOR_NOTE =
  "<strong>Doctor:</strong> Matt Rago · Account 1324 <span style='opacity:.6'>(auto-filled from your account)</span>";

// Records-method picker images (JotForm qid 86 imagePicker items).
const RECORDS_OPTIONS = [
  imgOpt(
    "Physical Bite Registration",
    "https://www.jotform.com/uploads/Diamondlab/form_files/bite_150.6036753edaecb2.18416798.png",
  ),
  imgOpt(
    "PVS Impressions",
    "https://www.jotform.com/uploads/Diamondlab/form_files/PVS_150.603674f9e5d079.99098994.png",
  ),
  imgOpt(
    "Stone/Resin Models",
    "https://www.jotform.com/uploads/Diamondlab/form_files/model_150.603674dc4347d4.50993365.png",
  ),
  imgOpt(
    "3SHAPE",
    "https://www.jotform.com/uploads/Diamondlab/form_files/3shape_.603677d2e93303.20086588.png",
  ),
  imgOpt(
    "CARESTREAM",
    "https://www.jotform.com/uploads/Diamondlab/form_files/carestream_.603677dee1f5a9.76960426.png",
  ),
  imgOpt(
    "CEREC",
    "https://www.jotform.com/uploads/Diamondlab/form_files/cerec_.6036781230e490.29102641.png",
  ),
  imgOpt(
    "ITERO",
    "https://www.jotform.com/uploads/Diamondlab/form_files/itero_.6036781e5dbe09.92263476.png",
  ),
  imgOpt(
    "MEDIT",
    "https://www.jotform.com/uploads/Diamondlab/form_files/medit_.60367827341479.40523658.png",
  ),
  imgOpt(
    "MIDMARK",
    "https://www.jotform.com/uploads/Diamondlab/form_files/midmark_.603678309a3864.60022150.png",
  ),
  imgOpt(
    "ALL OTHER SCANNERS",
    "https://www.jotform.com/uploads/Diamondlab/form_files/all.603679f333eaa7.69711684.png",
  ),
];

export const olmosRxForm = {
  slug: "olmos",
  jotformId: "233543911011141",
  title: "OLMOS - Orthodontic Rx.",
  route: "/app/rx/olmos",
  sections: [
    // ── qid 1 — CASE IDENTIFICATION ──
    {
      id: "caseIdentification",
      fields: [
        heading("CASE IDENTIFICATION"),
        // Doctor identity is taken from the signed-in account — no manual entry.
        note(DOCTOR_NOTE),
        // qid 56: widget (Todays Date localize_calendar) → date
        date("caseDate", "Date"),
        fullname("patientName", "PATIENT:", { required: true }),
        // qid 309: widget (checkboxInDropdown) → select
        select("firstDevice", "Is this the patients first device?", [
          "Yes",
          "No, use PREVIOUS RECORDS",
          "No, use NEW RECORDS",
        ], { required: true }),
      ],
    },

    // ── qid 330 — Please note: (head) ──
    {
      id: "pleaseNote",
      fields: [
        heading("Please note:"),
        note(
          'All "no cost" warranty, remake, and repair claims require the original bite, models and unaltered device to be returned to Diamond for evaluation. If the patient is unable to tolerate the absence of their device, Diamond will offer a 25% courtesy discount for the remake.',
        ),
      ],
    },

    // ── qid 312 (pagebreak) → qid 81 — CASE SUBMISSION ──
    {
      id: "caseSubmission",
      fields: [
        heading("CASE SUBMISSION"),
        note("PLEASE SELECT HOW YOU WILL BE SENDING RECORDS FOR THIS PATIENT"),
        // qid 86: widget (imagePicker) → checkbox (multi-select, source limit 3)
        checkbox(
          "physicalDigitalRecords",
          "PHYSICAL AND/OR DIGITAL RECORDS",
          RECORDS_OPTIONS,
          { required: true },
        ),
        radio("physicalBite", "Will you be sending a physical bite?", [
          "No - Start case now with digital bite",
          "Yes - Wait until physical bite is recieved",
          "Yes - Start case with digital bite; verify case with physical bite",
        ], { required: true }),
        fileUpload("uploadFiles", "Upload your files", {
          accept: ".stl,.pdf,.jpg,.jpeg,.png,.gif,.zip,.doc,.docx,.xls,.xlsx,.csv,.txt",
        }),
      ],
    },

    // ── qid 91 (pagebreak) → qid 119 — empty head (digital setup) ──
    {
      id: "digitalSetup",
      fields: [
        // qid 503: matrix (mrows empty in source) — cols from dcolumns
        matrix("nuveloDigitalSetup", "NUVELO Digital Setup ONLY", [], [
          "Orient to HIP",
          "Add occlusal overlay to bite",
          "Occlusal coverage on teeth #'s:",
          "Other",
        ]),
        email("digitalSetupEmail", "Email to submit digital setup once completed:"),
      ],
    },

    // ── qid 499 — Functional Orthodontics - Dual Arch (collapse) ──
    {
      id: "functionalDualArch",
      fields: [
        heading("Functional Orthodontics - Dual Arch"),
        radio("selectDevice", "Select Device", ["Modified Tandem", "Twin-Block"]),
        image("tandemImage", "https://www.jotform.com/uploads/Diamondlab/form_files/tandem.64c15648dcbe62.63375354.6526b51a539c04.55985396.png", {
          alt: "Modified Tandem",
        }),
        radio("upperArchRetention", "Upper arch retention and base material:", [
          "Fixed (Banded) - STANDARD OPTION",
          "Acrylic w/ clasp retention",
          "Printed BIOMED w/ composite retention",
          "Printed NYLON w/ composite retention",
        ]),
        radio("lowerArchRetention", "Lower arch retention and base material:", [
          "Acrylic w/ clasp retention",
          "Printed BIOMED w/ composite retention",
          "Printed NYLON w/ composite retention",
          "Fixed (Banded)",
        ]),
        radio("mxExpansionType", "Mx. Expansion type:", [
          "No Expansion",
          "Memory Screw",
          "Standard Schwarz",
          'Slim-line "Variety-Click"',
          "Standard Hyrax RPE",
        ]),
        radio("mdExpansionType", "Md. Expansion type:", [
          "No Expansion",
          "Memory Screw",
          "Standard Schwarz",
          'Slim-line "Variety-Click"',
        ]),
        // qid 477: cols from dcolumns
        matrix("dualArchFunctional", "Dual-Arch Functional Options", [
          "Maxillary",
          "Mandibular",
          "Other",
        ], [
          "FIXED",
          "REMOVABLE",
          "Clasp Selection",
          "Expansion type:",
          "Occlusal coverage on:",
          "Occlusal rest on:",
          "Composite build up on:",
          "Other",
        ]),
        checkbox("addMxArch", "Add to MX Arch:", [
          "Buccal tubes to bands",
          "Palatal pads",
          "Anterior lap springs",
          "Buccal hooks for tandem elastics",
          "Labial bow",
          "Lingual guide arm (to canine)",
          "Acrylic labial bow",
          "Lingual guide arm (distal)",
          "Transfer tray for composite buttons",
          "Sheaths for Tandem Hooks",
          "Finger Springs (please specify tooth location)",
        ]),
        checkbox("addMdArch", "Add to MD Arch", [
          "Buccal tubes to bands",
          "Labial bow",
          "Acrylic labial bow",
          "Lingual guide arm (distal)",
          "Add buccal sheath for tandem bow",
          "Transfer tray for composite buttons",
          "Finger Springs (please specify tooth location)",
        ]),
        textarea("dualArchComments", "Additional Comments/Instructions"),
        checkbox(
          "dualArchDraw",
          "Check this box if you would like to design (draw) your appliance; this option is preferred",
          ["Diamond ORTHO Artboard"],
        ),
        // qid 472: widget (drawOnImage) → artboard
        artboard("olmosArtboard", "Please use the artboard below to illustrate the design of your appliance.", {
          src: "https://i.ibb.co/yqsycC6/ortho-img.png",
        }),
        // qid 484: widget (imageCheckbox) → checkbox
        checkbox("fixedMaxillaryExpansion", "Fixed Maxillary Expansion (Only):", [
          imgOpt(
            "Memory Screw",
            "https://diamondorthoticlab.com/wp-content/uploads/2023/05/memory-screw.jpg",
          ),
          imgOpt(
            "Slim-line 'V-Click'",
            "https://diamondorthoticlab.com/wp-content/uploads/2023/05/mini-hyrax-rpe.jpg",
          ),
        ]),
        // qid 487: widget (imageCheckbox) → checkbox
        checkbox("fixedMandibularExpansion", "Fixed Mandibular Expansion (Only)", [
          imgOpt(
            "Mandibular Williams",
            "https://diamondorthoticlab.com/wp-content/uploads/2023/05/j.i-williams-expander.jpg",
          ),
          imgOpt(
            "Mandibular Slim-line 'Variety Click' Expander",
            "https://diamondorthoticlab.com/wp-content/uploads/2023/05/lower-fixed-expander.jpg",
          ),
          imgOpt(
            "Mandibular E-Arch",
            "https://diamondorthoticlab.com/wp-content/uploads/2023/05/e-arch-lower.jpg",
          ),
        ]),
        // qid 496: widget (imageCheckbox) → checkbox
        checkbox("removableMandibularExpansion", "Removable Mandibular Expansion (Only)", [
          imgOpt(
            "Mandibular Schwarz",
            "https://diamondorthoticlab.com/wp-content/uploads/2023/05/mandibular-schwartz.jpg",
          ),
          imgOpt(
            "Mandibular Memory Screw",
            "https://diamondorthoticlab.com/wp-content/uploads/2023/05/mandibular-memory.jpg",
          ),
          imgOpt(
            "Mandibular Slim-line",
            "https://diamondorthoticlab.com/wp-content/uploads/2023/05/lower-fixed-expander.jpg",
          ),
        ]),
      ],
    },

    // ── qid 154 — MAXILLARY (UPPER) APPLIANCE SELECTION (collapse) ──
    {
      id: "maxillaryUpper",
      fields: [
        heading("MAXILLARY (UPPER) APPLIANCE SELECTION"),
        matrix("upperExpansionSelection", "UPPER- Expansion Option Selection:", [
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
        ], [
          "FIXED",
          "REMOVABLE",
          "Lingual Guide Wire",
          "Clasp Selection",
          "Expansion Screw",
          "Occlusal coverage on:",
          "Occlusal rest on:",
          "Composite build up on:",
          "Base Material",
          "Other",
        ]),
        image("upperApplianceImage", "https://www.jotform.com/uploads/Diamondlab/form_files/Untitled-1.604c0641ecde48.53101509.png"),
        checkbox("upperAdd", "Add:", [
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
        checkbox(
          "upperDraw",
          "Check this box if you would like to design (draw) your appliance; this option is preferred",
          ["Diamond ORTHO Artboard"],
        ),
        // qid 509: widget (drawOnImage) → artboard
        artboard("olmosArtboard2", "Please use the artboard below to illustrate the design of your appliance.", {
          src: "https://i.ibb.co/yqsycC6/ortho-img.png",
        }),
        textarea("upperComments", "Additional Comments/Instructions"),
      ],
    },

    // ── qid 120 — MANDIBULAR (LOWER) APPLIANCE SELECTION (collapse) ──
    {
      id: "mandibularLower",
      fields: [
        heading("MANDIBULAR (LOWER) APPLIANCE SELECTION"),
        matrix("lowerExpansionSelection", "LOWER- Expansion Option Selection", [
          "Transverse Schwarz",
          "Sagittal Schwarz",
          "E-Arch",
          "Williams Expander",
          "A.L.F.",
          "3-Way Screw",
          "TPA",
          "Other",
        ], [
          "FIXED",
          "REMOVABLE",
          "Lingual Guide Wire",
          "Clasp Selection",
          "Expansion Screw",
          "Occlusal coverage on:",
          "Occlusal rest on:",
          "Composite build up on:",
          "Select Base Material",
          "Other",
        ]),
        image("lowerApplianceImage", "https://www.jotform.com/uploads/Diamondlab/form_files/Untitled-1.604c0641ecde48.53101509.png"),
        checkbox("lowerAdd", "Add:", [
          "Buccal tubes to bands",
          "Anterior lap springs",
          "Labial bow",
          "Acrylic labial bow",
          "Lingual guide arm (distal)",
          "Add buccal sheath for tandem bow",
          "Transfer tray for composite buttons",
          "Finger Springs (please specify tooth location)",
        ]),
        checkbox(
          "lowerDraw",
          "Check this box if you would like to design (draw) your appliance; this option is preferred",
          ["Diamond ORTHO Artboard"],
        ),
        // qid 42: widget (drawOnImage) → artboard
        artboard("olmosArtboard3", "Please use the artboard below to illustrate the design of your appliance.", {
          src: "https://i.ibb.co/yqsycC6/ortho-img.png",
        }),
        textarea("orthoDesignComments", "Additional Comments for ORTHO Design"),
      ],
    },

    // ── qid 35 (pagebreak) → SUBMIT FORM page ──
    {
      id: "submitForm",
      fields: [
        date("dueDate", "Due Date Requested"),
        note("Typical turnaround is ~2 weeks; rush options available."),
        signature("doctorSignature", "Doctor Signature", { required: true }),
        checkbox("rushCase", "Would you like to rush this case?", ["Yes"]),
        // qid 337: widget (sliders, BIOMED/PMT/ACRYLIC rush charge) → select
        select("rushChargeBiomed", "RUSH case request:", [
          "No Rush",
          "Standard",
          "Expedited",
        ]),
        // qid 335: widget (sliders, NYLON rush charge) → select
        select("rushChargeNylon", "RUSH case request:", [
          "No Rush",
          "Standard",
          "Expedited",
          "Max Rush",
        ]),
        // qid 141: widget (textareaAutosize) → textarea
        textarea("additionalCommentsNote", "Additional Comments", {
          note: "**Note** Writing device selection in this area will delay your case! This area is not for device selection.",
        }),
      ],
    },
  ],
};
