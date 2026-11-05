// @vitest-environment jsdom
import { test, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, cleanup, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

let role = "lab";
vi.mock("../../hooks/useAuth.js", () => ({ useAuth: () => ({ user: { id: "me", role } }) }));
vi.mock("../../hooks/usePermission.js", () => ({ usePermission: () => ({ can: () => false }) }));
const { Sidebar } = await import("./Sidebar.jsx");

afterEach(() => { cleanup(); role = "lab"; });

/** The links listed under a section heading ("Lab" or "Admin"), in order. */
function sectionLinks(title) {
  const nav = screen.getByRole("navigation");
  const links = within(nav).getAllByRole("link");
  const heading = within(nav).getByText(title);
  return links.filter((a) => heading.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING);
}

test("staff see Lab dashboard first in the Lab section, linking to the lab dashboard", () => {
  render(<MemoryRouter><Sidebar /></MemoryRouter>);
  const lab = sectionLinks("Lab");
  assert.equal(lab[0].textContent, "Lab dashboard");
  assert.ok(lab[0].getAttribute("href").endsWith("/lab/dashboard"));
  assert.deepEqual(lab.map((a) => a.textContent), ["Lab dashboard", "Production", "Calendar", "Intake", "New order", "Rx Cases", "Shipments", "Reports"]);
});

test("admins see the same Lab section, then Admin", () => {
  role = "admin";
  render(<MemoryRouter><Sidebar /></MemoryRouter>);
  assert.equal(sectionLinks("Lab")[0].getAttribute("href"), "/lab/dashboard");
  // One "Dashboard" (the account page) and one "Lab dashboard": no duplicate labels.
  const labels = screen.getAllByRole("link").map((a) => a.textContent);
  assert.equal(labels.filter((l) => l === "Dashboard").length, 1);
  assert.equal(labels.filter((l) => l === "Lab dashboard").length, 1);
  assert.ok(screen.getByText("Admin"));
});

test("a doctor sees no Lab section", () => {
  role = "doctor";
  render(<MemoryRouter><Sidebar /></MemoryRouter>);
  assert.equal(screen.queryByText("Lab"), null);
});
