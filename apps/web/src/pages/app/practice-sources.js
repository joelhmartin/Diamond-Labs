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

const userLabel = (u) => u.name || u.email;
const LABEL_CHUNK = 60; // ids per request, so the URL stays short

/** Logins for the admin and member pickers: paged, searched and filtered by the server (active logins only). */
export const usersSource = {
  async list({ q, limit = 10, offset = 0, excludeIds }) {
    const params = { limit, offset, status: "active" };
    if (q) params.q = q;
    if (excludeIds?.length) params.excludeIds = excludeIds.join(",");
    const { users, total } = (await api.get("/admin/users", { params })).data.data;
    return { total, rows: users.map((u) => ({ id: u.id, label: userLabel(u), detail: u.name ? u.email : null })) };
  },
  /** Names for logins already chosen, whatever their status. */
  async labels(ids) {
    const out = {};
    for (let i = 0; i < ids.length; i += LABEL_CHUNK) {
      const res = await api.get("/admin/users", { params: { ids: ids.slice(i, i + LABEL_CHUNK).join(","), limit: LABEL_CHUNK } });
      for (const u of res.data.data.users) out[u.id] = userLabel(u);
    }
    return out;
  },
};

/** How a group's practice reads in the module's accounts table. */
export const describePractice = (a) => ({ title: a.label, to: `${ROUTES.ADMIN_PRACTICES}?pr.q=${encodeURIComponent(a.label)}` });
