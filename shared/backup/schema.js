"use strict";

const { z } = require("zod");

const BACKUP_FORMAT = "docuguard.backup";
const BACKUP_VERSION = 1;

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));

    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }, "Invalid calendar date");

const nullableDateSchema = dateSchema.nullable();

const categorySchema = z.enum([
  "identification",
  "financial",
  "medical",
  "legal",
  "academic",
  "other",
]);

const documentSchema = z
  .object({
    title: z.string().min(1).max(100),
    category: categorySchema,
    issuer: z.string().max(150).nullable(),
    documentNumber: z.string().max(50).nullable(),
    issueDate: dateSchema.nullable(),
    expiryDate: nullableDateSchema.optional(),
    notes: z.string().max(5000).nullable().optional(),
    status: z.enum(["active", "verified", "expired"]),
    enableAlerts: z.boolean(),
    reminderIntervalDays: z
      .number()
      .int()
      .min(1)
      .max(365)
      .nullable()
      .optional(),
    reminderIntervals: z
      .array(z.number().int().min(1).max(365))
      .max(20)
      .optional(),
    fileType: z.string().max(50).nullable().optional(),
    processingStatus: z.enum([
      "pending",
      "uploading",
      "processing",
      "completed",
      "failed",
      "manual_review",
    ]),
    riskScore: z.number().min(0).max(100).nullable().optional(),
    riskLevel: z.enum(["Low", "Medium", "High"]).nullable().optional(),
    createdAt: z.string().nullable().optional(),
    updatedAt: z.string().nullable().optional(),
    tags: z.array(z.string().min(1).max(50)).max(50).optional(),
  })
  .strict();

const reminderSchema = z
  .object({
    title: z.string().min(1).max(150),
    description: z.string().max(1000).nullable(),
    dueDate: dateSchema.nullable(),
    severity: z.string().min(1).max(30),
    read: z.boolean(),
    createdAt: z.string().nullable(),
  })
  .strict();

const backupSchema = z
  .object({
    format: z.literal(BACKUP_FORMAT),
    version: z.literal(BACKUP_VERSION),
    exportedAt: z.string().datetime(),
    documents: z.array(documentSchema).max(10000),
    reminders: z.array(reminderSchema).max(10000),
  })
  .strict();

function validateBackup(input) {
  return backupSchema.safeParse(input);
}

module.exports = {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  documentSchema,
  reminderSchema,
  backupSchema,
  validateBackup,
};
