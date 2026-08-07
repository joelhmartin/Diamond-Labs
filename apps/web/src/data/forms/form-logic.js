/**
 * Pure form logic helpers for the definition-driven RX forms.
 *
 * No JSX, no React — these are framework-agnostic functions operating on plain
 * form definitions and a flat `{ [field.key]: value }` answers map.
 *
 * Field contract:
 *   field = { type, key, label, required?, options?, placeholder?, unit?, rows?,
 *             columns?, palette?, accept?, maxFiles?, note?, src?, alt?, html?,
 *             showIf?: ({ key, includes } | { key, equals } | { key, prefix }) }
 *
 * Form definition:
 *   { slug, jotformId, title, route, sections: [{ id, heading?, note?, fields: [field] }] }
 */

/**
 * Conditional-visibility predicate. Mirrors the semantics used by the device
 * wizard's DeviceOptionsPanel / field-logic.js (kept self-contained here), and
 * matches sectionVisible's superset below so a field-level and section-level
 * showIf never silently disagree:
 *   - no `showIf`           → always visible
 *   - `showIf.includes` set → visible when answers[showIf.key] is an array
 *                             containing the value, or equals it outright
 *   - `showIf.equals` set   → visible when answers[showIf.key] === equals
 *   - `showIf.prefix` set   → visible when answers[showIf.key] is a string that
 *                             startsWith prefix
 */
export function shouldShow(field, answers) {
  if (!field || !field.showIf) return true;
  const other = (answers || {})[field.showIf.key];
  if (field.showIf.includes != null)
    return Array.isArray(other) ? other.includes(field.showIf.includes) : other === field.showIf.includes;
  if (field.showIf.equals != null) return other === field.showIf.equals;
  if (field.showIf.prefix != null)
    return typeof other === "string" && other.startsWith(field.showIf.prefix);
  return true;
}

/**
 * Section-level conditional visibility. Superset of shouldShow's semantics,
 * adding { key, includes }: matches when answers[key] is an array containing
 * the value, or equals it outright.
 */
export function sectionVisible(section, answers) {
  const cond = section && section.showIf;
  if (!cond) return true;
  const other = (answers || {})[cond.key];
  if (cond.includes != null)
    return Array.isArray(other) ? other.includes(cond.includes) : other === cond.includes;
  if (cond.equals != null) return other === cond.equals;
  if (cond.prefix != null)
    return typeof other === "string" && other.startsWith(cond.prefix);
  return true;
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
    case "matrix": {
      // value shape: { [rowKey]: cellValue } — empty if no cell has a value.
      if (!value || typeof value !== "object") return true;
      return !Object.values(value).some(
        (cell) => cell != null && cell !== "" &&
          !(Array.isArray(cell) && cell.length === 0)
      );
    }
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
 * A field is invalid ONLY when it is required AND visible AND its answer is empty.
 * Returns { ok, errors: { [field.key]: message } }.
 */
export function validateForm(form, answers) {
  const errors = {};
  for (const field of visibleFields(form, answers)) {
    if (!field.required) continue;
    if (STATIC_TYPES.has(field.type)) continue;
    const value = (answers || {})[field.key];
    if (isEmpty(field, value)) {
      errors[field.key] = `${field.label || field.key} is required`;
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
