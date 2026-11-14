import { router } from "expo-router";
import axios, {
  AxiosInstance,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from "axios";
import * as SecureStore from "expo-secure-store";

const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL || "https://docuguard-api-onoj.onrender.com";

const apiClient: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    "Content-Type": "application/json",
  },
});

let authToken: string | null = null;
let authTokenLoaded = false;

let authTokenQueue: Promise<void> = Promise.resolve();

async function runAuthTokenOperation<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const previousOperation = authTokenQueue;
  let releaseOperation!: () => void;

  authTokenQueue = new Promise<void>((resolve) => {
    releaseOperation = resolve;
  });

  await previousOperation;

  try {
    return await operation();
  } finally {
    releaseOperation();
  }
}

export async function setAuthToken(token: string | null): Promise<void> {
  return runAuthTokenOperation(async () => {
    if (token) {
      // Persist first so failed storage cannot create a false in-memory session.
      await SecureStore.setItemAsync("userToken", token);
      authToken = token;
      authTokenLoaded = true;
      return;
    }

    // Invalidate memory immediately, even if storage deletion fails.
    authToken = null;
    authTokenLoaded = true;
    await SecureStore.deleteItemAsync("userToken");
  });
}

/**
 * Establishes the token and local account ownership as one serialized
 * authentication operation. Keep the token queue held until the local
 * ownership transition has completed.
 */
async function setAuthTokenAndSwitchLocalUser(
  token: string,
  userId: number,
): Promise<void> {
  if (typeof token !== "string" || token.trim().length === 0) {
    throw new Error("The server did not return a valid session token.");
  }

  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new Error("The server did not return a valid account identity.");
  }

  return runAuthTokenOperation(async () => {
    // 1. Switch local database user scope FIRST so stale tables are wiped/partitioned
    // before the token ever unlocks network calls.
    const { switchLocalUser } = await import("./localDatabase");
    await switchLocalUser(userId);

    // 2. Commit token globally only after SQLite user-scoping is safely finished.
    await SecureStore.setItemAsync("userToken", token);
    authToken = token;
    authTokenLoaded = true;
  });
}
export async function replaceAuthTokenIfCurrent(
  expectedToken: string,
  newToken: string,
): Promise<boolean> {
  if (!expectedToken || !newToken) return false;

  return runAuthTokenOperation(async () => {
    const storedToken = await SecureStore.getItemAsync("userToken");

    if (storedToken !== expectedToken) return false;
    if (authTokenLoaded && authToken !== expectedToken) return false;

    await SecureStore.setItemAsync("userToken", newToken);
    authToken = newToken;
    authTokenLoaded = true;
    return true;
  });
}
export async function getStoredToken(): Promise<string | null> {
  return runAuthTokenOperation(async () => {
    if (authTokenLoaded) return authToken;

    const storedToken = await SecureStore.getItemAsync("userToken");
    authToken = storedToken;
    authTokenLoaded = true;
    return storedToken;
  });
}

async function clearAuthTokenIfMatches(
  expectedToken: string | null,
): Promise<boolean> {
  return runAuthTokenOperation(async () => {
    const storedToken = await SecureStore.getItemAsync("userToken");

    if (storedToken !== expectedToken) return false;
    if (authTokenLoaded && authToken !== expectedToken) return false;

    authToken = null;
    authTokenLoaded = true;

    if (storedToken !== null) {
      await SecureStore.deleteItemAsync("userToken");
    }

    return true;
  });
}

const PUBLIC_AUTH_PATHS = [
  "/auth/login",
  "/auth/admin-login",
  "/auth/register",
  "/auth/verify-email",
  "/auth/resend-verification",
  "/auth/forgot-password",
  "/auth/reset-password",
  "/auth/check-email",
];

apiClient.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    const requestPath = (config.url || "").split("?")[0].replace(/\/+$/, "");

    const isPublicAuthRequest = PUBLIC_AUTH_PATHS.some(
      (path) => requestPath === path || requestPath.endsWith(path),
    );

    if (isPublicAuthRequest) {
      config.headers.delete("Authorization");
      return config;
    }

    if (!config.headers.Authorization) {
      const token = await getStoredToken();

      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }

    return config;
  },
  (error) => Promise.reject(error),
);

