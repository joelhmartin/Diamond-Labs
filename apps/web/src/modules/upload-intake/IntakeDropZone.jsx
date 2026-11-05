import { useState } from "react";
import { INTAKE_ACCEPTED_EXTENSIONS, INTAKE_SPLITS } from "@my-app/shared";
import api from "../../config/api.js";
import { errorText } from "../../lib/requests.js";
import { useToast } from "../../components/ui/Toast.jsx";
import { SegmentedControl } from "../../components/ui/SegmentedControl.jsx";
import { FileDrop } from "../record-files/index.js";

/**
 * "2 files were refused: unsupported type." — counted by the server's name-free
 * `reason`, never naming files (scanner exports are often named after a person).
 */
export function refusedText(refused) {
  const counts = new Map();
  for (const r of refused) counts.set(r.reason || "not added", (counts.get(r.reason || "not added") ?? 0) + 1);
  return [...counts].map(([reason, n]) => `${n} ${n === 1 ? "file was" : "files were"} refused: ${reason}.`).join(" ");
}

const SPLIT_OPTIONS = [
  { value: INTAKE_SPLITS[0], label: "One intake" },
  { value: INTAKE_SPLITS[1], label: "One per file" },
];

/**
 * Drop scanner-export files to create pending intakes. "One intake" keeps the files together;
 * "One per file" makes an intake for each. Files with an unaccepted type are counted (not named)
 * in a toast and the rest proceed. `onDropped(result)` runs after anything was created.
 */
export function IntakeDropZone({ basePath = "/intake", onDropped, disabled = false }) {
  const { addToast } = useToast();
  const [split, setSplit] = useState(INTAKE_SPLITS[0]);
  const [busy, setBusy] = useState(false);

  const send = async (files) => {
    setBusy(true);
    try {
      const form = new FormData();
      form.append("split", split);
      files.forEach((f) => form.append("files", f));
      const { data } = await api.post(basePath, form, { headers: { "Content-Type": "multipart/form-data" } });
      const { intakes, refused } = data.data;
      if (intakes.length) addToast({ message: `${intakes.length} ${intakes.length === 1 ? "intake" : "intakes"} added.`, type: "success" });
      if (refused.length) addToast({ message: refusedText(refused), type: intakes.length ? "warning" : "error", duration: 10000 });
      if (intakes.length) onDropped?.(data.data);
    } catch (err) {
      addToast({ message: errorText(err), type: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <SegmentedControl label="Split" value={split} onChange={setSplit} options={SPLIT_OPTIONS} />
        <span className="text-xs text-navy/40">{INTAKE_ACCEPTED_EXTENSIONS.join(" ")}</span>
      </div>
      <FileDrop
        accept={INTAKE_ACCEPTED_EXTENSIONS.join(",")}
        onFiles={send}
        disabled={disabled || busy}
        label={busy ? "Uploading…" : "Drop scanner files here or click to choose"}
      />
    </div>
  );
}
