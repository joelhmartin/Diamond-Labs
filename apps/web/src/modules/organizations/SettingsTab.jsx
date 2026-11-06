import { useState } from "react";
import { Archive, ArchiveRestore } from "lucide-react";
import { Button } from "../../components/ui/Button.jsx";
import { ConfirmButton } from "../../components/ui/ConfirmButton.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { useToast } from "../../components/ui/Toast.jsx";
import { errorText } from "../../lib/requests.js";
import { updateOrganization } from "./api.js";

/**
 * Name, the combined-statement switch and archive / restore for one organization.
 * `settingsHelp` (optional) explains the combined-statement switch in the host's words.
 */
export function SettingsTab({ organization, base, settingsHelp, onChanged }) {
  const { addToast } = useToast();
  const [name, setName] = useState(organization.name);
  const [combined, setCombined] = useState(Boolean(organization.settings?.combinedStatement));
  const [saving, setSaving] = useState(false);
  const archived = organization.status === "archived";
  const dirty = name.trim() !== organization.name || combined !== Boolean(organization.settings?.combinedStatement);

  const patch = async (body, message) => {
    try {
      await updateOrganization(organization.id, body, base);
      addToast({ message, type: "success" });
      onChanged();
    } catch (err) {
      addToast({ message: errorText(err), type: "error" });
    }
  };
  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    await patch({ name: name.trim(), settings: { combinedStatement: combined } }, "Saved.");
    setSaving(false);
  };

  return (
    <div className="max-w-xl space-y-6">
      <form onSubmit={save} className="space-y-4">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        <label className="flex items-start gap-2 text-sm text-navy">
          <input type="checkbox" className="mt-0.5" checked={combined} onChange={(e) => setCombined(e.target.checked)} />
          <span>
            Combined statement
            {settingsHelp && <span className="block text-xs text-navy/50">{settingsHelp}</span>}
          </span>
        </label>
        <Button type="submit" loading={saving} disabled={!dirty || !name.trim()}>Save</Button>
      </form>
      <div className="border-t border-surface-300/60 pt-4">
        {archived ? (
          <Button variant="secondary" onClick={() => patch({ status: "active" }, "Restored.")}><ArchiveRestore size={14} /> Restore</Button>
        ) : (
          <ConfirmButton
            className="inline-flex items-center gap-2 rounded-lg bg-red-50 px-4 py-2 text-sm font-medium text-red-700"
            confirmLabel="Click again to archive"
            onConfirm={() => patch({ status: "archived" }, "Archived.")}
          >
            <Archive size={14} /> Archive
          </ConfirmButton>
        )}
        <p className="mt-2 text-xs text-navy/50">An archived group grants nothing. Its accounts and admins are kept.</p>
      </div>
    </div>
  );
}
