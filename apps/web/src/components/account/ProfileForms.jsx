import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { changePasswordSchema } from "@my-app/shared";
import { Input } from "../ui/Input.jsx";
import { Button } from "../ui/Button.jsx";
import { Card } from "../ui/Card.jsx";
import { useToast } from "../ui/Toast.jsx";
import { useAuthStore } from "../../stores/auth.store.js";
import api from "../../config/api.js";

const errorMessage = (err, fallback) => err.response?.data?.error?.message || fallback;

const nameSchema = z.object({ name: z.string().trim().min(1, "Name is required").max(100) });

/** The signed-in user's own name. Shared by the staff Settings page and the doctor Account page. */
export function ProfileNameForm() {
  const user = useAuthStore((s) => s.user);
  const { addToast } = useToast();
  const { register, handleSubmit, formState: { errors, isSubmitting, isDirty }, reset } = useForm({
    resolver: zodResolver(nameSchema),
    defaultValues: { name: user?.name || "" },
  });

  const onSubmit = async ({ name }) => {
    try {
      await api.patch("/user/me", { name });
      useAuthStore.setState((s) => ({ user: s.user && { ...s.user, name } }));
      reset({ name });
      addToast({ message: "Name updated.", type: "success" });
    } catch (err) {
      addToast({ message: errorMessage(err, "Update failed."), type: "error" });
    }
  };

  return (
    <Card>
      <h3 className="mb-4 text-lg font-semibold">Profile</h3>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Input label="Email" value={user?.email || ""} disabled readOnly />
        <Input label="Name" autoComplete="name" error={errors.name?.message} {...register("name")} />
        <Button type="submit" loading={isSubmitting} disabled={!isDirty}>Save name</Button>
      </form>
    </Card>
  );
}

export const passwordSchema = changePasswordSchema
  .extend({ confirmPassword: z.string() })
  .refine((v) => v.newPassword === v.confirmPassword, { message: "Passwords don't match", path: ["confirmPassword"] });

/** Change the signed-in user's password (needs the current one). */
export function ChangePasswordForm() {
  const { addToast } = useToast();
  const { register, handleSubmit, formState: { errors, isSubmitting }, reset, setError } = useForm({
    resolver: zodResolver(passwordSchema),
  });

  const onSubmit = async ({ currentPassword, newPassword }) => {
    try {
      await api.patch("/user/me/password", { currentPassword, newPassword });
      reset({ currentPassword: "", newPassword: "", confirmPassword: "" });
      addToast({ message: "Password changed.", type: "success" });
    } catch (err) {
      const message = errorMessage(err, "Password change failed.");
      if (err.response?.status === 400 || err.response?.status === 401) setError("currentPassword", { message });
      else addToast({ message, type: "error" });
    }
  };

  return (
    <Card>
      <h3 className="mb-1 text-lg font-semibold">Password</h3>
      <p className="mb-4 text-sm text-gray-500">At least 12 characters, with an uppercase letter and a number.</p>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Input label="Current password" type="password" autoComplete="current-password" error={errors.currentPassword?.message} {...register("currentPassword")} />
        <Input label="New password" type="password" autoComplete="new-password" error={errors.newPassword?.message} {...register("newPassword")} />
        <Input label="Confirm new password" type="password" autoComplete="new-password" error={errors.confirmPassword?.message} {...register("confirmPassword")} />
        <Button type="submit" loading={isSubmitting}>Change password</Button>
      </form>
    </Card>
  );
}
