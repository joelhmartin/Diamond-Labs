import { useNavigate } from "react-router-dom";
import { ROUTES } from "../../config/routes.js";
import { OrganizationsTable } from "../../modules/organizations/index.js";

/** Admin > Groups: the practice groups. A row opens the group's page. */
export function AdminGroupsPage() {
  const navigate = useNavigate();
  return (
    <div className="mx-auto max-w-5xl p-6 md:p-8">
      <div className="mb-6">
        <h1 className="font-heading text-3xl font-bold tracking-tight text-navy">Groups</h1>
        <p className="mt-1 text-sm text-navy/50">Practices that belong together. A group's admins see and pay for every practice in it.</p>
      </div>
      <OrganizationsTable noun="group" onOpen={(g) => navigate(ROUTES.ADMIN_GROUP_DETAIL.replace(":id", g.id))} />
    </div>
  );
}
