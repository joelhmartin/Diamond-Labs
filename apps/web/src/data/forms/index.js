/**
 * Form registry — the three faithful 1:1 RX forms.
 *
 * Each definition embeds its own { slug, jotformId, title, route }.
 * `FORM_LIST` preserves chooser display order.
 */

import { digitalRxForm } from "./digital-rx.form.js";
import { orthodonticRxForm } from "./orthodontic-rx.form.js";
import { olmosRxForm } from "./olmos-rx.form.js";

export const FORMS = {
  digital: digitalRxForm,
  ortho: orthodonticRxForm,
  olmos: olmosRxForm,
};

export const FORM_LIST = [digitalRxForm, orthodonticRxForm, olmosRxForm];

export function getForm(slug) {
  return FORMS[slug] || null;
}
