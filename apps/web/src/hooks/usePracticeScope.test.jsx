// @vitest-environment jsdom
import { test, beforeEach, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { renderHook, act, cleanup } from "@testing-library/react";

const get = vi.hoisted(() => vi.fn());
vi.mock("../config/api.js", () => ({ default: { get } }));

import { useAccountStore } from "../stores/account.store.js";
import { usePracticeScope } from "./usePracticeScope.js";

const A = { id: "a1", name: "North Dental", accountNumber: "1001", organizationId: "g1", via: "org-admin", role: "admin", payable: true };
const B = { id: "a2", name: "South Dental", accountNumber: "1002", organizationId: "g1", via: "org-admin", role: "admin", payable: true };
const reply = (accounts) => ({ data: { data: { accounts, organizations: [] } } });

beforeEach(() => { sessionStorage.clear(); useAccountStore.getState().clearClientScope(); });
afterEach(() => { cleanup(); get.mockReset(); sessionStorage.clear(); });

test("a stored scope no longer in clientScope falls back to all", async () => {
  sessionStorage.setItem("practiceScope", "gone");
  get.mockResolvedValue(reply([A, B]));
  await useAccountStore.getState().fetchClientScope();
  assert.equal(useAccountStore.getState().practiceScope, "all");
  assert.equal(sessionStorage.getItem("practiceScope"), "all");
});

test("a stored scope that is still a practice of the login is kept", async () => {
  sessionStorage.setItem("practiceScope", "a2");
  get.mockResolvedValue(reply([A, B]));
  await useAccountStore.getState().fetchClientScope();
  assert.equal(useAccountStore.getState().practiceScope, "a2");
});

test("usePracticeScope: param is the one practice in view, nothing for all; set refuses a stranger", async () => {
  get.mockResolvedValue(reply([A, B]));
  await useAccountStore.getState().fetchClientScope();
  const { result } = renderHook(() => usePracticeScope());
  assert.equal(result.current.isAll, true);
  assert.equal(result.current.param, undefined);
  assert.equal(result.current.multi, true);
  act(() => result.current.set("a1"));
  assert.equal(result.current.param, "a1");
  assert.equal(result.current.isAll, false);
  act(() => result.current.set("not-mine"));
  assert.equal(result.current.scope, "all");
});

test("storage that throws does not break the scope", async () => {
  const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
  const setSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
  get.mockResolvedValue(reply([A]));
  await useAccountStore.getState().fetchClientScope();
  assert.equal(useAccountStore.getState().practiceScope, "all");
  spy.mockRestore(); setSpy.mockRestore();
});
