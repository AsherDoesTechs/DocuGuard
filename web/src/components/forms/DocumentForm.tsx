import React from "react";
import { Input, Button } from "@/components/ui";
import { useForm } from "@/hooks";
import { DOCUMENT_CATEGORIES } from "@/constants";
import type { Document } from "@/types";

interface DocumentFormProps {
  initialData?: Partial<Document>;
  onSubmit: (data: any) => Promise<void>;
  submitLabel?: string;
}

export const DocumentForm: React.FC<DocumentFormProps> = ({
  initialData = {},
  onSubmit,
  submitLabel = "Save Document",
}) => {
  const form = useForm({
    initialValues: {
      title: initialData.title || "",
      category: initialData.category || "other",
      issuer: initialData.issuer || "",
      documentNumber: initialData.documentNumber || "",
      issueDate: initialData.issueDate || "",
      expiryDate: initialData.expiryDate || "",
      notes: initialData.notes || "",
    },
    onSubmit,
  });

  return (
    <form onSubmit={form.handleSubmit} className="space-y-4">
      <Input
        label="Document Title"
        name="title"
        type="text"
        placeholder="e.g., US Passport"
        value={form.values.title}
        onChange={form.handleChange}
        onBlur={form.handleBlur}
        required
      />

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Category *
        </label>
        <select
          name="category"
          value={form.values.category}
          onChange={form.handleChange}
          className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-primary-600 focus:outline-none"
        >
          {Object.entries(DOCUMENT_CATEGORIES).map(([key, value]) => (
            <option key={key} value={key}>
              {value.label}
            </option>
          ))}
        </select>
      </div>

      <Input
        label="Issuer/Organization"
        name="issuer"
        type="text"
        placeholder="e.g., US State Department"
        value={form.values.issuer}
        onChange={form.handleChange}
        onBlur={form.handleBlur}
        required
      />

      <Input
        label="Document Number"
        name="documentNumber"
        type="text"
        placeholder="e.g., N12345678"
        value={form.values.documentNumber}
        onChange={form.handleChange}
        onBlur={form.handleBlur}
        required
      />

      <Input
        label="Issue Date"
        name="issueDate"
        type="date"
        value={form.values.issueDate}
        onChange={form.handleChange}
        onBlur={form.handleBlur}
        required
      />

      <Input
        label="Expiry Date"
        name="expiryDate"
        type="date"
        value={form.values.expiryDate}
        onChange={form.handleChange}
        onBlur={form.handleBlur}
        required
      />

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Notes
        </label>
        <textarea
          name="notes"
          value={form.values.notes}
          onChange={form.handleChange}
          placeholder="Add any additional notes..."
          rows={4}
          className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-primary-600 focus:outline-none resize-none"
        />
      </div>

      <Button type="submit" fullWidth loading={form.isSubmitting}>
        {submitLabel}
      </Button>
    </form>
  );
};
