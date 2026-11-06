import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { ROUTES } from "../../config/routes.js";
import { OrganizationDetail } from "../../modules/organizations/index.js";
import { describePractice, practicesSource, usersSource } from "./practice-sources.js";

/** Admin > Groups > one group: its practices, its admins and its settings. */
export function AdminGroupDetailPage() {
  const { id } = useParams();
  return (
    <div className="mx-auto max-w-5xl p-6 md:p-8">
      <Link to={ROUTES.ADMIN_GROUPS} className="mb-4 inline-flex items-center gap-1.5 text-xs font-semibold text-brand-700 hover:underline">
        <ArrowLeft size={12} /> All groups
      </Link>
      <OrganizationDetail
        organizationId={id}
        accountNoun="practice"
        accountsSource={practicesSource}
        describeAccount={describePractice}
        usersSource={usersSource}
        settingsHelp="Send one combined monthly statement for the group instead of one per practice."
      />
    </div>
  );
}
