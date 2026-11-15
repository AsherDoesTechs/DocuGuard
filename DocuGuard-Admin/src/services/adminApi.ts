import { router } from "expo-router";
import { clearAdminToken } from "./adminSession";

const DEFAULT_API_BASE_URL = "https://docuguard-api-onoj.onrender.com";
const API_BASE_URL = (
  (typeof process !== "undefined" && process.env.EXPO_PUBLIC_API_BASE_URL) ||
  DEFAULT_API_BASE_URL
).replace(/\/+$/, "");

export function getAdminApiBaseUrl() {
  return API_BASE_URL;
}

export type AdminUser = {
  id: number | string;
  email: string;
  name?: string | null;
  role?: "admin" | "user" | "moderator" | string;
  status?: "active" | "suspended" | "pending" | string;
  createdAt?: string;
};

export type PendingAdminUser = {
  id: number | string;
  name?: string | null;
};

export type AdminMetrics = {
  totalUsers: number;
  totalDocuments: number;
};

export type AdminLoginResponse = {
  requiresTwoFactor?: boolean;
  requiresDeviceVerification?: boolean;
  pendingToken?: string;
  expiresIn?: number;
  user?: PendingAdminUser;
};

export type AdminChallengeResponse = {
  challengeId: string;
  challenge: string;
  expiresIn: number;
};

export type AdminDeviceEnrollmentResponse = {
  deviceId: string;
  keyAlgorithm: "ECDSA_P256_SHA256";
  enrolled: true;
};

export type AdminVerifiedSessionResponse = {
  token: string;
  expiresIn: number;
  user: AdminUser;
};

type OverviewResponse = {
  status: "ok";
  metrics: AdminMetrics;
};

export type VaultDocument = {
  id: string | number;
  title: string;
  fileName: string;
  fileSize: number;
  ownerEmail: string;
  ocrStatus: "completed" | "pending" | "failed" | string;
  createdAt: string;
};

export type AuditLogEntry = {
  id: string | number;
  action: string;
  actor: string;
  severity: "info" | "warning" | "critical" | string;
  ipAddress?: string;
  timestamp: string;
  details?: string;
};

export type SystemHealthData = {
  status: "healthy" | "degraded" | "critical" | string;
  uptime: string;
  database: {
    status: "connected" | "disconnected" | string;
    latencyMs: number;
  };
  supabaseStorage: {
    status: "operational" | "degraded" | "down" | string;
    bucketUsageBytes: number;
    totalFiles: number;
  };
  azureOcr: {
    status: "operational" | "degraded" | "down" | string;
    pendingQueueCount: number;
    successRate24h: number;
  };
  lastChecked: string;
};

type ApiErrorBody = {
  error?: string;
  code?: string;
  [key: string]: any;
};

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  const method = options.method || "GET";

  console.log(`[AdminApi Request] ${method} ${path}`);

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
    console.log(
      `[AdminApi Response] ${method} ${path} -> Status: ${response.status}`,
    );
  } catch (netError) {
    console.error(`[AdminApi Network Error] ${method} ${path}:`, netError);
    const originHint =
      typeof window !== "undefined" && window.location?.origin
        ? ` from ${window.location.origin}`
        : "";
    throw new Error(
      `Unable to connect to DocuGuard API (${API_BASE_URL}${path})${originHint}. Check internet, server status, EXPO_PUBLIC_API_BASE_URL, and server CORS_ALLOWED_ORIGINS for this origin.`,
    );
  }

  let data: unknown;
  try {
    const responseText = await response.text();
    data = responseText ? JSON.parse(responseText) : {};
  } catch (parseError) {
    console.error(
      `[AdminApi Parse Error] Failed to parse JSON for ${path}:`,
      parseError,
    );
    throw new Error("The server returned an invalid response.");
  }

  // Exempt authentication, login, challenge, and enrollment paths from global session wipe
  const isAuthOrEnrollmentPath = path.startsWith("/admin-auth/");

  if (response.status === 401 && !isAuthOrEnrollmentPath) {
    console.warn(
      `[AdminApi Session Expired] 401 Unauthorized caught on protected path: ${path}`,
      data,
    );
    await clearAdminToken();
    router.replace("/");
    throw new Error(
      `Your session has expired or been revoked. [Triggered by: ${path}] Please sign in again.`,
    );
  }

  if (!response.ok) {
    const body = (data || {}) as ApiErrorBody;
    console.warn(
      `[AdminApi Error Body] ${method} ${path} (${response.status}):`,
      body,
    );

    const errorMessage = body.error || `Request failed (${response.status}).`;
    const error: any = new Error(errorMessage);

    // Attach response context so screens can read error.response.data
    error.status = response.status;
    error.code = body.code;
    error.response = {
      status: response.status,
      data: body,
    };
    error.data = body;

    throw error;
  }

  return data as T;
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/**
 * Stage 1: verify Admin ID and password, and TOTP if enabled.
 */
