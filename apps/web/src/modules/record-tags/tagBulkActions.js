import { TAG_APPLY_MAX_IDS } from "@my-app/shared";
import api from "../../config/api.js";
import { eachRow } from "../../lib/data-table/bulk.js";

/** Apply in chunks the server accepts; failed rows are named by `labelOf`. → `{ ok, failed }` for BulkBar. */
async function applyInChunks(client, recordType, rows, { add = [], remove = [] }, labelOf) {
  let ok = 0;
  const failed = [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (let i = 0; i < rows.length; i += TAG_APPLY_MAX_IDS) {
    const ids = rows.slice(i, i + TAG_APPLY_MAX_IDS).map((r) => r.id);
    const res = await client.post(`/tags/${recordType}/apply`, { ids, add, remove });
    const missed = res.data.data.failed ?? [];
    ok += ids.length - missed.length;
    failed.push(...missed.map((f) => ({ id: byId.has(f.id) ? labelOf(byId.get(f.id)) : f.id, rowId: f.id, message: f.message })));
  }
  return { ok, failed };
}

/**
 * Bulk actions for a DataTable's BulkBar over selected rows (each `{ id, tags? }`):
 * "Label…" and "Remove label…" (pick a value; one request per 500 rows) and "Star".
 * "Remove label…" offers the labels the selected rows carry. `after()` runs once
 * the action finishes, even on failure (reload the list).
 */
export function tagBulkActions(selectedRows, { recordType, definitions = [], after, client = api, labelOf = (r) => r.id }) {
  const finish = async (work) => {
    try {
      return await work();
    } finally {
      after?.();
    }
  };
  const asChoice = (t) => ({ value: t.id, label: t.label });
  const carried = [...new Map(selectedRows.flatMap((r) => r.tags ?? []).map((t) => [t.id, t])).values()];
  return [
    {
      id: "tag-add", label: "Label…", choicePlaceholder: "Choose label",
      choices: definitions.filter((d) => d.active !== false).map(asChoice),
      run: (rows, tagId) => finish(() => applyInChunks(client, recordType, rows, { add: [tagId] }, labelOf)),
    },
    {
      id: "tag-remove", label: "Remove label…", choicePlaceholder: "Choose label",
      choices: carried.map(asChoice),
      run: (rows, tagId) => finish(() => applyInChunks(client, recordType, rows, { remove: [tagId] }, labelOf)),
    },
    {
      id: "tag-star", label: "Star",
      run: (rows) => finish(() => eachRow(rows, (r) => client.put(`/tags/${recordType}/${r.id}/star`), labelOf)),
    },
  ];
}
