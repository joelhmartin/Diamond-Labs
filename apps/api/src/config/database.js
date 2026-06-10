import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "./env.js";
import * as schema from "../db/schema/index.js";

const poolOpts = {
  max: env.NODE_ENV === "production" ? 20 : 5,
  idle_timeout: 20,
  connect_timeout: 10,
};

// Cloud SQL hands us a unix-socket URL of the form
//   postgresql://user:pass@/dbname?host=/cloudsql/INSTANCE
// postgres-js can't parse that (empty host throws in new URL()), so detect it
// and connect via an options object with host = the socket directory instead.
const socketMatch = env.DATABASE_URL.match(
  /^postgres(?:ql)?:\/\/([^:]+):([^@]+)@\/([^?]+)\?host=(.+)$/
);
const queryClient = socketMatch
  ? postgres({
      host: decodeURIComponent(socketMatch[4]),
      database: socketMatch[3],
      username: decodeURIComponent(socketMatch[1]),
      password: decodeURIComponent(socketMatch[2]),
      ...poolOpts,
    })
  : postgres(env.DATABASE_URL, poolOpts);

export const db = drizzle(queryClient, { schema });
export { queryClient };
