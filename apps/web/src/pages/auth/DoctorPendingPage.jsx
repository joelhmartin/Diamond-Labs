import { Link } from "react-router-dom";
import { AuthLayout } from "../../components/layout/AuthLayout.jsx";
import { Card } from "../../components/ui/Card.jsx";
import { ROUTES } from "../../config/routes.js";
import { Clock } from "lucide-react";

export function DoctorPendingPage() {
  return (
    <AuthLayout>
      <Card className="max-w-md text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100">
          <Clock className="h-7 w-7 text-amber-600" />
        </div>
        <h2 className="mb-2 text-xl font-semibold">Registration Submitted</h2>
        <p className="mb-6 text-sm text-gray-500">
          Your doctor account is pending admin approval. You'll receive an email once your account has been reviewed.
        </p>
        <Link
          to={ROUTES.LOGIN}
          className="text-sm text-brand-600 hover:underline"
        >
          Back to sign in
        </Link>
      </Card>
    </AuthLayout>
  );
}
