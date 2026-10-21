/**
 * Insert the rows whose legacy key isn't already in the target, in batches.
 * `existingKeys` comes from a select the caller made this run, so a re-run
 * inserts nothing. ON CONFLICT DO NOTHING is the backstop for a race or a
 * clash on another unique index (e.g. an invoice number); `.returning` tells
 * us what actually landed, and the rest is reported as `conflicts`. (fakeTx
 * resolves inserts to undefined: then every row counts as inserted.)
 */
export async function insertMissing(tx, table, rows, { keyOf, existingKeys, idOf = (r) => r.id, batch = 500 }) {
  const fresh = rows.filter((r) => !existingKeys.has(keyOf(r)));
  const insertedIds = new Set();
  let conflicts = 0;
  for (let i = 0; i < fresh.length; i += batch) {
    const chunk = fresh.slice(i, i + batch);
    const res = await tx.insert(table).values(chunk).onConflictDoNothing().returning({ id: table.id });
    const landed = Array.isArray(res) ? res.map((r) => r.id) : chunk.map(idOf);
    for (const id of landed) insertedIds.add(id);
    conflicts += chunk.length - landed.length;
  }
  return { insertedIds, skipped: rows.length - fresh.length, conflicts };
}
