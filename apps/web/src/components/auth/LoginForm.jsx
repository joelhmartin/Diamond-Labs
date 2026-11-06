import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { loginSchema } from "@my-app/shared";
import { Input } from "../ui/Input.jsx";
import { Button } from "../ui/Button.jsx";
import { useAuth } from "../../hooks/useAuth.js";
import { useToast } from "../ui/Toast.jsx";
import { MfaChallenge } from "./MfaChallenge.jsx";
import { ROUTES, roleHome, isPortalLogin } from "../../config/routes.js";
import { useAccountStore } from "../../stores/account.store.js";

export function LoginForm() {
  const { login } = useAuth();
  const { addToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [mfaState, setMfaState] = useState(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(loginSchema) });

  const onSubmit = async (data) => {
    try {
      const result = await login(data);
      if (result?.pendingApproval) {
        navigate(ROUTES.REGISTER_PENDING);
        return;
      }
      if (result?.mfaRequired) {
        setMfaState({ mfaToken: result.mfaToken });
        return;
      }
      // Role-aware post-login redirect. If RequireAuth bounced the user
      // here from a protected page, respect that origin; otherwise send
      // them to the home appropriate for their role.
      const from = location.state?.from?.pathname;
      // A practice login that is not a doctor needs its scope to know it belongs in the portal.
      const hasPractices = isPortalLogin(result?.user) ? (await useAccountStore.getState().fetchClientScope()).accounts.length > 0 : false;
      navigate(from || roleHome(result?.user, { hasPractices }), { replace: true });
    } catch (err) {
      addToast({
        message: err.response?.data?.error?.message || "Login failed",
        type: "error",
      });
    }
  };

  if (mfaState) {
    return <MfaChallenge mfaToken={mfaState.mfaToken} />;
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <Input
        label="Email"
        type="email"
        autoComplete="email"
        error={errors.email?.message}
        {...register("email")}
      />
      <Input
        label="Password"
        type="password"
        autoComplete="current-password"
        error={errors.password?.message}
        {...register("password")}
      />
      <Button type="submit" loading={isSubmitting} className="w-full">
        Sign in
      </Button>
    </form>
  );
}
