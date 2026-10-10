/**
 * Pure form logic helpers for the definition-driven RX forms.
 *
 * No JSX, no React — these are framework-agnostic functions operating on plain
 * form definitions and a flat `{ [field.key]: value }` answers map.
 *
 * Field contract:
 *   field = { type, key, label, required?, options?, placeholder?, unit?, rows?,
 *             columns?, palette?, accept?, maxFiles?, note?, src?, alt?, html?,
 *             showIf?: Condition,
 *             disableOptionsIf?: [{ when: Condition, options: [optionValue] }] }
 *
 * Condition (the `showIf` shape, also reused as `disableOptionsIf[].when`):
 *   { key, equals }   → answers[key] === equals
 *   { key, prefix }   → answers[key] is a string that startsWith(prefix)
 *   { key, includes } → answers[key] is an array containing the value, or
 *                       equals it outright (a scalar answer)
 *   { key, oneOf }    → answers[key] is in the oneOf list (scalar answer), or
 *                       any element of answers[key] is in the list (array
 *                       answer, e.g. a checkbox)
 *   { key, answered: true } → answers[key] carries any non-empty answer, by
 *                       the same emptiness rules validateForm uses (see
 *                       isEmptyValue below) — checkbox/fileUpload arrays,
 *                       fullname/address/matrix objects, signature/artboard
 *                       data URLs, and plain strings are all handled.
 *   { key, cell }     → answers[key] is a matrix answer object (flat-keyed
 *                       `${row}__${col}` per MatrixField's setCell) and the
 *                       cell named by `cell` carries a non-empty value.
 *   { all: [Condition, ...] } → every sub-condition is met (AND). Composes
 *                       with any other shape, including `not`. An empty array
 *                       is vacuously true.
 *   { not: Condition } → the wrapped condition is NOT met (negation). Exists
 *                       for cases like "hide this field once a contradictory
 *                       answer has been given elsewhere" — the other shapes
 *                       only express positive "show when" conditions.
 *
 * An unrecognised Condition shape throws in development (see conditionMet)
 * rather than silently defaulting to visible — a showIf that doesn't match
 * any known shape is almost always a typo in a field definition, and for a
 * medical Rx form, silently *showing* a field that was meant to be gated is
 * worse than a loud crash during development. Production builds swallow the
 * throw and fall back to "always visible" so a bad definition degrades to the
 * old (safe, all-fields-shown) behaviour instead of a blank/broken form.
 *
 * `disableOptionsIf` is field-level, not answer-shaping: it does not hide the
 * field, it marks specific option *values* as unavailable given an earlier
 * answer (e.g. a "(Fixed ONLY)" radio option once the arch retention answer
 * is a removable type). Read it with `disabledOptions(field, answers)`.
 */

import { conditionMet, objectHasNoContent, shouldShow, sectionVisible } from "@my-app/shared";

export { shouldShow, sectionVisible };

/**
 * The option VALUES that should be unavailable on `field` given the current
 * answers, per `field.disableOptionsIf`:
 *   [{ when: Condition, options: [optionValue, ...] }, ...]
 * Every rule whose `when` condition currently matches contributes its
 * `options` to the returned set; a field with no disableOptionsIf (or none of
 * whose rules match) returns an empty set.
 *
 * This only computes which option values are disabled — it does not touch
 * `answers` or decide what should happen to an already-selected value that
 * becomes disabled. See validateForm below for that half.
 */
export function disabledOptions(field, answers) {
  const out = new Set();
  const rules = (field && field.disableOptionsIf) || [];
  for (const rule of rules) {
    if (!rule || !conditionMet(rule.when, answers)) continue;
    for (const opt of rule.options || []) out.add(opt);
  }
  return out;
}

/** Flatten every field across all sections, preserving declaration order. */
export function allFields(form) {
  const out = [];
  const sections = (form && form.sections) || [];
  for (const section of sections) {
    const fields = (section && section.fields) || [];
    for (const field of fields) out.push(field);
  }
  return out;
}

/** allFields filtered to those in a visible section AND individually visible. */
export function visibleFields(form, answers) {
  const out = [];
  for (const section of (form && form.sections) || []) {
    if (!sectionVisible(section, answers)) continue;
    for (const field of (section && section.fields) || [])
      if (shouldShow(field, answers)) out.push(field);
  }
  return out;
}

// Field types that are presentational only and can never be "required".
const STATIC_TYPES = new Set(["heading", "divider", "image", "static"]);

/**
 * Whether a field's answer counts as "empty" for required-field validation.
 * Empty rules are keyed by field type.
 */
function isEmpty(field, value) {
  switch (field.type) {
    case "checkbox":
    case "fileUpload":
      return !Array.isArray(value) || value.length === 0;
    case "fullname":
      return !value || !value.first || !value.last;
    case "address":
      return (
        !value ||
        !value.street ||
        !value.city ||
        !value.state ||
        !value.zip
      );
    case "matrix":
      // value shape: { [rowKey]: cellValue } — empty if no cell has a value.
      return objectHasNoContent(value);
    case "signature":
    case "artboard":
      return typeof value !== "string" || value === "";
    default:
      // string-ish types: text, textarea, radio, select, email, phone, date, …
      return value == null || value === "";
  }
}

