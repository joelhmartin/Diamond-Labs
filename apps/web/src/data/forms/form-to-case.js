/**
 * Adapter: faithful RX form answers → admin mapping-tester case input.
 *
 * Bridges the doctor-facing FormRenderer (which produces a flat
 * `{ [fieldKey]: value }` answers map) to the shape PreviewModal expects
 * (`{ devices: [{ deviceKey, label, deviceOptions }], caseFields }`) WITHOUT
 * touching the device→Seazona map.
 *
 * A single completed form may order MULTIPLE devices (the digital form gates
 * several device sections behind one `devicesToOrder` multi-select). Each
 * selected device becomes its own entry in `devices`, so the preview resolves
 * line items per-device instead of collapsing everything into one appliance
 * plus a giant notes dump.
 *
 * Line-item coverage is intentionally partial — the whole point of the tester
 * is to surface which fields populate the Seazona order and which don't.
 */

import { visibleFields } from "./form-logic.js";
import { buildFormDevices } from "@my-app/shared";

/**
 * formAnswersToCaseInput(slug, form, answers)
 *   → { devices: [{ deviceKey, label, deviceOptions }], caseFields }
 *
 * caseFields holds the order-level (shared) settings; per-device selections
 * live on each device's `deviceOptions`. The whole-form notes dump is gone —
 * notes are now compiled per-device on the backend.
 */
export function formAnswersToCaseInput(slug, form, answers = {}) {
  const fields = visibleFields(form, answers);

  // ── Patient name ← fullname field whose key matches /patient/i ──
  const patientField = fields.find(
    (f) => f.type === "fullname" && /patient/i.test(f.key || "")
  );
  const patientVal = patientField ? answers[patientField.key] : null;
  const patientFirst = patientVal?.first?.trim() || "Test";
  const patientLast = patientVal?.last?.trim() || "Patient";

  // ── Due date ← date field whose key matches /due/i ──
  const dueField = fields.find(
    (f) => f.type === "date" && /due/i.test(f.key || "")
  );
  const dueDate = dueField ? answers[dueField.key] : undefined;

  const devices = buildFormDevices(slug, answers);

  const caseFields = {
    patientFirst,
    patientLast,
    recordsMethod: "itero",
    physicalBite: "no_digital",
    firstDevice: "Yes",
    rush: false,
    rushTier: "nylon",
    ...(dueDate ? { dueDate } : {}),
  };

  return { devices, caseFields };
}

export default formAnswersToCaseInput;
