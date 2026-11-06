/**
 * The 63 reports the Labzona audit names, by group key and exact title (spec
 * "Coverage of every audit report"). catalog.test.js checks each is defined
 * exactly once; adding a report the audit missed is one more defineReport,
 * not an edit here.
 */
const group = (key, titles) => titles.map((title) => ({ group: key, title }));

export const AUDIT_REPORTS = Object.freeze([
  ...group("accounting", [
    "Account Balance", "Adjustments", "Aging Summary", "Discounts", "Invoices", "Invoices Summary",
    "Invoices & Payments", "Payments Received", "Statements Summary",
  ]),
  ...group("clients", [
    "Client Health", "Client List", "Doctors List", "Top Clients", "Bottom Clients", "Inactive Clients",
    "New Client Orders", "No Recent Sales", "Same Pricing",
  ]),
  ...group("departments", [
    "Monitoring Boards", "Dept Orders", "Dept Completed", "Dept Moved", "Dept Summary", "Dept Tasks",
    "Dept Tasks Summary", "Dept Units",
  ]),
  ...group("operations", [
    "Case Submission", "Daily Orders", "Daily Shipments", "Daily Tasks", "Deliveries", "Pan Numbers",
    "Pick Ups", "Production Tasks", "Shipping", "TBD Orders",
  ]),
  ...group("planning", [
    "Calendar", "Tasks Schedule", "Technician Workload", "Assigned Orders", "Assigned Tasks",
    "Assigned Tasks Summary", "Assigned Units Chart",
  ]),
  ...group("productivity", [
    "Orders", "Orders Completed", "Tasks Completed", "Monthly Counts", "Monthly Orders", "Remakes",
    "Turnaround Times",
  ]),
  ...group("products", ["Materials Used", "Price List", "Products Sold", "Units Sold", "Units Sold Detail"]),
  ...group("sales", [
    "Sales Comparison", "Sales Summary", "Daily Sales", "Lab Sales", "Net Sales Chart",
    "Product Category Sales", "Sales By Doctor", "Sales By Rep",
  ]),
]);
