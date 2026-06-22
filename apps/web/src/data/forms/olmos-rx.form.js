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

export const olmosRxForm = {
  slug: "olmos",
  jotformId: "233543911011141",
  title: "OLMOS - Orthodontic Rx.",
  route: "/app/rx/olmos",
  sections: [
    // ── order 1 — leading logo/map image (precedes first heading) ──
    {
      id: "intro",
      fields: [
        image("logoMapImage", "https://www.jotform.com/uploads/Diamondlab/form_files/logo-map2.60368729559715.79996309.png", {
          alt: "Diamond Orthotic Lab",
        }),
      ],
    },

    // ── qid 1 — CASE IDENTIFICATION ──
    {
      id: "caseIdentification",
      fields: [
        heading("CASE IDENTIFICATION"),
        // qid 56: widget (Todays Date localize_calendar) → date
        date("caseDate", "Date"),
        fullname("doctorName", "DOCTOR:", { required: true }),
        email("email", "Email Address", { required: true }),
        fullname("patientName", "PATIENT:", { required: true }),
        // qid 309: widget (checkboxInDropdown) → select
        select("firstDevice", "Is this the patients first device?", [
          "Yes",
          "No, use PREVIOUS RECORDS",
          "No, use NEW RECORDS",
        ], { required: true }),
      ],
    },

    // ── qid 296 — Remake/Repair/Redesign Request (collapse) ──
    {
      id: "remakeRequest",
      fields: [
        heading("Remake/Repair/Redesign Request"),
        date("dateReceived", "Date Received (INTERNAL USE ONLY)"),
        // qid 322: widget (textareaAutosize) → textarea
        textarea(
          "remakeExplanation",
          "Please explain in as much detail as possible, the nature of the defect/error: i.e. how did the device break? is there no retention on the upper arch? the lower? both?",
          { required: true },
        ),
        radio(
          "returnedOriginalModels",
          "Did you return the original models, bite and unalerted device to Diamond with 72 hours of remake claim? REQUIRED for all warranty claims.",
          ["Yes", "No"],
          { required: true },
        ),
        // qid 437: widget (fitText note) → static note
        note(
          'Please note: selecting "yes" without actually sending back the required information will forfeit Diamonds 25% courtesy remake discount.',
        ),
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
        checkbox("physicalDigitalRecords", "PHYSICAL AND/OR DIGITAL RECORDS", [
          "Physical Bite Registration",
          "PVS Impressions",
          "Stone/Resin Models",
          "3SHAPE",
          "CARESTREAM",
          "CEREC",
          "ITERO",
          "MEDIT",
          "MIDMARK",
          "ALL OTHER SCANNERS",
        ], { required: true }),
        radio("physicalBite", "Will you be sending a physical bite?", [
          "No - Start case now with digital bite",
          "Yes - Wait until physical bite is recieved",
          "Yes - Start case with digital bite; verify case with physical bite",
        ], { required: true }),
        fileUpload("uploadFiles", "Upload your files", {
          accept: "pdf,STL,doc,docx,xls,xlsx,csv,txt,rtf,html,zip,mp3,wma,mpg,flv,avi,jpg,jpeg,png,gif",
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
          "Memory Screw",
          "Slim-line 'V-Click'",
        ]),
        // qid 487: widget (imageCheckbox) → checkbox
        checkbox("fixedMandibularExpansion", "Fixed Mandibular Expansion (Only)", [
          "Mandibular Williams",
          "Mandibular Slim-line 'Variety Click' Expander",
          "Mandibular E-Arch",
        ]),
        // qid 496: widget (imageCheckbox) → checkbox
        checkbox("removableMandibularExpansion", "Removable Mandibular Expansion (Only)", [
          "Mandibular Schwarz",
          "Mandibular Memory Screw",
          "Mandibular Slim-line",
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
