import { forwardRef, useId } from "react";
import { clsx } from "clsx";

export const Input = forwardRef(function Input(
  { label, error, className, ...props },
  ref,
) {
  const autoId = useId();
  const id = props.id ?? autoId;
  return (
    <div className="space-y-1">
      {label && (
        <label htmlFor={id} className="block text-sm font-medium text-gray-700">{label}</label>
      )}
      <input
        ref={ref}
        id={id}
        className={clsx(
          "block w-full rounded-lg border px-3 py-2 text-sm shadow-sm transition-colors",
          "focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500",
          error ? "border-red-300" : "border-gray-300",
          className,
        )}
        {...props}
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
});
