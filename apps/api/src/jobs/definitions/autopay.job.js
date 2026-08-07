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
    const summary = await runAutopaySweep({ dryRun: effectiveDryRun, log, runId });
    // Thread the EFFECTIVE dry-run value back through the summary — never the
    // REQUESTED one, which could read "live" while nothing actually charged.
    // The Cloud Run Job log (what jobs/cli.js prints) is the operator's
    // primary artifact for the go-live gate, and it prints runJob's result —
    // which is exactly this summary — so this is the only place that value
    // can reach that log.
    return { ...summary, dryRun: effectiveDryRun };
  },
});
