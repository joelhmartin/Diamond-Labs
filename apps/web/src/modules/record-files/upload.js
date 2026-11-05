import api from "../../config/api.js";

/** The base path for one record's files. */
export const recordFilesPath = (recordType, recordId) => `/files/${encodeURIComponent(recordType)}/${encodeURIComponent(recordId)}`;

/** Uploads `files` to a record in one multipart request; each part's field name is its kind. Rejects with the API error. */
export function uploadRecordFiles(recordType, recordId, files, kind = "other") {
  const form = new FormData();
  files.forEach((f) => form.append(kind, f));
  return api.post(recordFilesPath(recordType, recordId), form, { headers: { "Content-Type": "multipart/form-data" } });
}
