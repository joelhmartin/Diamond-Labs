import { db, queryClient } from "../config/database.js";
import { users, accounts, memberships } from "./schema/index.js";
import { createId } from "../lib/id.js";
import { hashPassword } from "../lib/passwords.js";

async function seed() {
  console.log("Seeding database...");

  // Create test user
  const userId = createId();
  const passwordHash = await hashPassword("TestPassword1");

  await db.insert(users).values({
    id: userId,
    email: "admin@example.com",
    emailVerifiedAt: new Date(),
    passwordHash,
    name: "Test Admin",
    status: "active",
  });

  // Create test account
  const accountId = createId();
  await db.insert(accounts).values({
    id: accountId,
    name: "Test Account",
    slug: "test-account",
    ownerId: userId,
    plan: "pro",
    status: "active",
  });

  // Create owner membership
  await db.insert(memberships).values({
    id: createId(),
    userId,
    accountId,
    role: "owner",
    status: "active",
  });

  console.log("Seed complete.");
  console.log("  User: admin@example.com / TestPassword1");
  await queryClient.end();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
