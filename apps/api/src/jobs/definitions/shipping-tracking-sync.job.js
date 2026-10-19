import { defineJob } from "../registry.js";
import { syncLabTracking } from "../../services/lab/lab-shipping.service.js";

defineJob({
  name: "shipping-tracking-sync",
  description: "Poll UPS and FedEx tracking for open shipments; a box's first movement marks its orders shipped",
  // Moves no money. A dry run only counts; a live run writes tracking events
  // and ships boxes the carrier has picked up (idempotent).
  handler: async ({ dryRun, log }) => syncLabTracking({ dryRun, log }),
});
