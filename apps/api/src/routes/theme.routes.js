import { eq } from "drizzle-orm";
import { db } from "../config/database.js";
import { appTheme } from "../db/schema/index.js";
import { authenticate } from "../middleware/authenticate.js";
import { requireAdmin } from "../middleware/require-role.js";
import { themeUpdateSchema, ERROR_CODES } from "@my-app/shared";

const SINGLETON = "singleton";

export default async function themeRoutes(fastify) {
  // Public: current override (empty object when none).
  fastify.get("/theme", async (request, reply) => {
    const row = await db.select().from(appTheme).where(eq(appTheme.id, SINGLETON)).limit(1);
    reply.header("Cache-Control", "public, max-age=30");
    return { tokens: row[0]?.tokens ?? {} };
  });

  // Admin: replace the override.
  fastify.put("/theme", { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const parsed = themeUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { ...ERROR_CODES.VALIDATION_ERROR, message: parsed.error.issues[0]?.message ?? "Invalid theme" },
      });
    }
    const { tokens } = parsed.data;
    await db.insert(appTheme)
      .values({ id: SINGLETON, tokens, updatedBy: request.user.id, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: appTheme.id,
        set: { tokens, updatedBy: request.user.id, updatedAt: new Date() },
      });
    return { tokens };
  });

  // Admin: clear the override (reset to core).
  fastify.delete("/theme", { preHandler: [authenticate, requireAdmin] }, async () => {
    await db.insert(appTheme)
      .values({ id: SINGLETON, tokens: {} })
      .onConflictDoUpdate({ target: appTheme.id, set: { tokens: {}, updatedAt: new Date() } });
    return { tokens: {} };
  });
}
