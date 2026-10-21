import { drizzle } from "drizzle-orm/postgres-js";
import { env } from "./env.js";
import { createPgClient } from "./pg-client.js";
import * as schema from "../db/schema/index.js";

const poolOpts = {
  max: env.NODE_ENV === "production" ? 20 : 5,
  idle_timeout: 20,
  connect_timeout: 10,
};

// Cloud SQL socket URLs are handled by createPgClient (config/pg-client.js).
const queryClient = createPgClient(env.DATABASE_URL, poolOpts);

export const db = drizzle(queryClient, { schema });
export { queryClient };
