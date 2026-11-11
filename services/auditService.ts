// services/auditService.ts
import { api } from "@/services/api";

export type AuditAction = "UPLOAD" | "MODIFY" | "ACCESS" | "DELETE";

export async function recordAuditLog(
  documentId: string | number,
  action: AuditAction,
  details?: Record<string, any>,
) {
  try {
    await api.client.post("/audit-logs", {
      document_id: String(documentId),
      action,
      details: details ?? null,
    });
  } catch (err: any) {
    const status = err?.response?.status;
    const message = err?.response?.data?.error || err?.message || String(err);
    console.warn(
      `Failed to record audit log [${action} ${String(documentId)}]${status ? ` (${status})` : ""}:`,
      message,
    );
  }
}
