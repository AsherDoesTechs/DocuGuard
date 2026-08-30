// utils/categories.ts
const categoryMapping: Record<string, string> = {
  passport: "identification",
  license: "identification",
  visa: "identification",
  insurance: "financial",
  certificate: "academic",
  medical: "medical",
  legal: "legal",
  other: "other",
};

export const formatCategoryForBackend = (frontendCategory: string): string => {
  return categoryMapping[frontendCategory?.toLowerCase()] || "other";
};
