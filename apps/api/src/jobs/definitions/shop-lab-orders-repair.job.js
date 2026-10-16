import { defineJob } from "../registry.js";
import { repairMissingShopLabOrders } from "../../services/lab/shop-order-repair.service.js";

defineJob({
  name: "shop-lab-orders-repair",
  description: "Create the lab order and paid invoice for paid shop orders that checkout failed to record",
  // Moves no money: a dry run only counts, a live run creates the missing records (idempotent).
  handler: async ({ dryRun, log }) => repairMissingShopLabOrders({ dryRun, log }),
});
