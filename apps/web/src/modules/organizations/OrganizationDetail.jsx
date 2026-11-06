import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { SegmentedControl } from "../../components/ui/SegmentedControl.jsx";
import { errorText } from "../../lib/requests.js";
import { AccountsTab } from "./AccountsTab.jsx";
import { AdminsTab } from "./AdminsTab.jsx";
import { SettingsTab } from "./SettingsTab.jsx";
import { fetchOrganization } from "./api.js";

const TABS = [{ value: "accounts", label: "Accounts" }, { value: "admins", label: "Admins" }, { value: "settings", label: "Settings" }];

/**
 * One organization: Accounts, Admins and Settings tabs.
 *
 *   accountsSource, describeAccount, accountNoun   see AccountsTab
 *   usersSource                                    see AdminsTab
 *   settingsHelp                                   see SettingsTab
 *   base                                           API path (default the admin mount)
 */
export function OrganizationDetail({ organizationId, accountsSource, describeAccount, accountNoun, usersSource, settingsHelp, base }) {
  const [org, setOrg] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("accounts");

  const load = useCallback(async () => {
    try {
      setOrg(await fetchOrganization(organizationId, base));
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [organizationId, base]);
  useEffect(() => { load(); }, [load]);

  if (error) return <p role="alert" className="text-sm text-red-700">{errorText(error)}</p>;
  if (!org) return <div className="flex items-center gap-2 text-sm text-navy/50"><Loader2 size={14} className="animate-spin" /> Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-navy">
          {org.name}
          {org.status === "archived" && <span className="ml-2 rounded-full bg-surface-100 px-2 py-0.5 align-middle text-xs font-medium text-navy/60">Archived</span>}
        </h2>
        <SegmentedControl label="Section" value={tab} onChange={setTab} options={TABS} />
      </div>
      {tab === "accounts" && (
        <AccountsTab organizationId={org.id} accounts={org.accounts ?? []} accountsSource={accountsSource} describeAccount={describeAccount} noun={accountNoun} base={base} onChanged={load} />
      )}
      {tab === "admins" && <AdminsTab organizationId={org.id} admins={org.admins ?? []} usersSource={usersSource} base={base} onChanged={load} />}
      {tab === "settings" && <SettingsTab organization={org} base={base} settingsHelp={settingsHelp} onChanged={load} />}
    </div>
  );
}
