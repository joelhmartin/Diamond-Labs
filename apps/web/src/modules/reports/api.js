/**
 * The reports API, through the signed-in axios client. The server replies
 * with bare bodies (no `{ data }` envelope). `params` are the report's raw
 * query values (see params.js); paging is `{ limit, offset, sort? }`.
 */
import api from "../../config/api.js";
import { saveFile } from "../../lib/requests.js";

const base = (key) => `/reports/${encodeURIComponent(key)}`;

/** `{ groups, reports }` the signed-in person may see, with their stars. */
export async function listReports() {
  return (await api.get("/reports")).data;
}

/** `{ rows, total, truncated, summary?, notice?, generatedAt, tookMs }`. */
export async function runReport(key, params, paging) {
  return (await api.get(`${base(key)}/run`, { params: { ...params, ...paging } })).data;
}

/** Save the whole result as CSV (the server streams every row, up to its cap). Throws with the server's message. */
export function downloadReportCsv(key, params) {
  return saveFile(api, `${base(key)}/export.csv`, params, `${key}.csv`);
}

export async function setFavorite(key, on) {
  const res = on ? await api.put(`${base(key)}/favorite`) : await api.delete(`${base(key)}/favorite`);
  return res.data;
}

/** `[{ value, label }]` (at most 20) matching `q`. */
export async function searchLookup(source, q, { signal } = {}) {
  return (await api.get(`/reports/lookups/${encodeURIComponent(source)}`, { params: { q }, signal })).data;
}
