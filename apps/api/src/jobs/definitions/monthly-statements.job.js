import { defineJob } from "../registry.js";
import { previousLabMonth, runStatements } from "../../services/billing/statement-run.service.js";

// Defined and runnable by hand, NOT scheduled: turning on a Cloud Scheduler
// trigger for it needs the owner's yes. Idempotent per (client, month), so a
// re-run sends nothing already sent. A dry run returns the plan counts only.
defineJob({
  name: "monthly-statements",
  description: "Email last month's statement notice to every client due one (lab-local month)",
  handler: async ({ dryRun, runId }) => runStatements({ month: previousLabMonth(), byUserId: null, runId, dryRun }),
});
