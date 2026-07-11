import { useState, useEffect } from "react";

interface UseFormConfig<T> {
  initialValues: T;
  validate: (values: T) => Record<string, string>;
  onSubmit: (values: T) => Promise<void> | void;
}

export function useForm<T extends Record<string, any>>({
  initialValues,
  validate,
  onSubmit,
}: UseFormConfig<T>) {
  const [values, setValues] = useState<T>(initialValues);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Sync state if initialValues changes dynamically (e.g., __DEV__ configuration hydration)
  useEffect(() => {
    setValues(initialValues);
  }, [JSON.stringify(initialValues)]); // Safe deep compare to prevent loop resets

  const handleChange = (name: keyof T, value: any) => {
    const newValues = { ...values, [name]: value };
    setValues(newValues);

    // Live validation if it has been touched
    if (touched[name as string]) {
      const validationErrors = validate(newValues);
      setErrors(validationErrors);
    }
  };

  const handleBlur = (name: keyof T) => {
    setTouched({ ...touched, [name]: true });
    const validationErrors = validate(values);
    setErrors(validationErrors);
  };

  const handleSubmit = async () => {
    setTouched(
      Object.keys(values).reduce(
        (acc, key) => {
          acc[key] = true;
          return acc;
        },
        {} as Record<string, boolean>,
      ),
    );

    const validationErrors = validate(values);
    setErrors(validationErrors);

    if (Object.keys(validationErrors).length === 0) {
      setIsSubmitting(true);
      try {
        await onSubmit(values);
      } catch (error) {
        console.error("Form submit error:", error);
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  return {
    values,
    errors,
    touched,
    isSubmitting,
    handleChange: (name: keyof T) => (value: any) => handleChange(name, value),
    handleBlur: (name: keyof T) => () => handleBlur(name),
    handleSubmit,
  };
}
