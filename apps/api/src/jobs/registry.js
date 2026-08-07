/**
 * Job registry — deliberately knows nothing about how a job is triggered.
 *
 * A job is a named async function. Cloud Run Jobs, Cloud Scheduler, an HTTP
 * call, and a dev-only interval are all just callers of runJob(). Swapping
 * execution providers means writing a new trigger adapter, not touching jobs.
 */
const jobs = new Map();

export function defineJob({ name, description, handler }) {
  if (!name) throw new Error("defineJob requires a name");
  if (typeof handler !== "function") throw new Error(`defineJob("${name}") requires a handler function`);
  if (jobs.has(name)) throw new Error(`Job "${name}" is already registered`);
  jobs.set(name, { name, description: description || "", handler });
}

export function getJob(name) {
  return jobs.get(name);
}

export function listJobs() {
  return [...jobs.values()].map(({ name, description }) => ({ name, description }));
}

/** Test-only: reset registration between cases. */
export function clearRegistry() {
  jobs.clear();
}
