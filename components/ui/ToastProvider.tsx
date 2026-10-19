import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useMemo,
  type ReactNode,
} from "react";
import { Toast, type ToastType, type ToastProps } from "./Toast";

export type { ToastType };

interface ToastItem extends ToastProps {
  id: number;
}

interface ToastContextValue {
  show: (message: string, type?: ToastType, duration?: number) => void;
  success: (message: string, duration?: number) => void;
  error: (message: string, duration?: number) => void;
  warning: (message: string, duration?: number) => void;
  info: (message: string, duration?: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION = 4000;
const MAX_VISIBLE_TOASTS = 3;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idCounter = useRef(0);

  const removeToast = useCallback((id: number) => {
    setToasts((previous) => previous.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (
      message: string,
      type: ToastType = "success",
      duration = DEFAULT_DURATION,
    ) => {
      if (typeof message !== "string" || !message.trim()) {
        return;
      }

      const safeType: ToastType =
        type === "success" ||
        type === "error" ||
        type === "warning" ||
        type === "info"
          ? type
          : "success";

      const safeDuration =
        Number.isFinite(duration) && duration > 0 ? duration : DEFAULT_DURATION;

      const id = ++idCounter.current;

      const newToast: ToastItem = {
        id,
        visible: true,
        message: message.trim(),
        type: safeType,
        duration: safeDuration,
        onDismiss: () => removeToast(id),
      };

      setToasts((previous) =>
        [...previous, newToast].slice(-MAX_VISIBLE_TOASTS),
      );
    },
    [removeToast],
  );

  const success = useCallback(
    (message: string, duration = 4000) => show(message, "success", duration),
    [show],
  );

  const error = useCallback(
    (message: string, duration = 6000) => show(message, "error", duration),
    [show],
  );

  const warning = useCallback(
    (message: string, duration = 5000) => show(message, "warning", duration),
    [show],
  );

  const info = useCallback(
    (message: string, duration = 4000) => show(message, "info", duration),
    [show],
  );

  const contextValue = useMemo(
    () => ({ show, success, error, warning, info }),
    [show, success, error, warning, info],
  );

  return (
    <ToastContext.Provider value={contextValue}>
      {children}

      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          visible={toast.visible}
          message={toast.message}
          type={toast.type}
          duration={toast.duration}
          onDismiss={toast.onDismiss}
        />
      ))}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);

  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }

  return context;
}
