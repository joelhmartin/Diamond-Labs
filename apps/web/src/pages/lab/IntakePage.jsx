import { useState } from "react";
import { IntakeDropZone, IntakeQueue } from "../../modules/upload-intake/index.js";

const BASE = "/lab/intake";

/** Lab › Intake: drop scanner exports, then turn each pending intake into an order or discard it. */
export function IntakePage() {
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6 md:p-8">
      <div>
        <h1 className="font-heading text-3xl font-bold tracking-tight text-navy">Intake</h1>
        <p className="mt-1 text-sm text-navy/50">Scanner files wait here until someone turns them into an order. Nothing is numbered until then.</p>
      </div>
      <IntakeDropZone basePath={BASE} onDropped={() => setRefreshKey((k) => k + 1)} />
      <IntakeQueue basePath={BASE} refreshKey={refreshKey} createHref={(i) => `/lab/orders/new?intake=${encodeURIComponent(i.id)}`} />
    </div>
  );
}
