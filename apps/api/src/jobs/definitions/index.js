import "./autopay.job.js";

/** Importing this module registers every job. Kept as a function for clarity
 *  at call sites and so tests can assert it was invoked. */
export function registerAllJobs() {
  // Registration happens via the imports above (defineJob runs at module load).
}
