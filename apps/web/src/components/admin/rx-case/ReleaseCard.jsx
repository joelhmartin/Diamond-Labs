import { useState } from "react";
import { AlertCircle, Send } from "lucide-react";
import api from "../../../config/api.js";
import { useToast } from "../../ui/Toast.jsx";
import { Modal } from "../../ui/Modal.jsx";
import { errMsg, releaseBlockedReason } from "./helpers.js";

/** "Release to the lab" card plus the legacy-Seazona double-check modal. */
export function ReleaseCard({ caseId, lines, legacyPushUnconfirmed, onReleased }) {
  const { addToast } = useToast();
  const [releasing, setReleasing] = useState(false);
  const [releaseError, setReleaseError] = useState(null);
  const [confirmLegacyOpen, setConfirmLegacyOpen] = useState(false);
  const blockedReason = releaseBlockedReason(lines);

  // A legacy case stuck at seazonaPushStatus "pushing" may already be in Seazona.
  // Staff must confirm they checked before the server will release it.
  const startRelease = () => (legacyPushUnconfirmed ? setConfirmLegacyOpen(true) : doRelease(false));

  const doRelease = async (confirmNotInSeazona) => {
    if (releasing) return;
    setConfirmLegacyOpen(false);
    setReleasing(true);
    setReleaseError(null);
    try {
      const res = await api.post(`/admin/rx-cases/${caseId}/release`, { confirmNotInSeazona });
      const { labOrder: lo, unknownCodes } = res.data.data;
      addToast({
        message: `Released as order #${lo.orderNumber}.${unknownCodes.length ? ` Not in the catalog yet: ${unknownCodes.join(", ")}.` : ""}`,
        type: "success",
      });
      await onReleased();
    } catch (err) {
      setReleaseError(errMsg(err));
    } finally {
      setReleasing(false);
    }
  };

  return (
    <>
      <div className="bg-white rounded-2xl border border-surface-300/50 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-heading font-bold text-sm text-navy mb-1">Release to the lab</h2>
            <p className="text-xs text-navy/50 max-w-md">
              Puts this case on the production board as a lab order, with its lines exactly as they are now.
              {legacyPushUnconfirmed && " A Seazona push for this case was started and never confirmed — check Seazona for an order before releasing."}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <button
              type="button"
              disabled={releasing || !!blockedReason}
              onClick={startRelease}
              title={blockedReason || undefined}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-full text-sm font-bold bg-brand-500 text-white hover:bg-brand-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Send size={14} /> {releasing ? "Releasing…" : "Release to lab"}
            </button>
            {blockedReason && <span className="text-[11px] text-red-600 max-w-xs text-right">{blockedReason}</span>}
          </div>
        </div>
        {releaseError && (
          <div className="mt-3 flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
            <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />
            <span>{releaseError}</span>
          </div>
        )}
      </div>

      <Modal open={confirmLegacyOpen} onClose={() => setConfirmLegacyOpen(false)} title="Check Seazona first">
      <p className="text-sm text-navy/70">
        A Seazona push for this case started and was never confirmed, so an order for it may already exist there.
        Only continue if you checked Seazona and there is no order for this case — otherwise the lab will build it twice.
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={() => setConfirmLegacyOpen(false)} className="px-4 py-2 rounded-full text-sm font-semibold text-navy/50 hover:text-navy">
          Cancel
        </button>
        <button
          type="button"
          onClick={() => doRelease(true)}
          disabled={releasing}
          className="disabled:opacity-50 px-4 py-2 rounded-full text-sm font-bold bg-brand-500 text-white hover:bg-brand-600 transition-colors"
        >
          No Seazona order exists — release
        </button>
      </div>
      </Modal>
    </>
  );
}
