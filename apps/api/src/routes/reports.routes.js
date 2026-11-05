import { STAFF_ROLES, LAB_TIMEZONE } from "@my-app/shared";
import { authenticate } from "../middleware/authenticate.js";
import { requireRole } from "../middleware/require-role.js";
import { db } from "../config/database.js";
import * as auditService from "../services/audit.service.js";
import { createRegistry } from "../modules/reports/registry.js";
import { createReportRoutes } from "../modules/reports/routes.js";
import { createMemoryFavoritesStore } from "../modules/reports/favorites.service.js";
import { registerLabReports } from "../services/lab/reports/index.js";

/** The app's report registry; later tasks and benches import it. */
export const reportRegistry = createRegistry({ defaultRoles: STAFF_ROLES });
registerLabReports(reportRegistry);

// In-memory for now; at rebase this is re-pointed at the record-tags module's starsFor/setStar (recordType "report").
const favorites = createMemoryFavoritesStore();

const audit = (request, action, targetId, metadata) =>
  auditService.logSafe({
    userId: request.user.id,
    action,
    targetType: "report",
    targetId,
    metadata,
    ipAddress: request.ip,
  });

export default createReportRoutes({
  registry: reportRegistry,
  db,
  preHandler: [authenticate, requireRole(...STAFF_ROLES)],
  audit,
  favorites,
  tz: LAB_TIMEZONE,
});