apiClient.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error) => {
    // 1. Handle Network / Offline Errors
    if (error.code === "ERR_NETWORK" || !error.response) {
      error.isOffline = true;
      error.message = "Network unavailable. Please check your connection.";
      return Promise.reject(error);
    }

    const status = error.response?.status;
    const requestPath = (error.config?.url || "")
      .split("?")[0]
      .replace(/\/+$/, "");

    const isAuthEndpoint = PUBLIC_AUTH_PATHS.some(
      (path) => requestPath === path || requestPath.endsWith(path),
    );

    // Allow certain background/admin routes to fail gracefully without wiping the session
    const skipGlobalLogoutPaths = ["/auth/logout", "/health", "/sync"];
    const shouldSkipLogout =
      skipGlobalLogoutPaths.some((path) => requestPath.includes(path)) ||
      error.config?.skipGlobalLogout === true;

    // 2. Handle Global 401 Unauthorized (Expired or Revoked Sessions)
    if (status === 401 && !isAuthEndpoint && !shouldSkipLogout) {
      try {
        const token = await getStoredToken();
        const { getLocalDataOwnerIdForSessionExpiration } =
          await import("./localDatabase");
        const ownerId = await getLocalDataOwnerIdForSessionExpiration();

        // Securely clean up local session, push tokens, and SQLite data ownership
        await auth.logout(token, ownerId);

        // Force redirect to login screen
        router.replace("/(auth)/login");
      } catch (logoutError) {
        console.error(
          "[ApiClient] Failed to handle 401 session expiration:",
          logoutError,
        );
      }
    }

    return Promise.reject(error);
  },
);

export { apiClient, API_BASE_URL };

export interface UploadUrlResponse {
  uploadUrl: string;
  storagePath?: string;
  s3Key?: string;
  fileUrl: string;
}

export interface DocumentRecordResponse {
  message?: string;
  document?: any;
  id?: number;
}

export interface ProcessDocumentResponse {
  status?: string;
  message?: string;
  document?: any;
  extractedData?: {
    title?: string;
    issuer?: string;
    documentNumber?: string;
    issueDate?: string;
    expiryDate?: string;
    category?: string;
    confidence?: number;
    riskScore?: number;
    riskLevel?: string;
    notes?: string;
  };
}

export interface LoginResponse {
  /** Absent when the account requires a second factor. */
  token?: string;
  user: { id: number; email: string; name: string };
  /** Set when the password was accepted but a TOTP code is still required. */
  requiresTwoFactor?: boolean;
}

export interface RegisterResponse {
  message: string;
  user: { id: number; email: string; name: string };
  emailSent?: boolean;
}

export interface SyncDocumentResponse {
  message?: string;
  document?: any;
  conflict?: boolean;
  error?: string;
}

