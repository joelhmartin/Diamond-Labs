/**
 * Rx form registry — the doctor-facing forms, shared so the API can group a
 * case's answers exactly as the form does (work ticket, lab order detail).
 * `RX_FORM_LIST` preserves chooser display order.
 */
import { digitalRxForm } from "./digital-rx.form.js";
import { orthoRxForm } from "./ortho-rx.form.js";

export const RX_FORMS = { digital: digitalRxForm, ortho: orthoRxForm };
export const RX_FORM_LIST = [digitalRxForm, orthoRxForm];

export function getRxForm(slug) {
  return RX_FORMS[slug] || null;
}
