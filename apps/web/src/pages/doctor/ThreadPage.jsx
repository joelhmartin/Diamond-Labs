import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { LAB_TIMEZONE } from "@my-app/shared";
import { ROUTES } from "../../config/routes.js";
import { ThreadView } from "../../modules/messaging/index.js";

export function ThreadPage() {
  const { id } = useParams();
  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <Link to={ROUTES.DOCTOR_MESSAGES} className="mb-6 inline-flex items-center gap-1 text-xs text-navy/60 hover:text-navy">
        <ArrowLeft size={12} /> Messages
      </Link>
      <ThreadView threadId={id} side="party" timeZone={LAB_TIMEZONE} />
    </div>
  );
}
