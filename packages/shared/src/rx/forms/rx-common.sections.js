/**
 * Rx form pieces every doctor-facing Rx form shares: the case-identification
 * header (patient, first device, due date), the records block (how records
 * arrive + uploads) and the submit footer (signature, rush, comments).
 *
 * The digital Rx and the orthodontic Rx both compose these, so the questions a
 * doctor answers about the CASE (as opposed to the appliance) are defined once.
 * Field keys here are load-bearing: the submit route reads patientName and
 * dueDate, and the payload builder reads rushCase.
 */

import {
  heading,
  note,
  radio,
  checkbox,
  textarea,
  date,
  fullname,
  fileUpload,
  signature,
} from "./form-fields.js";

// Local archive of the option images formerly served from JotForm's CDN
// (see scripts/copy-rx-option-images.mjs — copies from
// docs/rx-forms/jotform-images/options/ into apps/web/public/images/rx/options/).
export const IMG = "/images/rx/options";

// qid 86 "Records Selection" widget — option↔logo/photo pairing from the snapshot.
const RECORDS_OPTIONS = [
  { value: "Physical Bite Registration", label: "Physical Bite Registration", image: `${IMG}/bite_150.png` },
  { value: "PVS Impressions", label: "PVS Impressions", image: `${IMG}/PVS_150.png` },
  { value: "Stone/Resin Models", label: "Stone/Resin Models", image: `${IMG}/model_150.png` },
  { value: "3SHAPE", label: "3SHAPE", image: `${IMG}/3shape.png` },
  { value: "CARESTREAM", label: "CARESTREAM", image: `${IMG}/carestream.png` },
  { value: "CEREC", label: "CEREC", image: `${IMG}/cerec.png` },
  { value: "ITERO", label: "ITERO", image: `${IMG}/itero.png` },
  { value: "MEDIT", label: "MEDIT", image: `${IMG}/medit.png` },
  { value: "MIDMARK", label: "MIDMARK", image: `${IMG}/midmark.png` },
  { value: "SHINING 3D", label: "SHINING 3D", image: `${IMG}/shining.png` },
  { value: "PLANMECA", label: "PLANMECA", image: `${IMG}/planmeca.png` },
  { value: "ALL OTHER SCANNERS", label: "ALL OTHER SCANNERS", image: `${IMG}/all.png` },
];

/** CASE IDENTIFICATION — patient, first device, due date. */
export const CASE_ID_SECTION = {
  id: "case-id",
  heading: "Case Identification",
  fields: [
    note(
      "<strong>Doctor:</strong> Matt Rago · Account 1324 <span style='opacity:.6'>(auto-filled from your account)</span>",
      { key: "noteDoctorAuto" }
    ),
    heading("Case Identification", { key: "hdrCaseId" }),
    // qid 56: widget (auto-populated Today's Date calendar) — ex-ortho
    date("caseDate", "Date"),
    // qid 19
    fullname("patientName", "PATIENT:", { required: true }),
    // qid 309: widget "Checkbox in Dropdown" — single choice; modelled as radio
    radio("firstDevice", "Is this the patient's first device?", [
      "Yes",
      "No, use PREVIOUS RECORDS",
      "No, use NEW RECORDS",
    ]),
    // qid 14: "Due Date Requested" (production-scheduling date)
    date("dueDate", "Due Date Requested"),
    note("Typical turnaround is ~2 weeks; rush options available.", {
      key: "noteTurnaround",
    }),
  ],
};

/** How records arrive: the records picker, physical bite, uploads. */
const RECORDS_FIELDS = [
  heading("Case Submission", { key: "hdrCaseSubmission" }),
  note(
    "PLEASE SELECT HOW YOU WILL BE SENDING RECORDS FOR THIS PATIENT",
    { key: "noteRecordsIntro" }
  ),
  // qid 86: widget "Records Selection" (image picker, up to 3) → checkbox
  checkbox("records", "PHYSICAL AND/OR DIGITAL RECORDS", RECORDS_OPTIONS, {
    required: true,
  }),
  // qid 423
  radio("physicalBite", "Will you be sending a physical bite?", [
    "No - Start case now with digital bite",
    "Yes - Wait until physical bite is received (production will not start until physical bite is received)",
  ]),
  // qid 34 subLabel surfaced as standalone instructional copy
  note("Upload .STL, PDF files, images, etc..", { key: "noteUploadHint" }),
  // qid 34
  fileUpload("recordsUpload", "Upload your files ↴ ↴ ↴ ↴", {
    note: "Upload .STL, PDF files, images, etc..",
    accept:
      ".stl,.pdf,.jpg,.jpeg,.png,.gif,.zip,.doc,.docx,.xls,.xlsx,.csv,.txt",
  }),
];

/**
 * CASE SUBMISSION (head q81). `extraFields` are form-specific questions about
 * the records (the ortho form's digital-setup / study-model choices), appended
 * after the shared ones.
 */
export function caseSubmissionSection(extraFields = []) {
  return {
    id: "case-submission",
    heading: "Case Submission",
    note: "PLEASE SELECT HOW YOU WILL BE SENDING RECORDS FOR THIS PATIENT",
    fields: [...RECORDS_FIELDS, ...extraFields],
  };
}

/** SUBMIT FORM (pagebreak q35) — signature, rush, free-text comments. */
export const SUBMIT_SECTION = {
  id: "submit-form",
  heading: "Submit Form",
  fields: [
    heading("Submit Form", { key: "hdrSubmit" }),
    note(
      "PLEASE NOTE: All cases will be manufactured according to the production calendar (available for download on our website). Manufacturing begins when Diamond receives ALL items required for production; NOT the date the case is sent to the lab.",
      { key: "noteProductionCalendar" }
    ),
    // qid 76
    signature("doctorSignature", "Doctor Signature", { required: true }),
    // qid 391
    checkbox("rushCase", "Would you like to rush this case?", ["Yes"]),
    // qid 337 / 335: the two rush-charge sliders. Both are labelled "RUSH
    // case request:", so ungated they showed every doctor three rush
    // controls, two of them indistinguishable. Gated on `rushCase` itself
    // (not devicesToOrder — rush pricing applies to any device once a
    // rush is actually requested) so they only appear once the doctor has
    // ticked the shared "Would you like to rush this case?" checkbox.
    radio(
      "rushChargeBiomed",
      "RUSH case request: (BIOMED / PMT / ACRYLIC devices)",
      ["No Rush", "Standard", "Expedited"],
      { showIf: { key: "rushCase", includes: "Yes" } }
    ),
    radio(
      "rushChargeNylon",
      "RUSH case request: (NYLON devices)",
      ["No Rush", "Standard", "Expedited", "Max Rush"],
      { showIf: { key: "rushCase", includes: "Yes" } }
    ),
    // qid 141: widget (textarea autosize) — ex-ortho
    textarea(
      "additionalComments",
      "Additional Comments **Note** Writing device selection in this area will delay your case! This area is not for device selection."
    ),
  ],
};
