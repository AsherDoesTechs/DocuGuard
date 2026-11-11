// services/auditService.ts
import { api } from "@/services/api";

export type AuditAction = "UPLOAD" | "MODIFY" | "ACCESS" | "DELETE";

export async function recordAuditLog(
  documentId: string,
  action: AuditAction,
  details?: Record<string, any>,
) {
  try {
    const token = await api.getStoredToken();
    if (!token) return;

    await api.client.post(
      "/audit-logs",
      {
        document_id: documentId,
        action: action,
        details: details ? JSON.stringify(details) : null,
      },
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
  } catch (err) {
    console.warn("Failed to record audit log:", err);
  }
}
