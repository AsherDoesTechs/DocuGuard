import React from "react";
import { Input, Button } from "@/components/ui";
import { useForm } from "@/hooks";
import { isValidEmail } from "@/utils";

interface LoginFormProps {
  onSubmit: (data: { email: string; password: string }) => Promise<void>;
}

export const LoginForm: React.FC<LoginFormProps> = ({ onSubmit }) => {
  // showPassword state could be used for a password visibility toggle button

  const validate = (values: any) => {
    const errors: Record<string, string> = {};
    if (!values.email) errors.email = "Email is required";
    else if (!isValidEmail(values.email)) errors.email = "Invalid email format";
    if (!values.password) errors.password = "Password is required";
    return errors;
  };

  const form = useForm({
    initialValues: { email: "demo@docuguard.com", password: "password123" },
    onSubmit: onSubmit as any,
    validate,
  });

  return (
    <form onSubmit={form.handleSubmit} className="space-y-4">
      <Input
        label="Email"
        name="email"
        type="email"
        placeholder="you@example.com"
        value={form.values.email}
        onChange={form.handleChange}
        onBlur={form.handleBlur}
        error={form.touched.email ? form.errors.email : undefined}
        required
      />

      <Input
        label="Password"
        name="password"
        type="password"
        placeholder="••••••••"
        value={form.values.password}
        onChange={form.handleChange}
        onBlur={form.handleBlur}
        error={form.touched.password ? form.errors.password : undefined}
        required
      />

      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={form.values.rememberMe || false}
            onChange={(e) =>
              form.setValues((prev) => ({
                ...prev,
                rememberMe: e.target.checked,
              }))
            }
            className="w-4 h-4 rounded border-gray-300"
          />
          <span className="text-sm text-gray-600">Remember me</span>
        </label>
        <a
          href="/forgot-password"
          className="text-sm text-primary-600 hover:text-primary-700"
        >
          Forgot password?
        </a>
      </div>

      <Button type="submit" fullWidth loading={form.isSubmitting}>
        Sign In
      </Button>
    </form>
  );
};