export const auth = {
  login: async (data: {
    email: string;
    password: string;
    rememberMe?: boolean;
    /** Second factor, required only when the account has TOTP enrolled. */
    totpCode?: string;
    recoveryCode?: string;
  }): Promise<LoginResponse> => {
    const response = await apiClient.post("/auth/login", data);
    return response.data;
  },

  register: async (data: {
    name: string;
    email: string;
    password: string;
    confirmPassword?: string;
  }): Promise<RegisterResponse> => {
    const response = await apiClient.post("/auth/register", data);
    return response.data;
  },

  verifyEmail: async (data: {
    token: string;
  }): Promise<{
    message: string;
    token?: string;
    user?: { id: number; email: string; role?: string };
  }> => {
    const response = await apiClient.post("/auth/verify-email", {
      token: data.token,
    });
    return response.data;
  },

  resendVerification: async (data: {
    email: string;
  }): Promise<{ message: string }> => {
    const response = await apiClient.post("/auth/resend-verification", {
      email: data.email,
    });
    return response.data;
  },

  forgotPassword: async (data: {
    email: string;
  }): Promise<{ message: string }> => {
    const response = await apiClient.post("/auth/forgot-password", {
      email: data.email,
    });
    return response.data;
  },

  resetPassword: async (data: {
    token: string;
    newPassword: string;
  }): Promise<{ message: string }> => {
    const response = await apiClient.post("/auth/reset-password", {
      token: data.token,
      newPassword: data.newPassword,
    });
    return response.data;
  },

  checkEmail: async (email: string): Promise<{ exists: boolean }> => {
    const response = await apiClient.get("/auth/check-email", {
      params: { email },
    });
    return response.data;
  },

  syncFcmToken: async (fcmToken: string): Promise<{ message: string }> => {
    const response = await apiClient.put("/auth/fcm-token", { fcmToken });
    return response.data;
  },

  logout: async (
    tokenOverride?: string | null,
    expectedOwnerId?: number | null,
  ): Promise<boolean> => {
    // An explicit null means no token; only undefined requests a lookup.
    const token =
      tokenOverride === undefined ? await getStoredToken() : tokenOverride;

    const {
      clearLocalSessionIfOwner,
      getLocalDataOwnerIdForSessionExpiration,
    } = await import("./localDatabase");

    // Capture ownership before local cleanup.
    const ownerId =
      expectedOwnerId === undefined
        ? await getLocalDataOwnerIdForSessionExpiration()
        : expectedOwnerId;

    // Serialize token verification, owner cleanup, and token deletion.
    const localLogoutSucceeded = await runAuthTokenOperation(async () => {
      const storedToken = await SecureStore.getItemAsync("userToken");

      if (storedToken !== token) return false;
      if (authTokenLoaded && authToken !== token) return false;

      const ownershipCleared = await clearLocalSessionIfOwner(ownerId);

      if (!ownershipCleared) return false;

      // Recheck before deletion so an unexpected token write is not erased.
      const latestStoredToken = await SecureStore.getItemAsync("userToken");

      if (latestStoredToken !== token) return false;
      if (authTokenLoaded && authToken !== token) return false;

      authToken = null;
      authTokenLoaded = true;

      if (latestStoredToken !== null) {
        await SecureStore.deleteItemAsync("userToken");
      }

      return true;
    });

    if (!localLogoutSucceeded) return false;

    // Best-effort remote revocation; never delay local logout/navigation.
    if (token) {
      void apiClient
        .post(
          "/auth/logout",
          {},
          { headers: { Authorization: `Bearer ${token}` } },
        )
        .catch((error) => {
          console.warn(
            "Server-side session revocation could not be confirmed:",
            error,
          );
        });
    }

    return true;
  },
};

export const documents = {
  getUploadUrl: async (
    fileName: string,
    fileType: string,
  ): Promise<UploadUrlResponse> => {
    const response = await apiClient.get("/documents/upload-url", {
      params: { fileName, fileType },
    });
    return response.data;
  },

  /**
   * Removes an uploaded object that never became a document.
   *
   * The upload of a picked file happens before the document is written to the
   * database. When that write then fails, the object is left in the bucket
   * with nothing pointing at it, so the client asks the server to remove it.
   */
  deleteUploadedObject: async (s3Key: string): Promise<void> => {
    await apiClient.delete("/documents/storage", { data: { s3Key } });
  },

  uploadToS3: async (
    uploadUrl: string,
    imageUri: string,
    fileType: string,
  ): Promise<void> => {
    if (typeof fetch === "undefined") {
      throw new Error(
        "Upload requires fetch, which is not available in this environment.",
      );
    }

    const response = await fetch(imageUri);
    if (!response.ok) {
      throw new Error(`Could not read local file (${response.status})`);
    }

    const blob = await response.blob();

    const uploadResponse = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": fileType,
      },
      body: blob,
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      throw new Error(`Upload failed: ${uploadResponse.status} ${errorText}`);
    }
  },

  create: async (
    payload: any,
    headers?: any,
  ): Promise<DocumentRecordResponse> => {
    const response = await apiClient.post(
      "/documents",
      payload,
      headers ? { headers } : undefined,
    );
    return response.data;
  },

  processDocument: async (
    documentId: number,
  ): Promise<ProcessDocumentResponse> => {
    const response = await apiClient.post("/documents/process", {
      documentId,
    });
    return response.data;
  },

  createOcrDraft: async (payload: {
    s3Key: string;
    storagePath?: string;
    fileType: string;
  }): Promise<DocumentRecordResponse> => {
    const response = await apiClient.post("/documents/ocr-draft", payload);

    return response.data;
  },

  verifyDocument: async (documentId: number): Promise<{ message: string }> => {
    const response = await apiClient.post("/documents/verify", {
      documentId,
    });
    return response.data;
  },

  syncDocument: async (payload: any): Promise<SyncDocumentResponse> => {
    const response = await apiClient.post("/documents/sync", payload);
    return response.data;
  },

  getAll: async (): Promise<any[]> => {
    const response = await apiClient.get("/documents");
    return response.data;
  },

  getById: async (id: number): Promise<any> => {
    const response = await apiClient.get(`/documents/${id}`);
    return response.data;
  },

  update: async (id: number, payload: any): Promise<DocumentRecordResponse> => {
    const response = await apiClient.put(`/documents/${id}`, payload);
    return response.data;
  },

  delete: async (id: number): Promise<{ message: string }> => {
    const response = await apiClient.delete(`/documents/${id}`);
    return response.data;
  },

  searchDocuments: async (query: string): Promise<{ query: string; results: any[]; count: number }> => {
    const response = await apiClient.get("/api/search", { params: { q: query } });
    return response.data;
  },
};

