import axios, { AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from "axios";
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

export async function setAuthToken(token: string | null) {
  authToken = token;
  if (token) {
    await SecureStore.setItemAsync("userToken", token);
  } else {
    await SecureStore.deleteItemAsync("userToken");
  }
}

export async function getStoredToken(): Promise<string | null> {
  if (authToken) return authToken;
  authToken = await SecureStore.getItemAsync("userToken");
  return authToken;
}

apiClient.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    const token = await getStoredToken();
    if (token) {
      config.headers = config.headers || {};
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

apiClient.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error) => {
    if (error.code === "ERR_NETWORK" || !error.response) {
      error.isOffline = true;
      error.message = "Network unavailable. Please check your connection.";
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
  token: string;
  user: { id: number; email: string; name: string };
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

  verifyEmail: async (data: { token: string }): Promise<{ message: string; token?: string }> => {
    const response = await apiClient.post("/auth/verify-email", { token: data.token });
    return response.data;
  },

  resendVerification: async (data: { email: string }): Promise<{ message: string }> => {
    const response = await apiClient.post("/auth/resend-verification", { email: data.email });
    return response.data;
  },

  forgotPassword: async (data: { email: string }): Promise<{ message: string }> => {
    const response = await apiClient.post("/auth/forgot-password", { email: data.email });
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

  logout: async (): Promise<void> => {
    await SecureStore.deleteItemAsync("userToken");
    authToken = null;
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

  uploadToS3: async (
    uploadUrl: string,
    imageUri: string,
    fileType: string,
  ): Promise<void> => {
    if (typeof fetch === "undefined") {
      throw new Error("Upload requires fetch, which is not available in this environment.");
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
      throw new Error(
        `Upload failed: ${uploadResponse.status} ${errorText}`,
      );
    }
  },

  create: async (payload: any): Promise<DocumentRecordResponse> => {
    const response = await apiClient.post("/documents", payload);
    return response.data;
  },

  processDocument: async (
    documentId: number,
  ): Promise<ProcessDocumentResponse> => {
    const response = await apiClient.post("/documents/process", { documentId });
    return response.data;
  },

  verifyDocument: async (documentId: number): Promise<{ message: string }> => {
    const response = await apiClient.post("/documents/verify", { documentId });
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
    const response = await apiClient.post("/api/notifications/push-token", data);
    return response.data;
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
};

export const api = {
  client: apiClient,
  auth,
  documents,
  cloud,
  notifications,
  dashboard,
  profile,
  setAuthToken,
  getStoredToken,
};

export default api;
