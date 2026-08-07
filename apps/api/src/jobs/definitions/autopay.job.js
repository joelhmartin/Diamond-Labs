import { defineJob } from "../registry.js";
import { runAutopaySweep } from "../../services/autopay-runner.service.js";
import { env } from "../../config/env.js";

defineJob({
  name: "autopay",
  description: "Charge enrolled doctors their monthly AutoPay amount",
  handler: async ({ dryRun, log, runId }) => {
    // TWO independent switches. The runner's own dryRun flag AND the
    // AUTOPAY_LIVE_RUN environment gate must both permit a charge. A
    // misconfigured scheduler alone cannot move money.
    const effectiveDryRun = dryRun || !env.AUTOPAY_LIVE_RUN;
    if (dryRun !== effectiveDryRun) {
      log?.warn?.("AutoPay asked for a live run but AUTOPAY_LIVE_RUN is false — running dry");
    }
    return runAutopaySweep({ dryRun: effectiveDryRun, log, runId });
  },
});
