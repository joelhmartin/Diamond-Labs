/**
 * A case's Rx answers, grouped and labelled as on the form. Used by the lab
 * order detail page and the work ticket so the bench reads the prescription
 * the way the doctor filled it in. Answers the form no longer defines are
 * never dropped — they print under "Other answers".
 */

import { shouldShow, sectionVisible } from "./conditions.js";

// Display-only and file fields: nothing a technician reads as an answer.
const SKIP_TYPES = new Set(["heading", "static", "image", "fileUpload", "signature", "artboard", "divider"]);

export function humanizeAnswerKey(key) {
  const spaced = String(key)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  return spaced.replace(/\b\w/g, (c) => c.toUpperCase());
}

function cleanLabel(label) {
  return String(label).replace(/<[^>]*>/g, "").replace(/[\s↴:]+$/u, "").trim();
}

/** Any answer value (string, list, {first,last}, matrix object, boolean) as one line of text. */
export function formatRxAnswer(value) {
  if (value === null || value === undefined || value === "") return null;
  if (Array.isArray(value)) {
    const parts = value.map(formatRxAnswer).filter(Boolean);
    return parts.length ? parts.join(", ") : null;
  }
  if (typeof value === "object") {
    if ("first" in value || "last" in value) {
      return [value.first, value.last].filter(Boolean).join(" ") || null;
    }
    const parts = Object.entries(value)
      .map(([k, v]) => {
        const fv = formatRxAnswer(v);
        return fv ? `${humanizeAnswerKey(k)}: ${fv}` : null;
      })
      .filter(Boolean);
    return parts.length ? parts.join(" · ") : null;
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

// Options are plain strings or { value, label, image }; map stored values to
// the label the form shows, keeping the raw value when nothing matches (legacy data).
function withOptionLabels(field, raw) {
  const opts = Array.isArray(field.options) ? field.options : null;
  if (!opts || raw === null || raw === undefined) return raw;
  const labelOf = (v) => {
    const hit = opts.find((o) => (o && typeof o === "object" ? o.value === v : o === v));
    return hit && typeof hit === "object" ? (hit.label ?? v) : v;
  };
  return Array.isArray(raw) ? raw.map(labelOf) : labelOf(raw);
}

/**
 * @param {object|null} form    a form definition (getRxForm) — null for an unknown form type
 * @param {object}      answers the case's decrypted formData
 */
export function groupRxAnswers(form, answers = {}) {
  const groups = [];
  const seen = new Set();
  for (const section of form?.sections ?? []) {
    const items = [];
    const sectionShown = sectionVisible(section, answers);
    for (const field of section.fields ?? []) {
      if (!field.key || seen.has(field.key)) continue;
      seen.add(field.key); // hidden fields still count as "seen" so a stale answer isn't re-listed under Other
      if (SKIP_TYPES.has(field.type)) continue;
      // The web form submits every answer, including ones a later change hid; the lab shouldn't read those.
      if (!sectionShown || !shouldShow(field, answers)) continue;
      const value = formatRxAnswer(withOptionLabels(field, answers?.[field.key]));
      if (value) items.push({ key: field.key, label: cleanLabel(field.label || humanizeAnswerKey(field.key)), value });
    }
    if (items.length) groups.push({ id: section.id, title: section.heading || humanizeAnswerKey(section.id), items });
  }
  const other = Object.keys(answers ?? {})
    .filter((k) => !seen.has(k))
    .map((k) => ({ key: k, label: humanizeAnswerKey(k), value: formatRxAnswer(answers[k]) }))
    .filter((i) => i.value);
  if (other.length) groups.push({ id: "other", title: "Other answers", items: other });
  return groups;
}
