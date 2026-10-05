/**
 * Form registry — the doctor-facing Rx forms: the digital Rx (sleep / TMD /
 * guard devices) and the orthodontic Rx.
 *
 * Each definition embeds its own { slug, jotformId, title, route }.
 * `FORM_LIST` preserves chooser display order.
 */

import { digitalRxForm } from "./digital-rx.form.js";
import { orthoRxForm } from "./ortho-rx.form.js";

export const FORMS = {
  digital: digitalRxForm,
  ortho: orthoRxForm,
};

export const FORM_LIST = [digitalRxForm, orthoRxForm];

export function getForm(slug) {
  return FORMS[slug] || null;
}
