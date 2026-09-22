const { z } = require("zod");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const emailSchema = z
  .string()
  .min(1, "Email is required")
  .email("Invalid email format");

const passwordSchema = z
  .string()
  .min(6, "Password must be at least 6 characters")
  .max(128, "Password is too long");

const nameSchema = z
  .string()
  .min(1, "Name is required")
  .max(100, "Name must be under 100 characters")
  .trim();

const loginSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  rememberMe: z.boolean().optional(),
});

const registerSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
});

const verifyEmailSchema = z.object({
  token: z.string().min(1, "Verification token is required"),
});

const resendVerificationSchema = z.object({
  email: emailSchema,
});

const forgotPasswordSchema = z.object({
  email: emailSchema,
});

const resetPasswordSchema = z.object({
  token: z.string().min(1, "Reset token is required"),
  newPassword: passwordSchema,
});

const checkEmailSchema = z.object({
  email: emailSchema,
});

const VALID_CATEGORIES = [
  "identification",
  "financial",
  "medical",
  "legal",
  "academic",
  "other",
];

const categorySchema = z
  .enum(VALID_CATEGORIES)
  .default("other");

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const dateStringSchema = z
  .string()
  .regex(DATE_REGEX, "Date must be in YYYY-MM-DD format")
  .refine((val) => {
    const [year, month, day] = val.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }, "Invalid date");

const documentShape = {
  title: z.string().min(1, "Document title is required").max(100, "Maximum 100 characters").trim(),
  category: categorySchema,
  issuer: z.string().min(1, "Issuer / organization is required").max(150, "Maximum 150 characters").trim(),
  documentNumber: z
    .string()
    .min(1, "Document number is required")
    .max(50, "Maximum 50 characters")
    .regex(/^[A-Z0-9\/-]+$/, "Use only letters, numbers, - or /")
    .transform((val) => val.toUpperCase()),
  issueDate: dateStringSchema,
  expiryDate: dateStringSchema,
  notes: z.string().max(1000, "Maximum 1000 characters").trim().optional(),
  enableAlerts: z.boolean().default(true),
  status: z.enum(["active", "verified", "expired"]).default("active"),
  processingStatus: z.enum(["pending", "uploading", "processing", "completed", "failed"]).default("completed"),
  riskScore: z.number().min(0).max(100).default(0),
  riskLevel: z.enum(["Low", "Medium", "High"]).default("Low"),
  fileUrl: z.string().url().optional().nullable(),
  fileType: z.string().optional().nullable(),
  s3Key: z.string().optional().nullable(),
};

const documentSchema = z
  .object(documentShape)
  .refine((data) => new Date(data.issueDate) <= new Date(data.expiryDate), {
    message: "Expiry date must be after issue date",
    path: ["expiryDate"],
  })
  .refine((data) => new Date(data.issueDate) <= new Date(), {
    message: "Issue date cannot be in the future",
    path: ["issueDate"],
  });

const documentUpdateSchema = z
  .object(documentShape)
  .partial()
  .extend({
    id: z.number().int().positive(),
  });

const documentSyncSchema = z.object({
  title: z.string().min(1).max(100).trim(),
  category: categorySchema,
  issuer: z.string().min(1).max(150).trim(),
  documentNumber: z.string().min(1).max(50).transform((val) => val.toUpperCase()),
  issueDate: dateStringSchema,
  expiryDate: dateStringSchema,
  notes: z.string().max(1000).trim().optional(),
  enableAlerts: z.boolean().default(true),
  status: z.enum(["active", "verified", "expired"]).default("active"),
  s3Key: z.string().optional().nullable(),
  fileUrl: z.string().url().optional().nullable(),
  fileType: z.string().optional().nullable(),
  processingStatus: z.enum(["pending", "uploading", "processing", "completed", "failed"]).default("completed"),
  riskScore: z.number().min(0).max(100).default(0),
  riskLevel: z.enum(["Low", "Medium", "High"]).default("Low"),
});

const uploadUrlSchema = z.object({
  fileName: z.string().min(1, "File name is required"),
  fileType: z.string().min(1, "File type is required"),
});

const processDocumentSchema = z.object({
  documentId: z.number().int().positive("Document ID is required"),
});

const verifyDocumentSchema = z.object({
  documentId: z.number().int().positive("Document ID is required"),
});

const updateFcmTokenSchema = z.object({
  fcmToken: z.string().min(1, "FCM token is required"),
});

const reminderSchema = z.object({
  title: z.string().min(1, "Title is required").max(200, "Maximum 200 characters").trim(),
  description: z.string().max(1000, "Maximum 1000 characters").trim().optional(),
  dueDate: dateStringSchema,
  severity: z.enum(["Valid", "Expiring Soon", "Expired"]).default("Valid"),
});

const profileSchema = z.object({
  name: nameSchema,
  email: emailSchema.optional(),
  notificationsEnabled: z.boolean().default(true),
  notifyEmail: z.boolean().default(true),
  notifyExpiry: z.boolean().default(true),
  twoFactor: z.boolean().default(false),
});

function validateSchema(schema, data) {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const errors = {};
  for (const issue of result.error.issues) {
    const path = issue.path.join(".");
    errors[path] = issue.message;
  }
  return { success: false, errors };
}

function validateSchemaOrThrow(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const errors = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Validation failed: ${errors}`);
  }
  return result.data;
}

module.exports = {
  // Constants
  EMAIL_REGEX,
  VALID_CATEGORIES,
  DATE_REGEX,
  // Schemas
  emailSchema,
  passwordSchema,
  nameSchema,
  loginSchema,
  registerSchema,
  verifyEmailSchema,
  resendVerificationSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  checkEmailSchema,
  categorySchema,
  dateStringSchema,
  documentSchema,
  documentUpdateSchema,
  documentSyncSchema,
  uploadUrlSchema,
  processDocumentSchema,
  verifyDocumentSchema,
  updateFcmTokenSchema,
  reminderSchema,
  profileSchema,
  // Helpers
  validateSchema,
  validateSchemaOrThrow,
};