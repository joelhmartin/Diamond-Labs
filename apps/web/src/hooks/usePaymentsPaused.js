import { useEffect, useState } from "react";
import api from "../config/api.js";

/**
 * True while the cutover freeze (PAYMENTS_PAUSED) is on. A failed check reads
 * as "not paused": the API still refuses the payment with the same message.
 */
export function usePaymentsPaused() {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    let live = true;
    api.get("/payments/status")
      .then((res) => { if (live) setPaused(res.data?.data?.paused === true); })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  return paused;
}
