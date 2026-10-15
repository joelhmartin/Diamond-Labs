import { useRef } from "react";
import { createAttemptKey } from "../lib/idempotency.js";

/** Component-lifetime holder for an idempotency key per charge attempt (see lib/idempotency.js). */
export function useAttemptKey() {
  const ref = useRef(null);
  if (!ref.current) ref.current = createAttemptKey();
  return ref.current;
}
