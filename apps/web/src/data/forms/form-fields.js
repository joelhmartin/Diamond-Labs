/**
 * Thin field-builder helpers for authoring RX form definitions, plus the shared
 * identification block reused by the Orthodontic and OLMOS forms.
 *
 * Each builder returns a plain field object matching the canonical contract:
 *   field = { type, key, label, required?, options?, placeholder?, unit?, rows?,
 *             columns?, palette?, accept?, maxFiles?, note?, src?, alt?, html?,
 *             showIf? }
 *
 * `opts` is spread last so callers can attach showIf, note, placeholder,
 * required, etc. without a bespoke signature per builder.
 */

export function radio(key, label, options, opts = {}) {
  return { type: "radio", key, label, options, ...opts };
}

export function checkbox(key, label, options, opts = {}) {
  return { type: "checkbox", key, label, options, ...opts };
}

export function select(key, label, options, opts = {}) {
  return { type: "select", key, label, options, ...opts };
}

export function text(key, label, opts = {}) {
  return { type: "text", key, label, ...opts };
}

export function textarea(key, label, opts = {}) {
  return { type: "textarea", key, label, ...opts };
}

export function date(key, label, opts = {}) {
  return { type: "date", key, label, ...opts };
}

export function heading(label, opts = {}) {
  return { type: "heading", key: undefined, label, ...opts };
}

export function divider(opts = {}) {
  return { type: "divider", ...opts };
}

export function note(html, opts = {}) {
  return { type: "static", html, ...opts };
}

export function fullname(key, label, opts = {}) {
  return { type: "fullname", key, label, ...opts };
}

export function email(key, label, opts = {}) {
  return { type: "email", key, label, ...opts };
}

export function phone(key, label, opts = {}) {
  return { type: "phone", key, label, ...opts };
}

export function address(key, label, opts = {}) {
  return { type: "address", key, label, ...opts };
}

export function fileUpload(key, label, opts = {}) {
  return { type: "fileUpload", key, label, ...opts };
}

export function signature(key, label, opts = {}) {
  return { type: "signature", key, label, ...opts };
}

export function matrix(key, label, rows, columns, opts = {}) {
  return { type: "matrix", key, label, rows, columns, ...opts };
}

/**
 * Shared CASE IDENTIFICATION block used by both the Orthodontic and OLMOS forms.
 * Returns an ARRAY of fields (callers splice these into a section's `fields`).
 *
 * Minimal + correct placeholder — the porting tasks (3-5) extend/override as
 * needed for full snapshot parity.
 */
export function idBlock() {
  return [
    heading("CASE IDENTIFICATION"),
    fullname("patientName", "PATIENT:", { required: true }),
    text("doctorName", "DOCTOR:", { required: true }),
    email("email", "Email Address", { required: true }),
    phone("contactPhone", "CONTACT:"),
    date("caseDate", "Date"),
    date("dueDate", "Due Date Requested"),
  ];
}
