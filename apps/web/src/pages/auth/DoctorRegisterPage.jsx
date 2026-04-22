import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { doctorRegisterSchema } from "@my-app/shared";
import { AuthLayout } from "../../components/layout/AuthLayout.jsx";
import { Card } from "../../components/ui/Card.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { useToast } from "../../components/ui/Toast.jsx";
import { useAuthStore } from "../../stores/auth.store.js";
import { ROUTES } from "../../config/routes.js";

export function DoctorRegisterPage() {
  const registerDoctor = useAuthStore((s) => s.registerDoctor);
  const navigate = useNavigate();
  const { addToast } = useToast();
  const [serverError, setServerError] = useState(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(doctorRegisterSchema) });

  const onSubmit = async (data) => {
    setServerError(null);
    try {
      await registerDoctor(data);
      navigate(ROUTES.REGISTER_PENDING);
    } catch (err) {
      const msg = err.response?.data?.error?.message || "Registration failed";
      setServerError(msg);
      addToast({ message: msg, type: "error" });
    }
  };

  return (
    <AuthLayout>
      <Card className="max-w-lg">
        <h2 className="mb-2 text-center text-xl font-semibold">Doctor Registration</h2>
        <p className="mb-6 text-center text-sm text-gray-500">
          Create your doctor account. Your registration will be reviewed by an admin.
        </p>

        {serverError && (
          <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">{serverError}</div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Personal */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Full Name" autoComplete="name" error={errors.name?.message} {...register("name")} />
            <Input label="Email" type="email" autoComplete="email" error={errors.email?.message} {...register("email")} />
          </div>

          <Input label="Password" type="password" autoComplete="new-password" error={errors.password?.message} {...register("password")} />

          {/* Practice */}
          <hr className="border-gray-200" />
          <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Practice Information</p>

          <Input label="Company / Practice Name" error={errors.companyName?.message} {...register("companyName")} />

          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="NPI Number" error={errors.npiNumber?.message} {...register("npiNumber")} />
            <Input label="License Number (optional)" error={errors.licenseNumber?.message} {...register("licenseNumber")} />
          </div>

          {/* Address */}
          <hr className="border-gray-200" />
          <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Address</p>

          <Input label="Address Line 1" autoComplete="address-line1" error={errors.address1?.message} {...register("address1")} />
          <Input label="Address Line 2 (optional)" autoComplete="address-line2" error={errors.address2?.message} {...register("address2")} />

          <div className="grid gap-4 sm:grid-cols-3">
            <Input label="City" autoComplete="address-level2" error={errors.city?.message} {...register("city")} />
            <Input label="State" autoComplete="address-level1" error={errors.state?.message} {...register("state")} />
            <Input label="ZIP" autoComplete="postal-code" error={errors.zip?.message} {...register("zip")} />
          </div>

          {/* Contact */}
          <hr className="border-gray-200" />
          <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Contact & Delivery</p>

          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Phone (optional)" type="tel" autoComplete="tel" error={errors.phone?.message} {...register("phone")} />
            <Input label="Phone 2 (optional)" type="tel" error={errors.phone2?.message} {...register("phone2")} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Delivery Method (optional)" error={errors.deliveryMethod?.message} {...register("deliveryMethod")} />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Delivery Notes (optional)</label>
            <textarea
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              rows={3}
              {...register("deliveryNotes")}
            />
            {errors.deliveryNotes && <p className="mt-1 text-xs text-red-500">{errors.deliveryNotes.message}</p>}
          </div>

          <Button type="submit" loading={isSubmitting} className="w-full">
            Submit Registration
          </Button>
        </form>

        <p className="mt-4 text-center text-sm text-gray-500">
          Already have an account?{" "}
          <Link to={ROUTES.LOGIN} className="text-brand-600 hover:underline">
            Sign in
          </Link>
        </p>
      </Card>
    </AuthLayout>
  );
}
