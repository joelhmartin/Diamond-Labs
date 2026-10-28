import { errorText } from "../requests.js";

/**
 * Run `fn(row)` for each row, one at a time, carrying on past failures — for a
 * bulk action over a per-row endpoint. `label(row)` names a row in the failure
 * summary. → `{ ok, failed: [{ id, message }] }`, the shape BulkAction.run returns.
 */
export async function eachRow(rows, fn, label) {
  let ok = 0;
  const failed = [];
  for (const row of rows) {
    try {
      await fn(row);
      ok += 1;
    } catch (err) {
      failed.push({ id: label(row), message: errorText(err) });
    }
  }
  return { ok, failed };
}
