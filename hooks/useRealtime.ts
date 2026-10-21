import { useEffect, useRef, useState, useCallback } from "react";
import * as SecureStore from "expo-secure-store";
import {
  reconcileRealtimeDocument,
  reconcileRealtimeReminder,
} from "../services/localDatabase";

export interface RealtimeMessage {
  type: "connected" | "realtime" | "error";
  table?: "documents" | "reminders" | "profiles";
  event?: "INSERT" | "UPDATE" | "DELETE";
  data?: any;
  timestamp: string;
  message?: string;
}

export interface UseRealtimeOptions {
  onDocumentChange?: (event: "INSERT" | "UPDATE" | "DELETE", data: any) => void;
  onReminderChange?: (event: "INSERT" | "UPDATE" | "DELETE", data: any) => void;
  onProfileChange?: (event: "INSERT" | "UPDATE" | "DELETE", data: any) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Error) => void;
}

/**
 * The realtime feed of the local vault.
 *
 * The hook is implemented and the reconciliation it drives
 * (`reconcileRealtimeDocument`, `reconcileRealtimeReminder`) is written and
 * reviewed, but no screen mounts this hook, so no realtime message is
 * received today and the reconciliation code does not run.
 *
 * That is deliberate for now: mounting the hook opens a websocket to the API
 * for every session, which is a behaviour change rather than a repair. The
 * sync worker remains the only path that brings server changes into the
 * device, and it does so with the conflict detection that the reconciliation
 * code would otherwise duplicate.
 *
 * When the hook is mounted, the reconciliation has to be covered by tests
 * before it goes live: it writes to the local database from a server event.
 */
export function useRealtime(options: UseRealtimeOptions = {}) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<RealtimeMessage | null>(null);

  const connect = useCallback(async () => {
    try {
      const token = await SecureStore.getItemAsync("userToken");
      if (!token) {
        console.warn("No auth token for realtime connection");
        return;
      }

      const apiUrl = process.env.EXPO_PUBLIC_API_URL || "https://docuguard-api-onoj.onrender.com";
      const wsUrl = apiUrl.replace("https://", "wss://").replace("http://", "ws://");
      const ws = new WebSocket(`${wsUrl}/ws?token=${token}`);

      ws.onopen = () => {
        console.log("Realtime: Connected");
        setConnected(true);
        options.onConnect?.();
      };

      ws.onmessage = (event) => {
        try {
          const message: RealtimeMessage = JSON.parse(event.data);
          setLastMessage(message);

          if (message.type === "realtime" && message.table && message.event && message.data) {
            if (message.table === "documents") {
              reconcileRealtimeDocument(message.event, message.data).catch((error: Error) =>
                console.error("Realtime: failed to reconcile document", error),
              );
              options.onDocumentChange?.(message.event, message.data);
            } else if (message.table === "reminders") {
              reconcileRealtimeReminder(message.event, message.data).catch((error: Error) =>
                console.error("Realtime: failed to reconcile reminder", error),
              );
              options.onReminderChange?.(message.event, message.data);
            } else if (message.table === "profiles") {
              options.onProfileChange?.(message.event, message.data);
            }
          }
        } catch (err) {
          console.error("Realtime: Failed to parse message", err);
        }
      };

      ws.onclose = (event) => {
        console.log("Realtime: Disconnected", event.code, event.reason);
        setConnected(false);
        options.onDisconnect?.();

        if (event.code !== 1000) {
          reconnectTimeoutRef.current = setTimeout(connect, 5000);
        }
      };

      ws.onerror = (error) => {
        console.error("Realtime: Error", error);
        options.onError?.(error as any);
      };

      wsRef.current = ws;
    } catch (err) {
      console.error("Realtime: Connection failed", err);
    }
  }, [options]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close(1000, "Intentional disconnect");
      wsRef.current = null;
    }
    setConnected(false);
  }, []);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  const sendMessage = useCallback((message: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  return {
    connected,
    lastMessage,
    sendMessage,
    connect,
    disconnect,
  };
}