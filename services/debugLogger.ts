import * as SecureStore from "expo-secure-store";
import * as FileSystem from "expo-file-system";
import * as FileSystemLegacy from "expo-file-system/legacy";
import { Platform } from "react-native";
import Constants from "expo-constants";

interface LogEntry {
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  category: string;
  code?: number;
  message: string;
  details?: any;
  sessionId: string;
}

let sessionId: string | null = null;
let logBuffer: LogEntry[] = [];
let isEnabled = true;

const MAX_LOG_ENTRIES = 100;
const LOG_FILE = "docuguard_debug.log";

function getLogDir(): string {
  if (Platform.OS === "web") return "web";
  try {
    return FileSystem.Paths.document.uri;
  } catch {
    return FileSystemLegacy.documentDirectory || "";
  }
}

function getLogPath(): string | null {
  const dir = getLogDir();
  if (!dir || dir === "web") return null;
  return `${dir}${LOG_FILE}`;
}

function getSessionId(): string {
  if (!sessionId) {
    sessionId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
  return sessionId;
}

function flushBuffer() {
  if (logBuffer.length === 0) return;

  if (Platform.OS === "web") {
    try {
      const existing = localStorage.getItem(LOG_FILE);
      const allLogs = existing ? JSON.parse(existing) : [];
      const combined = [...allLogs, ...logBuffer].slice(-MAX_LOG_ENTRIES * 2);
      localStorage.setItem(LOG_FILE, JSON.stringify(combined, null, 2));
    } catch (e) {
      console.warn("Failed to persist logs to localStorage:", e);
    }
  } else {
    const filepath = getLogPath();
    if (!filepath) {
      console.warn("Could not resolve log file path");
    } else {
      const file = new FileSystem.File(filepath);
      try {
        const existing = file.exists ? file.textSync() : "";
        const allLogs = existing ? JSON.parse(existing) : [];
        const combined = [...allLogs, ...logBuffer].slice(-MAX_LOG_ENTRIES * 2);
        file.write(JSON.stringify(combined, null, 2));
      } catch (e) {
        try {
          file.write(JSON.stringify(logBuffer, null, 2));
        } catch (writeErr) {
          console.warn("Failed to persist logs:", writeErr);
        }
      }
    }
  }

  logBuffer = [];
}

export function debugLog(
  level: "debug" | "info" | "warn" | "error",
  category: string,
  message: string,
  details?: any,
  code?: number,
) {
  if (!isEnabled) return;

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    category,
    code,
    message,
    details,
    sessionId: getSessionId(),
  };

  logBuffer.push(entry);
  if (logBuffer.length > MAX_LOG_ENTRIES) {
    logBuffer = logBuffer.slice(-MAX_LOG_ENTRIES);
  }

  const logDetails = details ? JSON.stringify(details) : "";
  const formattedMessage = `[${entry.timestamp}] ${level.toUpperCase()} ${category}${
    code ? ` (#${code})` : ""
  }: ${message}${logDetails ? ` — ${logDetails}` : ""}`;

  if (level === "error") {
    console.error(formattedMessage);
  } else if (level === "warn") {
    console.warn(formattedMessage);
  } else {
    console.log(formattedMessage);
  }

  flushBuffer();
}

export async function exportDebugLogs(): Promise<string | null> {
  if (Platform.OS === "web") {
    return localStorage.getItem(LOG_FILE);
  }

  try {
    const filepath = getLogPath();
    if (!filepath) return null;
    const file = new FileSystem.File(filepath);
    const content = await file.text();
    return content;
  } catch (e) {
    console.warn("Failed to read debug logs:", e);
    return null;
  }
}

export function enableDebugLogging(enabled: boolean) {
  isEnabled = enabled;
}

export function clearDebugLogs() {
  logBuffer = [];
  if (Platform.OS === "web") {
    localStorage.removeItem(LOG_FILE);
  } else {
    try {
      const filepath = getLogPath();
       if (filepath) {
         const file = new FileSystem.File(filepath);
         if (file.exists) {
           file.delete();
         }
       }
    } catch (e) {
      // File may not exist yet
    }
  }
}

export const DebugLogger = {
  debug: (category: string, message: string, details?: any, code?: number) =>
    debugLog("debug", category, message, details, code),
  info: (category: string, message: string, details?: any, code?: number) =>
    debugLog("info", category, message, details, code),
  warn: (category: string, message: string, details?: any, code?: number) =>
    debugLog("warn", category, message, details, code),
  error: (category: string, message: string, details?: any, code?: number) =>
    debugLog("error", category, message, details, code),
  export: exportDebugLogs,
  clear: clearDebugLogs,
  enable: enableDebugLogging,
};