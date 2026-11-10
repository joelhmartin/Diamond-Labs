import { H1 } from "../../components/ui/Typography.jsx";
import { AccountSettings } from "../../components/account/AccountSettings.jsx";
import { ChangePasswordForm, ProfileNameForm } from "../../components/account/ProfileForms.jsx";
import { usePermission } from "../../hooks/usePermission.js";

export function SettingsPage() {
  const { can } = usePermission();

  return (
    <div className="space-y-6">
      <H1>Settings</H1>
      <ProfileNameForm />
      <ChangePasswordForm />
      {can("settings:update") && <AccountSettings />}
    </div>
  );
}
