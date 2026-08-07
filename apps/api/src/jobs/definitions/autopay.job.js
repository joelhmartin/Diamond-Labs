// TEMPORARY stub — replaced in Task 12 with the real AutoPay sweep.
import { defineJob } from "../registry.js";

defineJob({
  name: "autopay",
  description: "Charge enrolled doctors their monthly AutoPay amount",
  handler: async () => ({ pending: true }),
});
