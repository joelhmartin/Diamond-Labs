/**
 * Insert the rows whose legacy key isn't already in the target, in batches.
 * `existingKeys` comes from a select the caller made this run, so a re-run
 * inserts nothing. ON CONFLICT DO NOTHING is the backstop for a race or a
 * clash on another unique index (e.g. an invoice number); `.returning` tells
 * us what actually landed, and the rest is reported as `conflicts`, with
 * their legacy keys in `droppedKeys` so the report can name them.
 */
export async function insertMissing(tx, table, rows, { keyOf, existingKeys, batch = 500 }) {
  const fresh = rows.filter((r) => !existingKeys.has(keyOf(r)));
  const insertedIds = new Set();
  let conflicts = 0;
  const droppedKeys = [];
  for (let i = 0; i < fresh.length; i += batch) {
    const chunk = fresh.slice(i, i + batch);
    const res = await tx.insert(table).values(chunk).onConflictDoNothing().returning({ id: table.id });
    const landed = res.map((r) => r.id);
    for (const id of landed) insertedIds.add(id);
    conflicts += chunk.length - landed.length;
    const landedSet = new Set(landed);
    for (const r of chunk) if (!landedSet.has(r.id)) droppedKeys.push(keyOf(r));
  }
  return { insertedIds, skipped: rows.length - fresh.length, conflicts, droppedKeys };
}
