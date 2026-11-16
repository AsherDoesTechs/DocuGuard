import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { Animated, Platform, StyleSheet, Text, View } from "react-native";
import { AdminColors, AdminRadii } from "../theme/adminTheme";

type ToastType = "success" | "error" | "info" | "warning";

type ToastItem = {
  id: number;
  message: string;
  type: ToastType;
};

type ToastCtx = {
  show: (message: string, type?: ToastType) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
};

const Ctx = createContext<ToastCtx | null>(null);

let nextId = 1;

export function AdminToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastItem | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hide = useCallback(() => {
    Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => setToast(null));
  }, [opacity]);

  const show = useCallback(
    (message: string, type: ToastType = "info") => {
      if (timer.current) clearTimeout(timer.current);
      setToast({ id: nextId++, message, type });
      Animated.timing(opacity, { toValue: 1, duration: 160, useNativeDriver: true }).start();
      timer.current = setTimeout(hide, 3200);
    },
    [hide, opacity]
  );

  const value = useMemo<ToastCtx>(
    () => ({
      show,
      success: (m) => show(m, "success"),
      error: (m) => show(m, "error"),
      info: (m) => show(m, "info"),
    }),
    [show]
  );

  const palette =
    toast?.type === "success"
      ? { bg: AdminColors.successSoft, border: "#BBF7D0", text: AdminColors.successText }
      : toast?.type === "error"
        ? { bg: AdminColors.dangerSoft, border: "#FECACA", text: AdminColors.dangerText }
        : toast?.type === "warning"
          ? { bg: AdminColors.warningSoft, border: "#FDE68A", text: AdminColors.warningText }
          : { bg: "#EFF6FF", border: "#BFDBFE", text: AdminColors.primaryDark };

  return (
    <Ctx.Provider value={value}>
      {children}
      {toast ? (
        <Animated.View
          pointerEvents="box-none"
          style={[
            styles.wrap,
            Platform.OS === "web" ? ({ position: "fixed" } as any) : null,
            { opacity },
          ]}
        >
          <View style={[styles.toast, { backgroundColor: palette.bg, borderColor: palette.border }]}>
            <Text style={[styles.text, { color: palette.text }]} numberOfLines={3}>
              {toast.message}
            </Text>
          </View>
        </Animated.View>
      ) : null}
    </Ctx.Provider>
  );
}

export function useAdminToast() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAdminToast must be used within AdminToastProvider");
  return ctx;
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    top: Platform.OS === "web" ? 20 : 48,
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 9999,
    paddingHorizontal: 16,
  },
  toast: {
    maxWidth: 520,
    width: "100%",
    borderWidth: 1,
    borderRadius: AdminRadii.md,
    paddingVertical: 12,
    paddingHorizontal: 14,
    ...(Platform.OS === "web"
      ? ({ boxShadow: "0 8px 24px rgba(0,0,0,0.12)" } as any)
      : { shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 12, elevation: 6 }),
  },
  text: { fontSize: 13, fontWeight: "600", lineHeight: 18 },
});