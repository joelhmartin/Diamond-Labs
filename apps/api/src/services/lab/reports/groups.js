/** The report index's sections, in the audit's (Labzona's) titles and order. */
export const LAB_REPORT_GROUPS = [
  { key: "accounting", title: "Accounting", position: 1 },
  { key: "clients", title: "Clients", position: 2 },
  { key: "departments", title: "Departments", position: 3 },
  { key: "operations", title: "Operations", position: 4 },
  { key: "planning", title: "Planning", position: 5 },
  { key: "productivity", title: "Productivity", position: 6 },
  { key: "products", title: "Products & Services", position: 7 },
  { key: "sales", title: "Sales", position: 8 },
];

export function registerLabGroups(registry) {
  for (const g of LAB_REPORT_GROUPS) registry.defineGroup(g);
}