export const cloud = {
  exportData: async (): Promise<any> => {
    const response = await apiClient.post("/api/export/export");
    return response.data;
  },
};

export const notifications = {
  registerPushToken: async (data: {
    expoPushToken?: string;
    devicePushToken?: string;
  }): Promise<{ message: string }> => {
    const response = await apiClient.post(
      "/api/notifications/push-token",
      data,
    );
    return response.data;
  },

  /**
   * Removes the push token of the signed-in account.
   *
   * The token is stored on the account. Without this call it stayed there
   * after a sign-out, and the server kept pushing that account's document
   * titles to the device - which, after another account signed in, belonged
   * to somebody else.
   */
  removePushToken: async (): Promise<void> => {
    await apiClient.delete("/api/notifications/push-token");
  },
};

export const dashboard = {
  getDashboardData: async (): Promise<any> => {
    const response = await apiClient.get("/dashboard");
    return response.data;
  },
};

export const profile = {
  getProfile: async (): Promise<any> => {
    const response = await apiClient.get("/profile");
    return response.data;
  },

  updateProfile: async (data: any): Promise<any> => {
    const response = await apiClient.patch("/profile", data);
    return response.data;
  },

  updateSecurity: async (data: any): Promise<any> => {
    const response = await apiClient.patch("/profile/security", data);
    return response.data;
  },

  updatePreferences: async (data: any): Promise<any> => {
    const response = await apiClient.patch("/profile/preferences", data);
    return response.data;
  },

  getSessions: async (): Promise<any[]> => {
    const response = await apiClient.get("/profile/sessions");
    return response.data;
  },

  terminateSession: async (sessionId: string): Promise<{ message: string }> => {
    const response = await apiClient.delete(`/profile/sessions/${sessionId}`);
    return response.data;
  },

  getSettings: async (): Promise<any> => {
    const response = await apiClient.get("/profile/settings");
    return response.data;
  },

  updateSettings: async (data: any): Promise<any> => {
    const response = await apiClient.patch("/profile/settings", data);
    return response.data;
  },

  exportUserData: async (): Promise<any> => {
    const response = await apiClient.get("/profile/export");
    return response.data;
  },

  submitSupportTicket: async (data: {
    subject?: string;
    message: string;
  }): Promise<{ message: string }> => {
    const response = await apiClient.post("/profile/support", data);
    return response.data;
  },
};

export async function validateStoredSession(token: string): Promise<boolean> {
  if (!token) return false;

  try {
    await apiClient.get("/profile", {
      headers: { Authorization: `Bearer ${token}` },
    });

    return true;
  } catch (error: any) {
    const status = error?.response?.status;

    if (status === 401) {
      const { getLocalDataOwnerIdForSessionExpiration } =
        await import("./localDatabase");

      const ownerId = await getLocalDataOwnerIdForSessionExpiration();
      await auth.logout(token, ownerId);
      return false;
    }

    throw error;
  }
}

export async function runWithValidatedStoredSession<T>(
  token: string,
  operation: () => Promise<T>,
): Promise<T> {
  if (!token) {
    throw new Error("An active authenticated session is required.");
  }

  const isValid = await validateStoredSession(token);

  if (!isValid) {
    throw new Error("Your session is no longer valid. Please sign in again.");
  }

  return runAuthTokenOperation(async () => {
    const storedToken = await SecureStore.getItemAsync("userToken");

    if (storedToken !== token || (authTokenLoaded && authToken !== token)) {
      throw new Error("Your account session changed. Please try again.");
    }

    return operation();
  });
}

export const api = {
  client: apiClient,
  auth,
  documents,
  cloud,
  notifications,
  dashboard,
  profile,
  validateStoredSession,
  setAuthToken,
  setAuthTokenAndSwitchLocalUser,
  replaceAuthTokenIfCurrent,
  clearAuthTokenIfMatches,
  getStoredToken,
};

export default api;
