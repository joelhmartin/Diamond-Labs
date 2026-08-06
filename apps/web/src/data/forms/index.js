/**
 * Form registry — the faithful 1:1 RX form.
 *
 * Each definition embeds its own { slug, jotformId, title, route }.
 * `FORM_LIST` preserves chooser display order.
 */

import { digitalRxForm } from "./digital-rx.form.js";

export const FORMS = {
  digital: digitalRxForm,
};

export const FORM_LIST = [digitalRxForm];

export function getForm(slug) {
  return FORMS[slug] || null;
}
