/**
 * Form registry. Tasks 3-5 populate FORMS with the three ported definitions
 * (digital, ortho, olmos). Keep this skeleton dependency-free.
 */

export const FORMS = {};

export function getForm(slug) {
  return FORMS[slug] || null;
}
