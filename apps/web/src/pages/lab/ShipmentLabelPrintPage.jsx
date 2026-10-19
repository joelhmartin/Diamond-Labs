import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2, Printer, Download } from "lucide-react";
import api from "../../config/api.js";
import { blobErrorText } from "../../lib/requests.js";
import { labelNeedsRotation, filenameFrom } from "../../lib/shipping.js";

// A 4×6 page with no margins: prints on a 4×6 thermal printer through its
// driver, or on a letter page. UPS GIFs are landscape and are turned onto it.
const PRINT_CSS = `
  @page { size: 4in 6in; margin: 0; }
  @media print { .no-print { display: none !important; } html, body { margin: 0; background: #fff; } }
  .label-page { width: 4in; height: 6in; overflow: hidden; position: relative; background: #fff; }
  .label-img { display: block; width: 4in; height: 6in; object-fit: contain; }
  .label-img.rotated { width: 6in; height: 4in; transform: rotate(90deg) translateY(-100%); transform-origin: top left; }
`;

const BTN = "flex items-center gap-1.5 rounded-full bg-navy px-4 py-2 text-sm font-semibold text-white";

/**
 * The stored label, on its own page (no app shell). The server audit-logs every
 * view. An image label prints through the browser from a blob: URL (revoked on
 * unmount); a ZPL label is a file for a Zebra printer, so it is a download.
 */
export function ShipmentLabelPrintPage() {
  const { id } = useParams();
  const [label, setLabel] = useState(null);
  const [error, setError] = useState(null);
  const [rotated, setRotated] = useState(false);

  useEffect(() => {
    let url = null;
    let live = true;
    setRotated(false);
    setLabel(null);
    setError(null);
    api.get(`/lab/shipments/${id}/label`, { responseType: "blob" })
      .then((res) => {
        if (!live) return;
        url = URL.createObjectURL(res.data);
        const type = res.headers["content-type"] ?? "";
        setLabel({ url, image: type.startsWith("image/"), filename: filenameFrom(res.headers["content-disposition"], `label-${id}.zpl`) });
      })
      .catch(async (err) => { if (live) setError(await blobErrorText(err)); });
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [id]);

  if (error) return <p className="p-8 text-sm text-red-700">{error}</p>;
  if (!label) return <div className="flex items-center gap-2 p-8 text-sm text-gray-500"><Loader2 size={14} className="animate-spin" /> Loading label…</div>;

  return (
    <div>
      <style>{PRINT_CSS}</style>
      <div className="no-print flex items-center gap-3 border-b border-gray-200 p-4">
        {label.image ? (
          <button type="button" onClick={() => window.print()} className={BTN}><Printer size={14} /> Print</button>
        ) : (
          <a href={label.url} download={label.filename} className={BTN}><Download size={14} /> Download {label.filename}</a>
        )}
        <span className="text-xs text-gray-500">{label.image ? "4 × 6 in. Choose the label printer, or letter paper." : "Send this file to the Zebra printer."}</span>
      </div>
      {label.image && (
        <div className="label-page">
          <img
            src={label.url}
            alt="Shipping label"
            className={`label-img ${rotated ? "rotated" : ""}`}
            onLoad={(e) => setRotated(labelNeedsRotation({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight }))}
          />
        </div>
      )}
    </div>
  );
}
