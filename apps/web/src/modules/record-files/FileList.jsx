import { useCallback, useEffect, useState } from "react";
import api from "../../config/api.js";
import { errorText, openInNewTab } from "../../lib/requests.js";
import { useToast } from "../../components/ui/Toast.jsx";
import { ConfirmButton } from "../../components/ui/ConfirmButton.jsx";
import { DataTable } from "../../components/ui/data-table/index.js";
import { useDataTable } from "../../hooks/useDataTable.js";
import { FileDrop } from "./FileDrop.jsx";
import { recordFilesPath as base, uploadRecordFiles } from "./upload.js";
import { fileSizeLabel } from "./format.js";

/**
 * Lists a record's files; clicking one opens a short-lived signed link in a new tab.
 * `canEdit` adds an upload drop zone (files go up under `uploadKind`) and a remove button per file.
 */
export function FileList({ recordType, recordId, canEdit = false, uploadKind = "other", accept }) {
  const { addToast } = useToast();
  const fail = (err) => addToast({ message: errorText(err), type: "error" });
  const [files, setFiles] = useState(null);
  const [busy, setBusy] = useState(false);

  const table = useDataTable({ mode: "client", rows: files ?? [], loading: files === null, initialPageSize: 1000 });

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
    setBusy(true);
    try {
      await uploadRecordFiles(recordType, recordId, picked, uploadKind);
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

  const columns = [
    {
      id: "name", header: "File", sortValue: (f) => f.originalName,
      cell: (f) => <button type="button" className="text-left text-brand-700 hover:underline" onClick={() => open(f)}>{f.originalName}</button>,
    },
    { id: "kind", header: "Kind", cell: (f) => f.kind, sortValue: (f) => f.kind },
    { id: "size", header: "Size", align: "right", cell: (f) => fileSizeLabel(f.size), sortValue: (f) => f.size },
    ...(canEdit
      ? [{ id: "actions", header: "", export: false, align: "right", cell: (f) => <ConfirmButton onConfirm={() => remove(f)} confirmLabel="Click again to remove">Remove</ConfirmButton> }]
      : []),
  ];

  return (
    <div className="space-y-2">
      <DataTable
        table={table}
        columns={columns}
        searchable={false}
        selectable={false}
        exportable={false}
        paginated={false}
        dense
        itemLabel="files"
        emptyText="No files."
      />
      {canEdit && <FileDrop accept={accept} onFiles={upload} disabled={busy} />}
    </div>
  );
}
