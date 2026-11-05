import { useCallback, useEffect, useState } from "react";
import api from "../../config/api.js";
import { errorText, openInNewTab } from "../../lib/requests.js";
import { useToast } from "../../components/ui/Toast.jsx";
import { ConfirmButton } from "../../components/ui/ConfirmButton.jsx";
import { FileDrop } from "./FileDrop.jsx";

const base = (recordType, recordId) => `/files/${encodeURIComponent(recordType)}/${encodeURIComponent(recordId)}`;
const sizeLabel = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/**
 * Lists a record's files; clicking one opens a short-lived signed link in a new tab.
 * `canEdit` adds an upload drop zone (files go up under `uploadKind`) and a remove button per file.
 */
export function FileList({ recordType, recordId, canEdit = false, uploadKind = "other", accept }) {
  const { addToast } = useToast();
  const fail = (err) => addToast({ message: errorText(err), type: "error" });
  const [files, setFiles] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(base(recordType, recordId));
      setFiles(data.data);
    } catch (err) {
      setFiles([]);
      fail(err);
    }
  }, [recordType, recordId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const open = (file) =>
    openInNewTab(async () => (await api.get(`${base(recordType, recordId)}/${encodeURIComponent(file.id)}/url`)).data.data.url)
      .catch((err) => fail(err));

  const upload = async (picked) => {
    const form = new FormData();
    picked.forEach((f) => form.append(uploadKind, f));
    setBusy(true);
    try {
      await api.post(base(recordType, recordId), form, { headers: { "Content-Type": "multipart/form-data" } });
      await load();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (file) => {
    try {
      await api.delete(`${base(recordType, recordId)}/${encodeURIComponent(file.id)}`);
      await load();
    } catch (err) {
      fail(err);
    }
  };

  if (files === null) return <p className="text-sm text-gray-500">Loading files...</p>;
  return (
    <div className="space-y-2">
      {files.length === 0 && <p className="text-sm text-gray-500">No files.</p>}
      <ul className="divide-y divide-gray-100">
        {files.map((f) => (
          <li key={f.id} className="flex items-center justify-between gap-3 py-2 text-sm">
            <button type="button" className="text-left text-brand-700 hover:underline truncate" onClick={() => open(f)}>
              {f.originalName}
            </button>
            <span className="shrink-0 text-gray-500">{f.kind} · {sizeLabel(f.size)}</span>
            {canEdit && <ConfirmButton onConfirm={() => remove(f)} confirmLabel="Click again to remove">Remove</ConfirmButton>}
          </li>
        ))}
      </ul>
      {canEdit && <FileDrop accept={accept} onFiles={upload} disabled={busy} />}
    </div>
  );
}