/**
 * Validate a form against an answers map.
 * A field is invalid when:
 *   - it is required AND visible AND its answer is empty, OR
 *   - it has `disableOptionsIf` AND its current (non-empty) answer is one of
 *     the option values disabled by the current answers.
 * The second rule exists because a doctor can select a valid option, then
 * change an earlier answer in a way that makes that selection contradictory
 * (e.g. picking "Standard Hyrax RPE (Fixed ONLY)" for expansion type, then
 * changing arch retention to a removable type). form-logic.js doesn't own
 * `answers` state so it can't clear the stale value itself — but it must not
 * let that now-invalid, now-hidden-in-the-UI answer silently pass validation
 * and ride along into the submitted order. Blocking submission forces the
 * doctor back to that field to re-select, same as any other required field.
 * This applies regardless of `field.required` — a contradictory answer is a
 * correctness problem, not just a completeness one.
 *
 * Returns { ok, errors: { [field.key]: message } }.
 */
export function validateForm(form, answers) {
  const errors = {};
  for (const field of visibleFields(form, answers)) {
    if (STATIC_TYPES.has(field.type)) continue;
    const value = (answers || {})[field.key];

    if (field.required && isEmpty(field, value)) {
      errors[field.key] = `${field.label || field.key} is required`;
      continue;
    }

    if (field.disableOptionsIf && !isEmpty(field, value)) {
      const disabled = disabledOptions(field, answers);
      const stale = Array.isArray(value)
        ? value.some((v) => disabled.has(v))
        : disabled.has(value);
      if (stale) {
        errors[field.key] =
          `${field.label || field.key} selection is no longer valid for the current answers — please re-select`;
      }
    }
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

/** Convert a data-URL string to a Blob (dependency-free). */
function dataUrlToBlob(dataUrl) {
  const comma = dataUrl.indexOf(",");
  const header = dataUrl.slice(0, comma);
  const body = dataUrl.slice(comma + 1);
  const mimeMatch = /data:([^;,]+)/.exec(header);
  const mime = mimeMatch ? mimeMatch[1] : "application/octet-stream";
  const isBase64 = /;base64/i.test(header);
  if (isBase64) {
    const binary = globalThis.atob(body);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
    return new globalThis.Blob([bytes], { type: mime });
  }
  return new globalThis.Blob([decodeURIComponent(body)], { type: mime });
}

/**
 * Build a multipart FormData payload for submission.
 *
 *   - appends `formType`
 *   - appends `patientFirst` / `patientLast` when a `fullname` field whose key
 *     contains "patient" carries { first, last }
 *   - appends `formData` = JSON.stringify of all NON-file answers
 *   - for each `fileUpload` field, appends each File under name `file`
 *   - for each `artboard` field with a data-URL value, appends a Blob under `file`
 *   - when `signature` (data URL) is supplied, appends it under `signature`
 */
export function buildSubmitFormData({ formType, form, answers, signature }) {
  const FormDataCtor = globalThis.FormData;
  const fd = new FormDataCtor();
  fd.append("formType", formType);

  const ans = answers || {};
  const fields = allFields(form);

  // Patient name extraction from a fullname field whose key mentions "patient".
  const patientField = fields.find(
    (f) => f.type === "fullname" && /patient/i.test(f.key || "")
  );
  if (patientField) {
    const v = ans[patientField.key];
    if (v && v.first != null) fd.append("patientFirst", v.first);
    if (v && v.last != null) fd.append("patientLast", v.last);
  }

  // Keys whose values are files/binary and must NOT go into the JSON blob.
  const fileKeys = new Set(
    fields
      .filter((f) => f.type === "fileUpload" || f.type === "artboard")
      .map((f) => f.key)
  );

  const jsonAnswers = {};
  for (const [key, value] of Object.entries(ans)) {
    if (fileKeys.has(key)) continue;
    jsonAnswers[key] = value;
  }
  fd.append("formData", JSON.stringify(jsonAnswers));

  // fileUpload fields → append each File under `file`.
  // FileUploadField stores wrapper objects `{ id, file, name, ... }`; raw
  // File/Blob values are also accepted (used by tests). Unwrap to the real
  // binary before appending so the File bytes are not lost.
  for (const field of fields) {
    if (field.type !== "fileUpload") continue;
    const files = ans[field.key];
    if (!Array.isArray(files)) continue;
    for (const entry of files) {
      if (!entry) continue;
      const blob = entry.file != null ? entry.file : entry;
      const name = entry.name != null ? entry.name : undefined;
      if (name) fd.append("file", blob, name);
      else fd.append("file", blob);
    }
  }

  // artboard fields with a data-URL value → Blob under `file`.
  for (const field of fields) {
    if (field.type !== "artboard") continue;
    const value = ans[field.key];
    if (typeof value === "string" && value.startsWith("data:")) {
      fd.append("file", dataUrlToBlob(value), `${field.key}.png`);
    }
  }

  // Top-level signature data URL.
  if (typeof signature === "string" && signature.startsWith("data:")) {
    fd.append("signature", dataUrlToBlob(signature), "signature.png");
  }

  return fd;
}
