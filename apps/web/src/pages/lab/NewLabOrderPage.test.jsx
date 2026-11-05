// @vitest-environment jsdom
import { test, afterEach, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { ToastProvider } from "../../components/ui/Toast.jsx";

// Plain recorders, not vi.fn(): vitest 2 re-throws a rejected mock result as an unhandled error.
const posts = [];
const previews = []; // params of each GET /lab/schedule/preview
let postReply = async () => ({});
const FAMILIES = [{ id: "fam1", name: "Night guard", active: true, variants: [{ id: "var1", code: "NG1", name: "Hard night guard", active: true }] }];
const PRACTICES = [{ id: "doc1", name: "Dr Smith", email: "smith@x.test" }];
vi.mock("../../config/api.js", () => ({
  default: {
    get: async (url, config) => {
      if (url === "/lab/practices") return { data: { data: { practices: PRACTICES } } };
      if (url === "/lab/catalog/families") return { data: { data: { families: FAMILIES } } };
      if (url === "/lab/schedule/preview") {
        previews.push(config?.params ?? {});
        const rush = config?.params?.rush === "true";
        return { data: { data: { dueDate: rush ? "2026-11-12" : "2026-11-18", plan: { workflowName: rush ? "Rush 5-day" : "10-day printed" } } } };
      }
      if (url === "/files/intake/i7") return { data: { data: [{ id: "f1", originalName: "dropped-scan.stl", kind: "scan", size: 3 }] } };
      if (url === "/tags/lab_order/definitions") return { data: { data: [{ id: "t1", label: "SAMPLE MODEL" }] } };
      throw new Error(`unexpected GET ${url}`);
    },
    post: (...a) => { posts.push(a); return postReply(...a); },
  },
}));
const { NewLabOrderPage } = await import("./NewLabOrderPage.jsx");

afterEach(cleanup);
beforeEach(() => {
  posts.length = 0;
  previews.length = 0;
  postReply = async (url) => {
    if (url === "/lab/orders") return { data: { data: { labOrder: { id: "lo9", orderNumber: 1009 }, invoice: { id: "inv" }, panWarning: null } } };
    if (url === "/lab/orders/price-preview") return { data: { data: { lines: [{ variantId: "var1", unitCents: 4500, priceSource: "client" }] } } };
    return { data: { data: {} } };
  };
});

function mount(entry = "/lab/orders/new") {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <ToastProvider>
        <Routes>
          <Route path="/lab/orders/new" element={<NewLabOrderPage />} />
          <Route path="/lab/orders/:id" element={<div>ORDER PAGE</div>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

async function fillRequired() {
  await waitFor(() => assert.equal(screen.getByLabelText("Due date").value, "2026-11-18"));
  await waitFor(() => screen.getByRole("option", { name: /Dr Smith/ }));
  fireEvent.change(screen.getByLabelText("Practice"), { target: { value: "doc1" } });
  fireEvent.change(screen.getByLabelText("Patient"), { target: { value: " Pat Jones " } });
}

test("quick mode hides lines, enclosed and files", async () => {
  mount();
  await fillRequired();
  assert.ok(screen.getByLabelText("Pan number"));
  assert.equal(screen.queryByText("Lines"), null);
  assert.equal(screen.queryByText("Enclosed items"), null);
  assert.equal(screen.queryByTestId("file-drop-input"), null);
  fireEvent.click(screen.getByRole("button", { name: "Full" }));
  assert.ok(screen.getByText("Lines"));
  assert.ok(screen.getByText("Enclosed items"));
  assert.ok(screen.getByTestId("file-drop-input"));
});

test("submit posts the body and then uploads files", async () => {
  mount();
  await fillRequired();
  fireEvent.click(screen.getByRole("button", { name: "Full" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Rush" }));
  await screen.findByRole("option", { name: "Night guard" });
  fireEvent.change(screen.getByLabelText("Product family"), { target: { value: "fam1" } });
  fireEvent.click(screen.getByRole("button", { name: "Add line" }));
  await screen.findByText(/1 × NG1/);
  const file = new File(["x"], "scan.stl");
  fireEvent.change(screen.getByTestId("file-drop-input"), { target: { files: [file] } });
  fireEvent.click(screen.getByRole("button", { name: "Create order" }));
  await screen.findByText("ORDER PAGE");
  const [create, upload] = posts.filter(([u]) => u !== "/lab/orders/price-preview");
  assert.equal(create[0], "/lab/orders");
  // The due date shown follows the scheduling preview for the lines and rush; untouched, the server plans it.
  assert.deepEqual(previews.at(-1), { variantIds: "var1", rush: "true" });
  assert.deepEqual(create[1], {
    clientUserId: "doc1", patientName: "Pat Jones", pan: null, notes: null,
    rush: true, deliveryMethod: null, enclosures: null, lines: [{ variantId: "var1", qty: 1 }], tagIds: [],
  });
  assert.equal(upload[0], "/files/lab_order/lo9");
  assert.ok(upload[1] instanceof FormData);
  assert.equal(upload[1].get("other").name, "scan.stl");
});

test("quick submit sends only the quick fields", async () => {
  mount();
  await fillRequired();
  fireEvent.change(screen.getByLabelText("Pan number"), { target: { value: "P-7" } });
  fireEvent.click(screen.getByRole("button", { name: "Create order" }));
  await screen.findByText("ORDER PAGE");
  assert.deepEqual(posts[0][1], { clientUserId: "doc1", patientName: "Pat Jones", pan: "P-7", notes: null });
});

test("the due date follows the scheduling preview until staff type one, which is then sent", async () => {
  mount();
  await fillRequired();
  assert.deepEqual(previews[0], { variantIds: undefined, rush: undefined });
  assert.ok(screen.getByText("Scheduled by 10-day printed"));
  fireEvent.click(screen.getByRole("button", { name: "Full" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Rush" }));
  await waitFor(() => assert.equal(screen.getByLabelText("Due date").value, "2026-11-12"));
  fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2026-12-01" } });
  assert.equal(screen.queryByText(/Scheduled by/), null);
  fireEvent.click(screen.getByRole("button", { name: "Create order" }));
  await screen.findByText("ORDER PAGE");
  assert.equal(posts.find(([u]) => u === "/lab/orders")[1].dueDate, "2026-12-01");
});

test("a failed upload still navigates and toasts a count, never the file names", async () => {
  const base = postReply;
  postReply = async (url, ...rest) => {
    if (url.startsWith("/files/")) throw new Error("Upload failed.");
    return base(url, ...rest);
  };
  mount();
  await fillRequired();
  fireEvent.click(screen.getByRole("button", { name: "Full" }));
  fireEvent.change(screen.getByTestId("file-drop-input"), { target: { files: [new File(["x"], "jane-doe-upper.stl"), new File(["y"], "jane-doe-lower.stl")] } });
  fireEvent.click(screen.getByRole("button", { name: "Create order" }));
  await screen.findByText("ORDER PAGE");
  assert.ok(await screen.findByText(/2 files did not upload/));
  assert.equal(screen.queryByText(/jane-doe/), null, "no file name in the toast");
});

test("a pan warning toasts the other open order", async () => {
  const base = postReply;
  postReply = async (url, ...rest) => {
    if (url === "/lab/orders") return { data: { data: { labOrder: { id: "lo9", orderNumber: 1009 }, invoice: {}, panWarning: { orderNumber: 812 } } } };
    return base(url, ...rest);
  };
  mount();
  await fillRequired();
  fireEvent.change(screen.getByLabelText("Pan number"), { target: { value: "P-7" } });
  fireEvent.click(screen.getByRole("button", { name: "Create order" }));
  assert.ok(await screen.findByText("Pan P-7 is also on open order #812"));
});

test("price preview shows client price and source badge", async () => {
  mount();
  await fillRequired();
  fireEvent.click(screen.getByRole("button", { name: "Full" }));
  await screen.findByRole("option", { name: "Night guard" });
  fireEvent.change(screen.getByLabelText("Product family"), { target: { value: "fam1" } });
  fireEvent.click(screen.getByRole("button", { name: "Add line" }));
  assert.ok(await screen.findByText("$45.00"));
  assert.ok(screen.getByText("Client price"));
  const preview = posts.find(([u]) => u === "/lab/orders/price-preview");
  assert.deepEqual(preview[1], { clientUserId: "doc1", lines: [{ variantId: "var1", qty: 1 }] });
});

test("?intake= shows that intake's files and sends intakeId on create", async () => {
  mount("/lab/orders/new?intake=i7");
  await screen.findByText("dropped-scan.stl");
  await fillRequired();
  fireEvent.click(screen.getByRole("button", { name: "Create order" }));
  await screen.findByText("ORDER PAGE");
  assert.deepEqual(posts[0][1], { clientUserId: "doc1", patientName: "Pat Jones", intakeId: "i7", pan: null, notes: null });
});
