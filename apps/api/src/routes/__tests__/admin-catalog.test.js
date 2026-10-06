import { test } from "vitest";
import assert from "node:assert/strict";
import { catalogErrorReply } from "../admin-catalog.routes.js";
import { CatalogError } from "../../services/catalog.service.js";

test("catalog errors map to the status an admin UI can act on", () => {
  assert.equal(catalogErrorReply(new CatalogError("NOT_FOUND", "x")).status, 404);
  assert.equal(catalogErrorReply(new CatalogError("CONFLICT", "x")).status, 409);
  assert.equal(catalogErrorReply(new CatalogError("INVALID", "x")).status, 422);
  assert.equal(catalogErrorReply(new CatalogError("CONFLICT", "Code taken.")).body.error.message, "Code taken.");
});

test("anything else is not swallowed", () => {
  assert.equal(catalogErrorReply(new Error("boom")), null);
});
