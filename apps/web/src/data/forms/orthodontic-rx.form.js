/**
 * Diamond Orthodontic Rx. — faithful 1:1 port of JotForm 213545611846154.
 *
 * Source snapshot: docs/rx-forms/jotform-api/orthodontic-213545611846154-questions.json
 *
 * Porting notes:
 *  - Questions are ordered by the JotForm integer `order`; a new section starts
 *    at each control_head / control_pagebreak / control_collapse (its `text`
 *    becomes the section heading; `subHeader` becomes the section `note`).
 *  - Several fields are flagged `hidden:"Yes"` in JotForm because they are
 *    revealed by builder conditions (not exported in this snapshot). They are
 *    genuine form fields, so they are ported faithfully here.
 *  - control_widget fields are simplified to the nearest native field type and
 *    carry a `// qid <n>: widget` comment citing the source question.
 *  - control_matrix columns are taken from the dynamic-matrix `dcolumns`
 *    definitions (the real column labels); rows come from `mrows`. The leftover
 *    `mcolumns` ("UPPER|LOWER|Very Satisfied") is a stale rating template and is
 *    intentionally ignored.
 *  - The "design (draw) your appliance" drawOnImage widgets are modeled as
 *    `artboard` fields (Diamond ORTHO artboard background).
 *  - control_button, empty control_divider, empty/navigation control_widget
 *    (form tabs, PDF embed, fixed-format, android image), and purely decorative
 *    hidden images are omitted.
 */

import {
  radio,
  checkbox,
  select,
  text,
  textarea,
  date,
  note,
  fullname,
  email,
  phone,
  address,
  fileUpload,
  signature,
  matrix,
} from "./form-fields.js";

// Local builders for field types without a form-fields.js helper.
const image = (src, alt = "") => ({ type: "image", src, alt });
const artboard = (key, label, opts = {}) => ({
  type: "artboard",
  key,
  label,
  ...opts,
});

const ARTBOARD_BG = "https://i.ibb.co/yqsycC6/ortho-img.png";
const ARTBOARD_LABEL =
  "Please use the artboard below to illustrate the design of your appliance.";
const DESIGN_DRAW_LABEL =
  "Check this box if you would like to design (draw) your appliance; this option is preferred";

