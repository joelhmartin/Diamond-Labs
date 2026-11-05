import { TAG_APPLY_MAX_IDS } from "@my-app/shared";

/** A tag rule refusal; `code` maps to an HTTP status in routes.js. */
export class TagError extends Error {
  /** @param {"NOT_FOUND"|"INVALID"|"CONFLICT"} code @param {string} message safe to show staff */
  constructor(code, message) {
    super(message);
    this.name = "TagError";
    this.code = code;
  }
}

/** Trim and collapse inner whitespace. */
export const normalizeLabel = (label) => String(label ?? "").trim().replace(/\s+/g, " ");

/** Refuse a label matching an existing one of the same record type, ignoring case. `exceptId` skips the row being renamed. */
export function assertUniqueLabel(definitions, recordType, label, exceptId = null) {
  const key = normalizeLabel(label).toLowerCase();
  const clash = definitions.some(
    (d) => d.recordType === recordType && d.id !== exceptId && normalizeLabel(d.label).toLowerCase() === key,
  );
  if (clash) throw new TagError("CONFLICT", "A tag with that name already exists.");
}

const asSet = (v) => (v instanceof Set ? v : new Set(v ?? []));

/**
 * Pure plan for a bulk add/remove.
 * @param {object} p
 * @param {Array<{id,recordType,active}>} p.definitions tag rows for every id in add/remove (any record type)
 * @param {Map<string, Iterable<string>>} p.current recordId → tag ids already applied
 * @param {string[]} p.ids records to change
 * @param {string[]} p.add
 * @param {string[]} p.remove
 * @param {Iterable<string>} p.existing record ids that exist
 * @param {string} [p.recordType] when given, every tag must belong to it
 * @returns {{ changes: Array<{recordId, added: object[], removed: object[]}>, failed: Array<{id, message}> }}
 */
export function planApply({ definitions, current, ids, add = [], remove = [], existing, recordType }) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) throw new TagError("INVALID", "Choose at least one record.");
  if (unique.length > TAG_APPLY_MAX_IDS) throw new TagError("INVALID", `Choose at most ${TAG_APPLY_MAX_IDS} records at a time.`);
  const byId = new Map(definitions.map((d) => [d.id, d]));
  const resolve = (tagId) => {
    const def = byId.get(tagId);
    if (!def || (recordType && def.recordType !== recordType)) throw new TagError("INVALID", "Unknown tag.");
    return def;
  };
  const addDefs = [...new Set(add)].map(resolve);
  const removeDefs = [...new Set(remove)].map(resolve);
  if (addDefs.some((d) => d.active === false)) throw new TagError("INVALID", "That tag is inactive and can't be added.");
  const exists = asSet(existing);
  const changes = [];
  const failed = [];
  for (const recordId of unique) {
    if (!exists.has(recordId)) {
      failed.push({ id: recordId, message: "not found" });
      continue;
    }
    const have = asSet(current?.get(recordId));
    const added = addDefs.filter((d) => !have.has(d.id));
    const removed = removeDefs.filter((d) => have.has(d.id) && !addDefs.some((a) => a.id === d.id));
    if (added.length || removed.length) changes.push({ recordId, added, removed });
  }
  return { changes, failed };
}
