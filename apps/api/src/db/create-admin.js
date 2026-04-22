/**
 * Idempotent admin bootstrapper for local development.
 *
 *   pnpm db:create-admin                      # uses defaults below
 *   ADMIN_EMAIL=me@x.com ADMIN_PASSWORD=hunter2 pnpm db:create-admin
 *
 * If a user with the given email already exists, their role is upgraded to
 * admin (password is NOT changed). Otherwise a fresh admin user is created
 * with email already verified so they can log in immediately.
 *
 * A personal account + owner membership are attached so RequireAccount
 * doesn't redirect admins away from /admin/* routes.
 */
import { eq } from "drizzle-orm";
import { db, queryClient } from "../config/database.js";
import { users, accounts, memberships } from "./schema/index.js";
import { createId } from "../lib/id.js";
import { hashPassword } from "../lib/passwords.js";

const EMAIL = (process.env.ADMIN_EMAIL || "admin@diamondlabsortho.com").toLowerCase();
const PASSWORD = process.env.ADMIN_PASSWORD || "AdminLocal123!";
const NAME = process.env.ADMIN_NAME || "Diamond Admin";

async function run() {
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.email, EMAIL))
    .limit(1);

  if (existing.length > 0) {
    const user = existing[0];
    if (user.role === "admin") {
      console.log(`✓ Admin user already exists: ${EMAIL} (no changes)`);
    } else {
      await db
        .update(users)
        .set({ role: "admin", approvalStatus: "not_required", updatedAt: new Date() })
        .where(eq(users.id, user.id));
      console.log(`✓ Upgraded ${EMAIL} to admin role`);
    }
    console.log(`   → sign in at /auth/login`);
    await queryClient.end();
    return;
  }

  // Create user
  const userId = createId();
  const passwordHash = await hashPassword(PASSWORD);
  await db.insert(users).values({
    id: userId,
    email: EMAIL,
    emailVerifiedAt: new Date(),
    passwordHash,
    name: NAME,
    status: "active",
    role: "admin",
    approvalStatus: "not_required",
  });

  // Create account + owner membership so RequireAccount is satisfied
  const accountId = createId();
  await db.insert(accounts).values({
    id: accountId,
    name: "Diamond Orthotic Laboratory",
    slug: "diamond-orthotic-laboratory",
    ownerId: userId,
    plan: "pro",
    status: "active",
  });
  await db.insert(memberships).values({
    id: createId(),
    userId,
    accountId,
    role: "owner",
    status: "active",
  });

  console.log("✓ Admin user created");
  console.log(`   email:    ${EMAIL}`);
  console.log(`   password: ${PASSWORD}`);
  console.log(`   → sign in at /auth/login`);

  await queryClient.end();
}

run().catch(async (err) => {
  console.error("create-admin failed:", err);
  try {
    await queryClient.end();
  } catch {}
  process.exit(1);
});