export const orthodonticRxForm = {
  slug: "ortho",
  jotformId: "213545611846154",
  title: "Diamond Orthodontic Rx.",
  route: "/app/rx/ortho",
  sections: [
    // ── CASE IDENTIFICATION (head qid 1) ──
    {
      id: "caseIdentification",
      heading: "CASE IDENTIFICATION",
      fields: [
        image(
          "https://www.jotform.com/uploads/Diamondlab/form_files/logo-map2.60368729559715.79996309.png",
          "Diamond Orthotic Lab",
        ),
        // qid 56: widget (auto-populated Today's Date calendar)
        date("caseDate", "Date"),
        fullname("doctorName", "DOCTOR:", { required: true }),
        email("email", "Email Address", { required: true }),
        fullname("patientName", "PATIENT:", { required: true }),
        // qid 309: widget (checkbox-in-dropdown, single select)
        select(
          "firstDevice",
          "Is this the patients first device?",
          ["Yes", "No, use PREVIOUS RECORDS", "No, use NEW RECORDS"],
          { required: true },
        ),
        phone("contactPhone", "CONTACT:"),
        address("address", "ADDRESS: (If different than address on account form)"),
      ],
    },

    // ── Remake/Repair/Redesign Request (collapse qid 296) ──
    {
      id: "remakeRequest",
      heading: "Remake/Repair/Redesign Request",
      fields: [
        date("dateReceived", "Date Received (INTERNAL USE ONLY)"),
        // qid 322: widget (textarea autosize)
        textarea(
          "remakeExplanation",
          "Please explain in as much detail as possible, the nature of the defect/error: i.e. how did the device break? is there no retention on the upper arch? the lower? both?",
          { required: true },
        ),
        radio(
          "returnedOriginals",
          "Did you return the original models, bite and unalerted device to Diamond with 72 hours of remake claim? REQUIRED for all warranty claims.",
          ["Yes", "No"],
          { required: true },
        ),
        // qid 437: widget (Note:Text)
        note(
          'Please note: selecting "yes" without actually sending back the required information will forfeit Diamonds 25% courtesy remake discount.',
        ),
      ],
    },

    // ── Please note: (head qid 330) ──
    {
      id: "pleaseNote",
      heading: "Please note:",
      fields: [
        note(
          'All "no cost" warranty, remake, and repair claims require the original bite, models and unaltered device to be returned to Diamond for evaluation. If the patient is unable to tolerate the absence of their device, Diamond will offer a 25% courtesy discount for the remake.',
        ),
      ],
    },

    // ── CASE SUBMISSION (head qid 81) ──
    {
      id: "caseSubmission",
      heading: "CASE SUBMISSION",
      note: "PLEASE SELECT HOW YOU WILL BE SENDING RECORDS FOR THIS PATIENT",
      fields: [
        // qid 86: widget (image picker, max 3 selections)
        checkbox(
          "recordsType",
          "PHYSICAL AND/OR DIGITAL RECORDS",
          [
            "Physical Bite Registration",
            "PVS Impressions",
            "Stone/Resin Models",
            "3SHAPE",
            "CARESTREAM",
            "CEREC",
            "ITERO",
            "MEDIT",
            "MIDMARK",
            "SHINING 3D",
            "PLANMECA",
            "ALL OTHER SCANNERS",
          ],
          { required: true },
        ),
        radio(
          "sendingPhysicalBite",
          "Will you be sending a physical bite?",
          [
            "No - Start case now with digital bite",
            "Yes - Wait until physical bite is recieved",
          ],
          { required: true },
        ),
        fileUpload("uploadFiles", "Upload your files", {
          accept: ".pdf,.STL,.doc,.docx,.xls,.xlsx,.csv,.txt,.rtf,.html,.zip,.jpg,.jpeg,.png,.gif",
        }),
      ],
    },

    // ── ORTHO records / device intro (head qid 119, ORTHO logo, no text) ──
    {
      id: "orthoRecords",
      fields: [
        matrix(
          "nuveloDigitalSetup",
          "NUVELO Digital Setup ONLY",
          [],
          [
            "Orient to HIP",
            "Add occlusal overlay to bite",
            "Occlusal coverage on teeth #'s:",
            "Other",
          ],
        ),
        radio("digitalStudyModels", "Digital 'Study' Models", [
          "Digital Models ONLY - Horse-shoe base",
          "Digital Models ONLY - ABO - Full Base",
        ]),
        email("digitalSetupEmail", "Email to submit digital setup once completed:"),
      ],
    },

    // ── Functional Orthodontics - Dual Arch (collapse qid 499) ──
    {
      id: "functionalDualArch",
      heading: "Functional Orthodontics - Dual Arch",
      fields: [
        radio("selectDevice", "Select Device", ["Modified Tandem", "Twin Block"]),
        image(
          "https://www.jotform.com/uploads/Diamondlab/form_files/tandem.64c15648dcbe62.63375354.6526b51a539c04.55985396.png",
          "MODIFIED TANDEM",
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
        ]),
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
        ]),
        matrix(
          "requiredSelection",
          "Required Selection",
          ["Maxillary", "Mandibular"],
          [
            "Acrylic coverage on:",
            "Occlusal rest on:",
            "Composite build up on:",
            "Place bands on:",
          ],
        ),
        // qid 252: inline (short text + radio composed template)
        text(
          "tandemBowSetting",
          "Set tandem bow ___ mm from incisal edge of lower anterior teeth. (Lipskis Bow)",
        ),
        image(
          "https://www.jotform.com/uploads/Diamondlab/form_files/tandem_length.6050f23672bf51.92273108.png",
          "Tandem length reference",
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
        ),
        textarea("dualArchComments", "Additional Comments/Instructions"),
        checkbox("dualArchDesignDraw", DESIGN_DRAW_LABEL, ["Diamond ORTHO Artboard"]),
        // qid 513: widget (drawOnImage artboard)
        artboard("dualArchArtboard", ARTBOARD_LABEL, { src: ARTBOARD_BG }),
      ],
    },

    // ── MAXILLARY (UPPER) Only SELECTION (collapse qid 154) ──
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
          ],
        ),
        image(
          "https://www.jotform.com/uploads/Diamondlab/form_files/Untitled-1.604c0641ecde48.53101509.png",
          "Maxillary reference",
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
        checkbox("maxillaryDesignDraw", DESIGN_DRAW_LABEL, ["Diamond ORTHO Artboard"]),
        // qid 472: widget (drawOnImage artboard)
        artboard("maxillaryArtboard", ARTBOARD_LABEL, { src: ARTBOARD_BG }),
        textarea("maxillaryComments", "Additional Comments/Instructions"),
      ],
    },

    // ── MANDIBULAR (LOWER) Only SELECTION (collapse qid 120) ──
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
          ],
        ),
        // qid 496: widget (image checkbox, single select)
        checkbox("removableMandibularExpansion", "Removable Mandibular Expansion (Only)", [
          "Mandibular Schwarz",
          "Mandibular Memory Screw",
          "Mandibular Slim-line",
        ]),
        // qid 487: widget (image checkbox, single select)
        checkbox("fixedMandibularExpansion", "Fixed Mandibular Expansion (Only)", [
          "Mandibular Williams",
          "Mandibular Slim-line 'Variety Click' Expander",
          "Mandibular E-Arch",
        ]),
        image(
          "https://www.jotform.com/uploads/Diamondlab/form_files/Untitled-1.604c0641ecde48.53101509.png",
          "Mandibular reference",
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
        checkbox("mandibularDesignDraw", DESIGN_DRAW_LABEL, ["Diamond ORTHO Artboard"]),
        // qid 42: widget (drawOnImage artboard)
        artboard("mandibularArtboard", ARTBOARD_LABEL, { src: ARTBOARD_BG }),
        textarea("orthoDesignComments", "Additional Comments for ORTHO Design"),
      ],
    },

    // ── SUBMIT FORM (pagebreak qid 35) ──
    {
      id: "submitForm",
      fields: [
        date("dueDate", "Due Date Requested"),
        signature("doctorSignature", "Doctor Signature", { required: true }),
        checkbox("rushCase", "Would you like to rush this case?", ["Yes"]),
        // qid 337: widget (rush-charge slider — BIOMED / PMT / ACRYLIC)
        radio("rushChargeBiomed", "RUSH case request:", [
          "No Rush",
          "Standard",
          "Expedited",
        ]),
        // qid 335: widget (rush-charge slider — NYLON DEVICES)
        radio("rushChargeNylon", "RUSH case request:", [
          "No Rush",
          "Standard",
          "Expedited",
          "Max Rush",
        ]),
        // qid 141: widget (textarea autosize)
        textarea(
          "additionalComments",
          "Additional Comments **Note** Writing device selection in this area will delay your case! This area is not for device selection.",
        ),
      ],
    },
  ],
};

export default orthodonticRxForm;
