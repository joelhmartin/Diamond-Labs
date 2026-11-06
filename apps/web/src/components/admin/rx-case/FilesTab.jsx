import { FileRow } from "./FileRow.jsx";

export function FilesTab({ caseId, files }) {
  return (
    <div className="bg-white rounded-2xl border border-surface-300/50 p-6">
      <h2 className="font-heading font-bold text-sm text-navy mb-4">Files</h2>
      {files.length === 0 ? (
        <p className="text-sm text-navy/40">No files were uploaded with this case.</p>
      ) : (
        <div className="space-y-2">
          {files.map((f) => (
            <FileRow key={f.id} caseId={caseId} file={f} />
          ))}
        </div>
      )}
    </div>
  );
}
