import { createExportRegistry, csvFormat } from "../modules/exports/index.js";
import { logSafe } from "../services/audit.service.js";
import { invoicesSource } from "./invoices.export.js";

/** The app's export registry: the csv format and the invoices source. A new format or source is one defineX call here. */
export const appExports = createExportRegistry();
appExports.defineFormat(csvFormat);
appExports.defineSource(invoicesSource);

/** Audit a finished download: who, which export, the options and a row count. Never row data. */
export function auditExportDownload({ actorId, sourceKey, formatKey, params, rowCount }) {
  logSafe({
    userId: actorId,
    action: "export.downloaded",
    targetType: "export",
    targetId: sourceKey,
    metadata: { format: formatKey, params, rowCount },
  });
}
