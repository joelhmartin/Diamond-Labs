/**
 * Diamond Orthodontic Rx. — the orthodontic appliance prescription
 * (expanders, Modified Tandem, Twin Block).
 *
 * Source snapshot: docs/rx-forms/jotform-api/orthodontic-213545611846154-questions.json
 *
 * Composed, not authored: the case header / records / submit footer come from
 * rx-common.sections.js (shared with the digital Rx) and the appliance
 * questions from ortho.sections.js (their only definition). Submitting it
 * posts formType "ortho"; the API turns the answers into one ortho-expander
 * device with the same shared adapter the preview uses
 * (packages/shared/src/rx/form-devices.js → buildFormDevices).
 */

import { CASE_ID_SECTION, caseSubmissionSection, SUBMIT_SECTION } from "./rx-common.sections.js";
import { ORTHO_RECORDS_FIELDS, ORTHO_SECTIONS } from "./ortho.sections.js";

export const orthoRxForm = {
  slug: "ortho",
  jotformId: "213545611846154",
  title: "Diamond Orthodontic Rx.",
  route: "/app/rx/ortho",
  sections: [
    CASE_ID_SECTION,
    caseSubmissionSection(ORTHO_RECORDS_FIELDS),
    ...ORTHO_SECTIONS,
    SUBMIT_SECTION,
  ],
};

export default orthoRxForm;
