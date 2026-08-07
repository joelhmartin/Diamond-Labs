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

/**
 * Shared condition evaluator behind both shouldShow and sectionVisible (and
 * disableOptionsIf's `when`). There is exactly ONE implementation of this
 * predicate — see field-logic.js's docstring for the history of the bug that
 * came from field-level and section-level visibility drifting apart when
 * this was two hand-written copies.
 */
function conditionMet(cond, answers) {
  if (!cond) return true;
  const other = (answers || {})[cond.key];
  if (cond.includes != null)
    return Array.isArray(other) ? other.includes(cond.includes) : other === cond.includes;
  if (cond.equals != null) return other === cond.equals;
  if (cond.prefix != null)
    return typeof other === "string" && other.startsWith(cond.prefix);
  if (cond.oneOf != null)
    return Array.isArray(other)
      ? other.some((v) => cond.oneOf.includes(v))
      : cond.oneOf.includes(other);
  if (cond.answered === true) return !isEmptyValue(other);
  if (cond.cell != null) {
    if (!other || typeof other !== "object") return false;
    return !isEmptyValue(other[cond.cell]);
  }
  // Unrecognised shape. Throw loudly in development (Vite/Vitest set
  // import.meta.env.DEV); fall back to "always visible" everywhere else
  // (production builds, or any non-Vite runtime that lacks import.meta.env).
  if (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.DEV) {
    throw new Error(`Unrecognised showIf/condition shape: ${JSON.stringify(cond)}`);
  }
  return true;
}

/**
 * Conditional-visibility predicate. See the Condition contract in this
 * module's docstring. `shouldShow` and `sectionVisible` are deliberately the
 * same predicate — both delegate to conditionMet — so a field-level and
 * section-level showIf never silently disagree.
 */
export function shouldShow(field, answers) {
  if (!field || !field.showIf) return true;
  return conditionMet(field.showIf, answers);
}

/** Section-level conditional visibility. Same predicate as shouldShow. */
export function sectionVisible(section, answers) {
  if (!section || !section.showIf) return true;
  return conditionMet(section.showIf, answers);
}

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
 * Whether a plain object carries any non-empty value on any of its own keys.
 * This is the matrix branch's original rule, factored out because
 * isEmptyValue (below) reuses it for every object-shaped answer.
 */
function objectHasNoContent(obj) {
  if (!obj || typeof obj !== "object") return true;
  return !Object.values(obj).some(
    (v) => v != null && v !== "" && !(Array.isArray(v) && v.length === 0)
  );
}

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
 * Value-only emptiness check, for conditions like `{ key, answered }` and
 * `{ key, cell }` that only have `answers[key]` to work with — not the
 * referenced field's definition, so not its `type`. Duck-types the value's
 * own shape instead:
 *   - array            → checkbox/fileUpload rule: empty iff length 0
 *   - plain object      → fullname/address/matrix answers all serialize as
 *                         objects; reuses objectHasNoContent (the matrix
 *                         rule: empty iff no own value is non-empty). This is
 *                         a deliberate widening for fullname/address: isEmpty
 *                         requires ALL subfields present for submission
 *                         validity, but "answered" only needs the doctor to
 *                         have started — ANY subfield counts.
 *   - string            → plain-string/signature/artboard rule: empty iff ""
 *   - anything else     → empty iff null/undefined
 */
function isEmptyValue(value) {
  if (Array.isArray(value)) return value.length === 0;
  if (value !== null && typeof value === "object") return objectHasNoContent(value);
  if (typeof value === "string") return value === "";
  return value == null;
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
