import { ExportScreen } from "../../modules/exports/index.js";

export function AdminExportsPage() {
  return (
    <div className="mx-auto max-w-7xl space-y-4 px-6 py-8">
      <div>
        <h1 className="font-heading text-3xl font-bold tracking-tight text-navy">Export invoices</h1>
        <p className="mt-1 text-sm text-navy/50">
          By ordered, due or issued date and status. QuickBooks and Xero formats come later.
        </p>
      </div>
      <ExportScreen basePath="/admin/exports" defaultSource="invoices" />
    </div>
  );
}
