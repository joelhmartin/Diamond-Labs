import api from "../../config/api.js";
import { ROUTES } from "../../config/routes.js";

// The lab's sources for the generic organizations module: practices and logins, in the module's { rows, total } shape.

/** `params`: { q, limit, offset, ungrouped? } → practices as picker rows. */
export const practicesSource = {
  async list(params) {
    const query = { ...params };
    if (query.ungrouped) query.ungrouped = "true"; else delete query.ungrouped;
    const res = await api.get("/admin/practices", { params: query });
    const { rows, total } = res.data.data;
    return {
      total,
      rows: rows.map((p) => ({ id: p.id, label: p.name, detail: p.accountNumber ? `Acct ${p.accountNumber}` : "No account number", organizationId: p.organization?.id ?? null })),
    };
  },
};

let usersCache = null;
async function loadUsers() {
  if (!usersCache || Date.now() - usersCache.at > 15000) {
    usersCache = { at: Date.now(), promise: api.get("/admin/users").then((res) => res.data.data.users).catch((err) => { usersCache = null; throw err; }) };
  }
  return usersCache.promise;
}
const userLabel = (u) => u.name || u.email;

/** Logins for the admin and member pickers. The admin list is one unpaged request, filtered and sliced here. */
export const usersSource = {
  async list({ q, limit = 10, offset = 0 }) {
    const needle = (q ?? "").toLowerCase();
    const all = (await loadUsers()).filter((u) => !needle || `${u.name ?? ""} ${u.email}`.toLowerCase().includes(needle));
    return { total: all.length, rows: all.slice(offset, offset + limit).map((u) => ({ id: u.id, label: userLabel(u), detail: u.name ? u.email : null })) };
  },
  async labels(ids) {
    const wanted = new Set(ids);
    return Object.fromEntries((await loadUsers()).filter((u) => wanted.has(u.id)).map((u) => [u.id, userLabel(u)]));
  },
};

/** How a group's practice reads in the module's accounts table. */
export const describePractice = (a) => ({ title: a.label, to: `${ROUTES.ADMIN_PRACTICES}?pr.q=${encodeURIComponent(a.label)}` });
