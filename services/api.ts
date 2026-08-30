// services/api.ts
import axios from "axios";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { router } from "expo-router";
import Constants from "expo-constants";

// Unified token key to match your app screens (AsyncStorage / SecureStore)
const TOKEN_KEY = "userToken";

// Safe SecureStore wrappers for Web / Expo Go compatibility
const safeGetItem = async (key: string) => {
  try {
    if (Platform.OS === "web") {
      return localStorage.getItem(key);
    }
    return await SecureStore.getItemAsync(key);
  } catch (e) {
    console.warn("SecureStore getItem error:", e);
    return null;
  }
};

const safeSetItem = async (key: string, value: string) => {
  try {
    if (Platform.OS === "web") {
      localStorage.setItem(key, value);
      return;
    }
    await SecureStore.setItemAsync(key, value);
  } catch (e) {
    console.warn("SecureStore setItem error:", e);
  }
};

const safeDeleteItem = async (key: string) => {
  try {
    if (Platform.OS === "web") {
      localStorage.removeItem(key);
      return;
    }
    await SecureStore.deleteItemAsync(key);
  } catch (e) {
    console.warn("SecureStore deleteItem error:", e);
  }
};

// Dynamic Base URL detection for physical devices, emulators, and production
const getBaseUrl = () => {
  const expoApiUrl = Constants?.expoConfig?.extra?.apiBaseUrl;
  if (expoApiUrl) {
    return expoApiUrl;
  }

  if (Platform.OS === "web") {
    return "http://localhost:3000";
  }

  // Default local development URL
  return "http://192.168.254.100:3000";
};

// Exported so components using raw fetch can import it safely
export const API_BASE_URL = getBaseUrl();

const client = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    "Content-Type": "application/json",
  },
});

// Request Interceptor
client.interceptors.request.use(
  async (config) => {
    const token = await safeGetItem(TOKEN_KEY);
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// Response Interceptor: Automatically catch 401 Unauthorized errors and force logout
client.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      // Clear the invalid/expired token securely
      await safeDeleteItem(TOKEN_KEY);

      // Redirect user back to login screen
      try {
        router.replace("/(auth)/login" as any);
      } catch (routerErr) {
        console.warn("Router redirection failed:", routerErr);
      }
    }

    return Promise.reject(error);
  },
);

// API Methods
export const auth = {
  login: async (credentials: {
    email: string;
    password: string;
    rememberMe?: boolean;
  }) => {
    const response = await client.post("/auth/login", credentials);
    if (response.data?.token) {
      await safeSetItem(TOKEN_KEY, response.data.token);
    }
    return response.data;
  },

  register: async (credentials: any) => {
    const response = await client.post("/auth/register", credentials);
    if (response.data?.token) {
      await safeSetItem(TOKEN_KEY, response.data.token);
    }
    return response.data;
  },

  verifyEmail: async (data: { token: string }) => {
    const response = await client.post("/auth/verify-email", data);
    if (response.data?.token) {
      await safeSetItem(TOKEN_KEY, response.data.token);
    }
    return response.data;
  },

  resendVerification: async (data: { email: string }) => {
    const response = await client.post("/auth/resend-verification", data);
    return response.data;
  },

  forgotPassword: async (credentials: { email: string }) => {
    const response = await client.post("/auth/forgot-password", credentials);
    return response.data;
  },
};

export const documents = {
  getUploadUrl: async (fileName: string, fileType: string) => {
    const response = await client.get(`/documents/upload-url`, {
      params: { fileName, fileType },
    });
    return response.data;
  },

  uploadToS3: async (signedUrl: string, fileUri: string, fileType: string) => {
    const response = await fetch(fileUri);
    const blob = await response.blob();

    await fetch(signedUrl, {
      method: "PUT",
      headers: { "Content-Type": fileType },
      body: blob,
    });
  },

  processDocument: async (s3Key: string) => {
    const response = await client.post("/documents/process", { s3Key });
    return response.data;
  },
};

export const cloud = {
  exportData: async () => {
    const response = await client.post("/api/export/export", {});
    return response.data;
  },
};

// Export combined `api` object so `api.client.get` or `api.auth.login` works directly
export const api = {
  client,
  auth,
  documents,
  cloud,
};
