import React from "react";
import { Input, Button } from "@/components/ui";
import { useForm } from "@/hooks";
import { isValidEmail, isValidPassword } from "@/utils";

interface RegisterFormProps {
  onSubmit: (data: any) => Promise<void>;
}

export const RegisterForm: React.FC<RegisterFormProps> = ({ onSubmit }) => {
  const validate = (values: any) => {
    const errors: Record<string, string> = {};
    if (!values.name) errors.name = "Name is required";
    if (!values.email) errors.email = "Email is required";
    else if (!isValidEmail(values.email)) errors.email = "Invalid email format";
    if (!values.password) errors.password = "Password is required";
    else if (!isValidPassword(values.password))
      errors.password = "Password must be at least 8 characters";
    if (!values.confirmPassword)
      errors.confirmPassword = "Please confirm your password";
    else if (values.password !== values.confirmPassword)
      errors.confirmPassword = "Passwords do not match";
    if (!values.agreeToTerms)
      errors.agreeToTerms = "You must agree to the terms";
    return errors;
  };

  const form = useForm({
    initialValues: {
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
      agreeToTerms: false,
    },
    onSubmit,
    validate,
  });

  return (
    <form onSubmit={form.handleSubmit} className="space-y-4">
      <Input
        label="Full Name"
        name="name"
        type="text"
        placeholder="John Doe"
        value={form.values.name}
        onChange={form.handleChange}
        onBlur={form.handleBlur}
        error={form.touched.name ? form.errors.name : undefined}
        required
      />

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
        helpText="At least 8 characters"
        required
      />

      <Input
        label="Confirm Password"
        name="confirmPassword"
        type="password"
        placeholder="••••••••"
        value={form.values.confirmPassword}
        onChange={form.handleChange}
        onBlur={form.handleBlur}
        error={
          form.touched.confirmPassword ? form.errors.confirmPassword : undefined
        }
        required
      />

      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          name="agreeToTerms"
          checked={form.values.agreeToTerms}
          onChange={form.handleChange}
          className="w-4 h-4 rounded border-gray-300 mt-1"
        />
        <span className="text-sm text-gray-600">
          I agree to the{" "}
          <a href="#" className="text-primary-600 hover:text-primary-700">
            Terms of Service
          </a>{" "}
          and{" "}
          <a href="#" className="text-primary-600 hover:text-primary-700">
            Privacy Policy
          </a>
        </span>
      </label>

      {form.errors.agreeToTerms && (
        <p className="text-sm text-red-600">⚠ {form.errors.agreeToTerms}</p>
      )}

      <Button type="submit" fullWidth loading={form.isSubmitting}>
        Create Account
      </Button>
    </form>
  );
};
