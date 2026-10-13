import React, {
  createContext,
  useContext,
  useState,
  useCallback,
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

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idCounter = React.useRef(0);

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (message: string, type: ToastType = "success", duration = 4000) => {
      const id = ++idCounter.current;
      setToasts((prev) => [...prev, { id, visible: true, message, type, duration, onDismiss: () => removeToast(id) }]);
    },
    [removeToast],
  );

  const success = useCallback((message: string, duration = 4000) => show(message, "success", duration), [show]);
  const error = useCallback((message: string, duration = 6000) => show(message, "error", duration), [show]);
  const warning = useCallback((message: string, duration = 5000) => show(message, "warning", duration), [show]);
  const info = useCallback((message: string, duration = 4000) => show(message, "info", duration), [show]);

  return (
    <ToastContext.Provider value={{ show, success, error, warning, info }}>
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