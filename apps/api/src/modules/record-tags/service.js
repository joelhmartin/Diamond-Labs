import { and, asc, eq, exists, inArray, sql } from "drizzle-orm";
import { db as appDb } from "../../config/database.js";
import { createId } from "../../lib/id.js";
import { tagDefinitions, recordTags, recordStars } from "./schema.js";
import { TagError, planApply, normalizeLabel, assertUniqueLabel } from "./rules.js";

const toTag = (r) => ({ id: r.id, recordType: r.recordType, label: r.label, color: r.color, position: r.position, active: r.active });

export async function listDefinitions(recordType, { includeInactive = false } = {}, database = appDb) {
  const where = includeInactive
    ? eq(tagDefinitions.recordType, recordType)
    : and(eq(tagDefinitions.recordType, recordType), eq(tagDefinitions.active, true));
  const rows = await database.select().from(tagDefinitions).where(where).orderBy(asc(tagDefinitions.position), asc(tagDefinitions.label));
  return rows.map(toTag);
}

export async function createDefinition({ recordType, label, color = "slate" }, database = appDb) {
  const clean = normalizeLabel(label);
  if (!clean) throw new TagError("INVALID", "Label is required.");
  const existing = await listDefinitions(recordType, { includeInactive: true }, database);
  assertUniqueLabel(existing, recordType, clean);
  const position = existing.reduce((m, d) => Math.max(m, d.position + 1), 0);
  try {
    const [row] = await database.insert(tagDefinitions).values({ id: createId(), recordType, label: clean, color, position }).returning();
    return toTag(row);
  } catch (err) {
    if (err?.code === "23505") throw new TagError("CONFLICT", "A tag with that name already exists.");
    throw err;
  }
}

export async function updateDefinition(id, patch, database = appDb) {
  const [current] = await database.select().from(tagDefinitions).where(eq(tagDefinitions.id, id));
  if (!current) throw new TagError("NOT_FOUND", "Tag not found.");
  const set = { updatedAt: new Date() };
  if (patch.label !== undefined) {
    const clean = normalizeLabel(patch.label);
    if (!clean) throw new TagError("INVALID", "Label is required.");
    assertUniqueLabel(await listDefinitions(current.recordType, { includeInactive: true }, database), current.recordType, clean, id);
    set.label = clean;
  }
  for (const key of ["color", "position", "active"]) if (patch[key] !== undefined) set[key] = patch[key];
  try {
    const [row] = await database.update(tagDefinitions).set(set).where(eq(tagDefinitions.id, id)).returning();
    return toTag(row);
  } catch (err) {
    if (err?.code === "23505") throw new TagError("CONFLICT", "A tag with that name already exists.");
    throw err;
  }
}

/** Map<recordId, Tag[]> — includes inactive tags already applied. Records with no tags are absent. */
export async function tagsFor(recordType, ids, database = appDb) {
  const out = new Map();
  if (!ids?.length) return out;
  const rows = await database
    .select({ recordId: recordTags.recordId, tag: tagDefinitions })
    .from(recordTags)
    .innerJoin(tagDefinitions, eq(tagDefinitions.id, recordTags.tagId))
    .where(and(eq(recordTags.recordType, recordType), inArray(recordTags.recordId, ids)))
    .orderBy(asc(tagDefinitions.position), asc(tagDefinitions.label));
  for (const { recordId, tag } of rows) {
    if (!out.has(recordId)) out.set(recordId, []);
    out.get(recordId).push(toTag(tag));
  }
  return out;
}

export async function starsFor(recordType, ids, userId, database = appDb) {
  if (!ids?.length) return new Set();
  const rows = await database
    .select({ recordId: recordStars.recordId })
    .from(recordStars)
    .where(and(eq(recordStars.recordType, recordType), eq(recordStars.userId, userId), inArray(recordStars.recordId, ids)));
  return new Set(rows.map((r) => r.recordId));
}

/**
 * Bulk add/remove labels. Missing records land in `failed`; the rest apply in
 * one transaction, then `onChange(tx, [{ recordId, added, removed }])` runs in
 * that same transaction (the glue records its own history there).
 */
export async function applyTags({ recordType, ids, add = [], remove = [], byUserId, exists: existsFn, onChange }, database = appDb) {
  const tagIds = [...new Set([...add, ...remove])];
  const definitions = tagIds.length
    ? (await database.select().from(tagDefinitions).where(inArray(tagDefinitions.id, tagIds))).map(toTag)
    : [];
  const unique = [...new Set(ids)];
  const found = unique.length <= 500 ? await existsFn(unique) : new Set();
  const currentRows = unique.length <= 500 && tagIds.length
    ? await database.select().from(recordTags).where(and(eq(recordTags.recordType, recordType), inArray(recordTags.recordId, unique)))
    : [];
  const current = new Map();
  for (const r of currentRows) {
    if (!current.has(r.recordId)) current.set(r.recordId, new Set());
    current.get(r.recordId).add(r.tagId);
  }
  const { changes, failed } = planApply({ definitions, current, ids: unique, add, remove, existing: found, recordType });
  if (changes.length) {
    await database.transaction(async (tx) => {
      const inserts = changes.flatMap((c) =>
        c.added.map((t) => ({ id: createId(), recordType, recordId: c.recordId, tagId: t.id, createdBy: byUserId ?? null })));
      if (inserts.length) await tx.insert(recordTags).values(inserts).onConflictDoNothing();
      for (const c of changes) {
        if (!c.removed.length) continue;
        await tx.delete(recordTags).where(and(
          eq(recordTags.recordType, recordType),
          eq(recordTags.recordId, c.recordId),
          inArray(recordTags.tagId, c.removed.map((t) => t.id)),
        ));
      }
      if (onChange) await onChange(tx, changes);
    });
  }
  return { ok: true, failed };
}

export async function setStar({ recordType, recordId, userId, starred }, database = appDb) {
  if (starred) {
    await database.insert(recordStars).values({ recordType, recordId, userId }).onConflictDoNothing();
  } else {
    await database.delete(recordStars).where(and(
      eq(recordStars.recordType, recordType), eq(recordStars.recordId, recordId), eq(recordStars.userId, userId),
    ));
  }
  return { starred: !!starred };
}

/** SQL condition: the row (by `idColumn`) carries any of `tagIds`. */
export function taggedWithAny(recordType, idColumn, tagIds) {
  return exists(
    appDb.select({ one: sql`1` }).from(recordTags).where(and(
      eq(recordTags.recordType, recordType), eq(recordTags.recordId, idColumn), inArray(recordTags.tagId, tagIds),
    )),
  );
}

/** SQL condition: the row (by `idColumn`) is starred by `userId`. */
export function starredBy(recordType, idColumn, userId) {
  return exists(
    appDb.select({ one: sql`1` }).from(recordStars).where(and(
      eq(recordStars.recordType, recordType), eq(recordStars.recordId, idColumn), eq(recordStars.userId, userId),
    )),
  );
}
