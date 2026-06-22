/**
 * Adapter: faithful RX form answers → admin mapping-tester case input.
 *
 * Bridges the doctor-facing FormRenderer (which produces a flat
 * `{ [fieldKey]: value }` answers map) to the shape PreviewModal expects
 * (`{ deviceKey, deviceOptions, caseFields }`) WITHOUT touching the backend
 * preview/send pipeline or the device→Seazona map.
 *
 * Line-item coverage is intentionally partial — the whole point of the tester
 * is to surface which fields populate the Seazona order and which don't.
 */

import { visibleFields } from "./form-logic.js";

// Field types that carry no readable answer value (presentational/binary).
const SKIP_TYPES = new Set([
  "heading",
  "divider",
  "static",
  "image",
  "signature",
  "artboard",
  "fileUpload",
]);

/** Does an answer count as "filled"? (non-empty array / string / object). */
function answered(v) {
  if (Array.isArray(v)) return v.length > 0;
  if (v == null) return false;
  if (typeof v === "string") return v.trim() !== "";
  if (typeof v === "object") return Object.values(v).some((x) => answered(x));
  return Boolean(v);
}

/** Strip HTML tags + collapse whitespace for a readable label. */
function cleanLabel(label, fallback) {
  const raw = (label || fallback || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return raw || fallback || "";
}

/** Render one answer value as a single readable string (or "" to skip). */
function formatValue(field, value) {
  switch (field.type) {
    case "fullname":
      return [value?.first, value?.last].filter(Boolean).join(" ");
    case "address":
      return [
        value?.office,
        value?.street,
        [value?.city, value?.state, value?.zip].filter(Boolean).join(", "),
        value?.country,
      ]
        .filter(Boolean)
        .join(" · ");
    case "checkbox":
      return Array.isArray(value) ? value.filter(Boolean).join(", ") : "";
    case "matrix": {
      if (!value || typeof value !== "object") return "";
      return Object.entries(value)
        .filter(([, v]) => answered(v))
        .map(([k, v]) => `${k.replace("__", " ")}=${Array.isArray(v) ? v.join("/") : v}`)
        .join(", ");
    }
    default:
      return Array.isArray(value) ? value.join(", ") : String(value ?? "");
  }
}

/**
 * Digital form device-section detection, in priority order. Takes the FIRST
 * filled answer key → its deviceKey. Keys verified against digital-rx.form.js.
 */
const DIGITAL_DEVICE_DETECTION = [
  ["ddsoDevice", "ddso"],
  ["dproDevice", "cadcam-d-pro"],
  ["shiraziDevice", "shirazi-hybrid"],
  ["snorehookDevice", "snorehook"],
  ["nightguardDevice", "guard"],
  ["sportGuardDevice", "sport-guard"],
  // OLMOS Day (OD) — no single "device" checkbox, detect by its option/comment fields.
  ["odExpansionOptions", "olmos-day"],
  ["odComments", "olmos-day"],
  // OLMOS Night (ON).
  ["onComments", "olmos-night"],
  // MISTRY protocol single-item pickers.
  ["mora", "mora"],
  ["ara", "ara"],
];

function detectDigitalDeviceKey(answers) {
  for (const [key, deviceKey] of DIGITAL_DEVICE_DETECTION) {
    if (answered(answers[key])) return deviceKey;
  }
  return null;
}

/**
 * formAnswersToCaseInput(slug, form, answers)
 *   → { deviceKey, deviceOptions, caseFields }
 *
 * caseFields matches PreviewModal's expected shape:
 *   { patientFirst, patientLast, recordsMethod, physicalBite, firstDevice,
 *     rush, rushTier, generalComments, dueDate? }
 */
export function formAnswersToCaseInput(slug, form, answers = {}) {
  const fields = visibleFields(form, answers);

  // ── Patient name ← fullname field whose key matches /patient/i ──
  const patientField = fields.find(
    (f) => f.type === "fullname" && /patient/i.test(f.key || "")
  );
  const patientVal = patientField ? answers[patientField.key] : null;
  const patientFirst = patientVal?.first?.trim() || "Test";
  const patientLast = patientVal?.last?.trim() || "Patient";

  // ── Due date ← date field whose key matches /due/i ──
  const dueField = fields.find(
    (f) => f.type === "date" && /due/i.test(f.key || "")
  );
  const dueDate = dueField ? answers[dueField.key] : undefined;

  // ── General comments: readable dump of EVERY answered visible field ──
  const commentLines = [];
  for (const field of fields) {
    if (SKIP_TYPES.has(field.type)) continue;
    if (!field.key) continue;
    const value = answers[field.key];
    if (!answered(value)) continue;
    const rendered = formatValue(field, value);
    if (!rendered) continue;
    commentLines.push(`${cleanLabel(field.label, field.key)}: ${rendered}`);
  }

  // ── deviceKey ──
  let deviceKey;
  if (slug === "ortho" || slug === "olmos") {
    deviceKey = "ortho-expander";
  } else {
    // digital
    deviceKey = detectDigitalDeviceKey(answers);
    if (!deviceKey) {
      deviceKey = "ddso";
      commentLines.push(
        "[tester] no device section detected — defaulted to DDSO for line preview"
      );
    }
  }

  // ── deviceOptions (conservative; partial coverage is expected) ──
  const deviceOptions = {};
  for (const [key, value] of Object.entries(answers)) {
    if (!answered(value)) continue;
    if (/material/i.test(key) && deviceOptions.baseMaterial == null) {
      deviceOptions.baseMaterial = Array.isArray(value) ? value[0] : value;
    } else if (
      /modification/i.test(key) &&
      Array.isArray(value) &&
      deviceOptions.modifications == null
    ) {
      deviceOptions.modifications = value;
    } else if (/occlusal/i.test(key) && deviceOptions.occlusalContact == null) {
      deviceOptions.occlusalContact = Array.isArray(value) ? value[0] : value;
    } else if (
      /arch/i.test(key) &&
      typeof value === "string" &&
      deviceOptions.arch == null
    ) {
      deviceOptions.arch = value;
    }
  }

  const caseFields = {
    patientFirst,
    patientLast,
    recordsMethod: "itero",
    physicalBite: "no_digital",
    firstDevice: "Yes",
    rush: false,
    rushTier: "nylon",
    generalComments: commentLines.join("\n"),
    ...(dueDate ? { dueDate } : {}),
  };

  return { deviceKey, deviceOptions, caseFields };
}

export default formAnswersToCaseInput;
