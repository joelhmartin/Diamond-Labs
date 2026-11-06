import api from "../../config/api.js";

// Thin wrappers over the organizations routes. Every call unwraps the { data } envelope.
// `base` defaults to the admin mount; pass another path to reuse the module elsewhere.
const data = (res) => res.data.data;
const id = encodeURIComponent;
export const ORGANIZATIONS_BASE = "/admin/organizations";

/** `params`: { q, status, limit, offset } → { rows, total } */
export const fetchOrganizations = async (params, base = ORGANIZATIONS_BASE) => data(await api.get(base, { params }));
/** → { ...organization, accountIds, accounts: [{ id, label }], admins: [{ userId, status }] } */
export const fetchOrganization = async (orgId, base = ORGANIZATIONS_BASE) => data(await api.get(`${base}/${id(orgId)}`));
export const createOrganization = async (body, base = ORGANIZATIONS_BASE) => data(await api.post(base, body));
/** `patch`: { name?, settings?, status? } */
export const updateOrganization = async (orgId, patch, base = ORGANIZATIONS_BASE) => data(await api.patch(`${base}/${id(orgId)}`, patch));
export const addAccounts = async (orgId, accountIds, base = ORGANIZATIONS_BASE) => data(await api.post(`${base}/${id(orgId)}/accounts`, { accountIds }));
export const removeAccount = async (orgId, accountId, base = ORGANIZATIONS_BASE) => data(await api.delete(`${base}/${id(orgId)}/accounts/${id(accountId)}`));
export const addAdmin = async (orgId, userId, base = ORGANIZATIONS_BASE) => data(await api.post(`${base}/${id(orgId)}/admins`, { userId }));
export const removeAdmin = async (orgId, userId, base = ORGANIZATIONS_BASE) => data(await api.delete(`${base}/${id(orgId)}/admins/${id(userId)}`));
