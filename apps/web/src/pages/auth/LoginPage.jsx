import { Link } from "react-router-dom";
import { AuthLayout } from "../../components/layout/AuthLayout.jsx";
import { LoginForm } from "../../components/auth/LoginForm.jsx";
import { Card } from "../../components/ui/Card.jsx";
import { ROUTES } from "../../config/routes.js";

export function LoginPage() {
  return (
    <AuthLayout>
      <Card>
        <h2 className="mb-6 text-center text-xl font-semibold">Sign in to your account</h2>
        <LoginForm />
        <div className="mt-4 space-y-2 text-center text-sm">
          <p>
            <Link to={ROUTES.FORGOT_PASSWORD} className="text-brand-600 hover:underline">
              Forgot password?
            </Link>
          </p>
          <p className="text-gray-500">
            Don't have an account?{" "}
            <Link to={ROUTES.REGISTER} className="text-brand-600 hover:underline">
              Sign up
            </Link>
          </p>
        </div>
      </Card>
    </AuthLayout>
  );
}
