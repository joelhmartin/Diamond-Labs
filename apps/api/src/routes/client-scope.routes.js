import { authenticate } from "../middleware/authenticate.js";
import { organizationsService } from "../services/organizations.service.js";
import { clientScopeOf } from "../services/client-scope.js";
import { describePractices } from "../services/practices.service.js";

// Name and lab account number of each practice in scope (one query; scope ids are already active practices).
const describeScopeAccounts = (ids) => describePractices(ids);

/**
 * The scope response (spec "API routes"): what the portal's practice switcher
 * shows. Built from the scope authenticate already loaded, so it can never
 * disagree with what the other routes enforce.
 */
export async function clientScopeView(scope, { describeAccounts = describeScopeAccounts, organizationOf = (ids) => organizationsService.organizationOf(ids) } = {}) {
  const ids = scope.accountIds;
  const [labels, orgs] = ids.length ? await Promise.all([describeAccounts(ids), organizationOf(ids)]) : [new Map(), new Map()];
  return {
    accounts: ids.map((id) => ({
      id,
      name: labels.get(id)?.name ?? null,
      accountNumber: labels.get(id)?.accountNumber ?? null,
      organizationId: orgs.get(id)?.id ?? null,
      via: scope.via.get(id) ?? null,
      role: scope.roles.get(id) ?? null,
      payable: scope.payable.has(id),
    })),
    organizations: scope.organizations.map((o) => ({ id: o.id, name: o.name, combinedStatement: o.combinedStatement })),
  };
}

/** `GET /client/scope`: any signed-in login; an empty scope is an empty answer, never an error. */
export function createClientScopeRoutes({ guard = [authenticate], view = clientScopeView } = {}) {
  return async function clientScopeRoutes(fastify) {
    fastify.get("/client/scope", { preHandler: guard }, async (request) => ({
      data: await view(clientScopeOf(request.user)),
    }));
  };
}

export default createClientScopeRoutes();
