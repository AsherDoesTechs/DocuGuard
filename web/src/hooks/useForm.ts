import { useState, useCallback } from "react";

interface UseFormOptions {
  initialValues: Record<string, any>;
  onSubmit: (values: Record<string, any>) => Promise<void> | void;
  validate?: (values: Record<string, any>) => Record<string, string>;
}

export const useForm = ({
  initialValues,
  onSubmit,
  validate,
}: UseFormOptions) => {
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const handleChange = useCallback(
    (
      e: React.ChangeEvent<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >,
    ) => {
      const { name, value, type } = e.target;
      const checked = (e.target as HTMLInputElement).checked;
      setValues((prev) => ({
        ...prev,
        [name]: type === "checkbox" ? checked : value,
      }));
    },
    [],
  );

  const handleBlur = useCallback(
    (
      e: React.FocusEvent<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >,
    ) => {
      const { name } = e.target;
      setTouched((prev) => ({
        ...prev,
        [name]: true,
      }));
    },
    [],
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      if (validate) {
        const newErrors = validate(values);
        setErrors(newErrors);
        if (Object.keys(newErrors).length > 0) return;
      }

      setIsSubmitting(true);
      try {
        await onSubmit(values);
      } catch (error) {
        console.error("Form submission error:", error);
      } finally {
        setIsSubmitting(false);
      }
    },
    [values, onSubmit, validate],
  );

  const resetForm = useCallback(() => {
    setValues(initialValues);
    setErrors({});
    setTouched({});
  }, [initialValues]);

  return {
    values,
    errors,
    touched,
    isSubmitting,
    handleChange,
    handleBlur,
    handleSubmit,
    resetForm,
    setValues,
    setErrors,
  };
};
