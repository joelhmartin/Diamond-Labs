import { formatUsDate } from "./lab-order-status.js";

/**
 * Vocabulary for the production desk: what is enclosed with an order and how
 * it goes back to the practice. One definition for the API validation, the
 * order page and the work ticket.
 */
export const LAB_ENCLOSED_KINDS = ["impression", "model", "bite", "digital", "other"];
export const LAB_ENCLOSED_LABELS = { impression: "Impression", model: "Model", bite: "Bite", digital: "Digital", other: "Other" };

export const LAB_DELIVERY_METHODS = ["local_delivery", "ups", "fedex", "pickup", "other"];
export const LAB_DELIVERY_LABELS = { local_delivery: "Local delivery", ups: "UPS", fedex: "FedEx", pickup: "Pickup", other: "Other" };

export const LAB_ENCLOSURE_NOTE_MAX = 60;
export const LAB_PAN_MAX = 30;

/** Staff-entered order lines: which arch, and the quantity range the bench accepts. */
export const LAB_ARCHES = ["upper", "lower", "both"];
export const LAB_LINE_QTY_MAX = 99;
export const LAB_PATIENT_NAME_MAX = 120;

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
function realDate(s) {
  const m = ISO.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** "Digital (scanner 10/01/2026)": the label, then the note and date when present. */
export function formatEnclosure(e) {
  const label = LAB_ENCLOSED_LABELS[e?.kind] ?? String(e?.kind ?? "");
  const detail = [e?.note, e?.date ? formatUsDate(e.date) : ""].filter(Boolean).join(" ");
  return detail ? `${label} (${detail})` : label;
}

/**
 * A list of enclosed items → the canonical list: one per kind, in kind order,
 * blanks dropped. Throws an Error with a staff-safe message on bad input, so
 * the same list compares equal however it was ordered.
 */
export function normalizeEnclosures(list) {
  if (list == null) return [];
  if (!Array.isArray(list)) throw new Error("Enclosed items must be a list.");
  const seen = new Set();
  const out = list.map((raw) => {
    const kind = raw?.kind;
    if (!LAB_ENCLOSED_KINDS.includes(kind)) throw new Error("Unknown enclosed item.");
    if (seen.has(kind)) throw new Error(`${LAB_ENCLOSED_LABELS[kind]} is listed twice.`);
    seen.add(kind);
    const item = { kind };
    const date = typeof raw.date === "string" ? raw.date.trim() : "";
    if (date) {
      if (!realDate(date)) throw new Error("Enclosed item dates must be real dates.");
      item.date = date;
    }
    const note = typeof raw.note === "string" ? raw.note.trim() : "";
    if (note) {
      if (note.length > LAB_ENCLOSURE_NOTE_MAX) throw new Error(`Enclosed item notes are limited to ${LAB_ENCLOSURE_NOTE_MAX} characters.`);
      item.note = note;
    }
    return item;
  });
  return out.sort((a, b) => LAB_ENCLOSED_KINDS.indexOf(a.kind) - LAB_ENCLOSED_KINDS.indexOf(b.kind));
}

/** The stored JSON text → the canonical list ([] for null or unreadable text). */
export function parseEnclosures(json) {
  if (!json) return [];
  try {
    return normalizeEnclosures(JSON.parse(json));
  } catch {
    return [];
  }
}
