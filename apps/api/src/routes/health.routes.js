import { db } from "../config/database.js";
import { sql } from "drizzle-orm";

export default async function healthRoutes(fastify) {
  fastify.get("/health", async () => {
    let dbOk = false;
    try {
      await db.execute(sql`SELECT 1`);
      dbOk = true;
    } catch {
      // db unreachable
    }

    return {
      data: {
        status: "ok",
        timestamp: new Date().toISOString(),
        services: {
          database: dbOk ? "connected" : "disconnected",
        },
      },
    };
  });
}
