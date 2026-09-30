const categoryMapping: Record<string, string> = {
  passport: "identification",
  license: "identification",
  visa: "identification",
  insurance: "financial",
  certificate: "academic",
  medical: "medical",
  legal: "legal",
  other: "other",
  "government-id": "identification",
  financial: "financial",
  education: "academic",
  civil: "legal",
};

export const formatCategoryForBackend = (frontendCategory: string): string => {
  return categoryMapping[frontendCategory?.toLowerCase()] || "other";
};

export const reverseCategoryForFrontend = (backendCategory: string): string => {
  const reverseMapping: Record<string, string> = {
    identification: "passport",
    financial: "insurance",
    academic: "certificate",
    medical: "medical",
    legal: "legal",
    other: "other",
  };
  return reverseMapping[backendCategory?.toLowerCase()] || "other";
};
