// @vitest-environment jsdom
import { test, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("../../hooks/usePermission.js", () => ({ usePermission: () => ({ can: () => true }) }));
vi.mock("../../components/account/MemberList.jsx", () => ({ MemberList: () => <div>member list</div> }));
vi.mock("../../components/account/InviteMemberModal.jsx", () => ({ InviteMemberModal: () => null }));
const { MembersPage } = await import("./MembersPage.jsx");
const { useAccountStore } = await import("../../stores/account.store.js");

afterEach(() => { cleanup(); useAccountStore.setState({ activeAccount: null }); });

test("a practice gets no member list or invite: the lab manages its staff", () => {
  useAccountStore.setState({ activeAccount: { accountId: "a1", role: "owner", isClient: true } });
  render(<MembersPage />);
  assert.equal(screen.queryByText("member list"), null);
  assert.equal(screen.queryByRole("button", { name: "Invite Member" }), null);
  assert.ok(screen.getByText(/The lab manages who works in this practice/));
});

test("a plain account keeps the self-service page", () => {
  useAccountStore.setState({ activeAccount: { accountId: "a2", role: "owner", isClient: false } });
  render(<MembersPage />);
  assert.ok(screen.getByText("member list"));
  assert.ok(screen.getByRole("button", { name: "Invite Member" }));
});
