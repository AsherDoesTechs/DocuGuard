import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertModal, type AlertButton, type AlertType } from "./AlertModal";

export type { AlertType, AlertButton };

interface AlertOptions {
  type?: AlertType;
  buttons?: AlertButton[];
  onDismiss?: () => void;
}

interface AlertContextValue {
  alert: (title: string, message?: string, options?: AlertOptions) => void;
}

const AlertContext = createContext<AlertContextValue | null>(null);

type AlertFunction = (
  title: string,
  message?: string,
  options?: AlertOptions,
) => void;

let globalAlert: AlertFunction | null = null;

export function useAlert() {
  const ctx = useContext(AlertContext);

  if (!ctx) {
    throw new Error("useAlert must be used within an AlertProvider");
  }

  return ctx;
}

export function showAlert(
  title: string,
  message?: string,
  options?: AlertOptions,
) {
  if (globalAlert) {
    globalAlert(title, message, options);
    return;
  }

  console.warn(
    "showAlert was called before AlertProvider was mounted. Make sure your root layout wraps the app in <AlertProvider>.",
  );
}

export const AlertProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [type, setType] = useState<AlertType>("default");
  const [buttons, setButtons] = useState<AlertButton[]>([{ text: "OK" }]);

  const onDismissRef = useRef<(() => void) | undefined>(undefined);
  const mountedRef = useRef(true);

  const alert = useCallback<AlertFunction>(
    (alertTitle, alertMessage, options) => {
      setTitle(alertTitle);
      setMessage(alertMessage);
      setType(options?.type ?? "default");
      setButtons(options?.buttons ?? [{ text: "OK" }]);
      onDismissRef.current = options?.onDismiss;
      setOpen(true);
    },
    [],
  );

  const dismiss = useCallback(() => {
    if (!open) return;

    setOpen(false);

    const callback = onDismissRef.current;
    onDismissRef.current = undefined;

    try {
      callback?.();
    } catch (error) {
      console.error("Alert dismissal callback failed:", error);
    }
  }, [open]);

  useEffect(() => {
    mountedRef.current = true;
    globalAlert = alert;

    return () => {
      mountedRef.current = false;

      if (globalAlert === alert) {
        globalAlert = null;
      }
    };
  }, [alert]);

  const value = useMemo(() => ({ alert }), [alert]);

  return (
    <AlertContext.Provider value={value}>
      {children}

      <AlertModal
        visible={open}
        title={title}
        message={message}
        type={type}
        buttons={buttons}
        onDismiss={dismiss}
      />
    </AlertContext.Provider>
  );
};

export const alertHelpers = {
  success: (title: string, message?: string, buttons?: AlertButton[]) =>
    showAlert(title, message, { type: "success", buttons }),

  error: (title: string, message?: string, buttons?: AlertButton[]) =>
    showAlert(title, message, { type: "error", buttons }),

  warning: (title: string, message?: string, buttons?: AlertButton[]) =>
    showAlert(title, message, { type: "warning", buttons }),

  info: (title: string, message?: string, buttons?: AlertButton[]) =>
    showAlert(title, message, { type: "info", buttons }),

  confirm: (
    title: string,
    message: string,
    onConfirm: () => void,
    onCancel?: () => void,
  ) =>
    showAlert(title, message, {
      buttons: [
        { text: "Cancel", style: "cancel", onPress: onCancel },
        { text: "OK", onPress: onConfirm },
      ],
    }),
};
