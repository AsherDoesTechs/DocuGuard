import React, { useState } from "react";
import { Input, Button, Alert } from "@/components/ui";
import { useForm } from "@/hooks";
import { isValidEmail } from "@/utils";

interface ForgotPasswordFormProps {
  onSubmit: (data: { email: string }) => Promise<void>;
}

export const ForgotPasswordForm: React.FC<ForgotPasswordFormProps> = ({
  onSubmit,
}) => {
  const [submitted, setSubmitted] = useState(false);

  const validate = (values: any) => {
    const errors: Record<string, string> = {};
    if (!values.email) errors.email = "Email is required";
    else if (!isValidEmail(values.email)) errors.email = "Invalid email format";
    return errors;
  };

  const handleSubmit = async (values: any) => {
    await onSubmit(values);
    setSubmitted(true);
  };

  const form = useForm({
    initialValues: { email: "" },
    onSubmit: handleSubmit,
    validate,
  });

  if (submitted) {
    return (
      <div className="space-y-4">
        <Alert
          type="success"
          title="Check your email"
          message="We've sent password reset instructions to your email address."
        />
        <Button
          type="button"
          variant="secondary"
          fullWidth
          onClick={() => setSubmitted(false)}
        >
          Send Another Email
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={form.handleSubmit} className="space-y-4">
      <Input
        label="Email Address"
        name="email"
        type="email"
        placeholder="you@example.com"
        value={form.values.email}
        onChange={form.handleChange}
        onBlur={form.handleBlur}
        error={form.touched.email ? form.errors.email : undefined}
        helpText="Enter the email address associated with your account"
        required
      />

      <Button type="submit" fullWidth loading={form.isSubmitting}>
        Send Reset Link
      </Button>
    </form>
  );
};
