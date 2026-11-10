import { ChangePasswordForm, ProfileNameForm } from "../../components/account/ProfileForms.jsx";

export default function AccountPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6 px-6 py-8">
      <h1 className="text-2xl font-bold text-gray-900">Account</h1>
      <ProfileNameForm />
      <ChangePasswordForm />
    </div>
  );
}