export async function adminLogin(
  adminId: string,
  password: string,
  totpCode?: string,
): Promise<AdminLoginResponse> {
  return request<AdminLoginResponse>("/admin-auth/login", {
    method: "POST",
    body: JSON.stringify({
      adminId: adminId.trim(),
      password,
      ...(totpCode ? { totpCode: totpCode.trim() } : {}),
    }),
  });
}

/**
 * Stage 2: request a short-lived challenge for an enrolled device.
 */
export async function createAdminChallenge(
  pendingToken: string,
  deviceId: string,
): Promise<AdminChallengeResponse> {
  return request<AdminChallengeResponse>("/admin-auth/challenge", {
    method: "POST",
    body: JSON.stringify({
      pendingToken,
      deviceId,
    }),
  });
}

/**
 * Stage 3: submit the device signature.
 */
export async function verifyAdminDevice(
  pendingToken: string,
  challengeId: string,
  deviceId: string,
  signature: string,
): Promise<AdminVerifiedSessionResponse> {
  return request<AdminVerifiedSessionResponse>("/admin-auth/verify-device", {
    method: "POST",
    body: JSON.stringify({
      pendingToken,
      challengeId,
      deviceId,
      signature,
    }),
  });
}

/**
 * Enroll a device using a one-time enrollment token.
 */
export async function enrollAdminDevice(
  enrollmentToken: string,
  publicKeyPem: string,
  deviceLabel?: string,
): Promise<AdminDeviceEnrollmentResponse> {
  return request<AdminDeviceEnrollmentResponse>("/admin-auth/enroll-device", {
    method: "POST",
    body: JSON.stringify({
      enrollmentToken,
      publicKeyPem,
      ...(deviceLabel ? { deviceLabel: deviceLabel.trim() } : {}),
    }),
  });
}

export async function getAdminOverview(
  token: string,
): Promise<OverviewResponse> {
  return request<OverviewResponse>("/admin/overview", {
    method: "GET",
    headers: authHeaders(token),
  });
}

export async function getAdminUsers(token: string): Promise<{ status?: string; users: AdminUser[] } | AdminUser[]> {
  return request<{ status?: string; users: AdminUser[] } | AdminUser[]>("/admin/users", {
    method: "GET",
    headers: authHeaders(token),
  });
}

export async function updateAdminUserStatus(
  token: string,
  userId: string | number,
  status: "active" | "suspended",
): Promise<any> {
  return request(`/admin/users/${encodeURIComponent(String(userId))}/status`, {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify({ status }),
  });
}

export async function getAdminDocuments(token: string): Promise<{ status?: string; documents: VaultDocument[] } | VaultDocument[]> {
  return request<{ status?: string; documents: VaultDocument[] } | VaultDocument[]>("/admin/documents", {
    method: "GET",
    headers: authHeaders(token),
  });
}

export async function getAdminLogs(token: string): Promise<{ status?: string; logs: AuditLogEntry[] } | AuditLogEntry[]> {
  return request<{ status?: string; logs: AuditLogEntry[] } | AuditLogEntry[]>("/admin/logs", {
    method: "GET",
    headers: authHeaders(token),
  });
}

export async function getAdminSystemHealth(token: string): Promise<{ status?: string; health: SystemHealthData } | SystemHealthData> {
  return request<{ status?: string; health: SystemHealthData } | SystemHealthData>("/admin/health", {
    method: "GET",
    headers: authHeaders(token),
  });
}

/**
 * Terminate current admin session (server-side & local cleanup)
 */
export async function logoutAdmin(token: string): Promise<void> {
  try {
    await request("/admin-auth/logout", {
      method: "POST",
      headers: authHeaders(token),
    });
  } catch (error) {
    console.warn(
      "Server logout request failed, proceeding with local token wipe:",
      error,
    );
  } finally {
    await clearAdminToken();
  }
}
