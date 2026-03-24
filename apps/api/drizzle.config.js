import "dotenv/config";

/** @type {import("drizzle-kit").Config} */
export default {
  schema: "./src/db/schema/index.js",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
};
