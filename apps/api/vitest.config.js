import { defineConfig } from "vitest/config";

// config/env.js validates process.env at import time and calls process.exit(1)
// when it fails — so ANY test importing a module that reaches it (db, routes,
// services) dies before a single assertion runs. These are syntactically valid
// placeholders, not credentials: postgres-js connects lazily, so nothing here
// opens a connection. A test that genuinely needs a database must set its own.
export default defineConfig({
  test: {
    env: {
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
      JWT_SECRET: "test-secret-not-used-for-anything-real",
    },
  },
});
