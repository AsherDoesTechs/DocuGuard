import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
// Removed NativeAlert import since we are forcing the custom modal
import { AlertModal, type AlertButton, type AlertType } from "./AlertModal";

interface AlertOptions {
  type?: AlertType;
  buttons?: AlertButton[];
  onDismiss?: () => void;
}

interface AlertContextValue {
  alert: (title: string, message?: string, options?: AlertOptions) => void;
}

const AlertContext = createContext<AlertContextValue | null>(null);

let globalAlert:
  | ((title: string, message?: string, options?: AlertOptions) => void)
  | null = null;

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

  // Custom warning instead of falling back to the native black box
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
  const [buttons, setButtons] = useState<AlertButton[]>([]);
  const [onDismiss, setOnDismiss] = useState<(() => void) | undefined>(
    undefined,
  );

  const alert = useCallback(
    (alertTitle: string, alertMessage?: string, options?: AlertOptions) => {
      setTitle(alertTitle);
      setMessage(alertMessage);
      setType(options?.type || "default");
      setButtons(options?.buttons || [{ text: "OK" }]);
      setOnDismiss(() => options?.onDismiss);
      setOpen(true);
    },
    [],
  );

  const dismiss = useCallback(() => {
    setOpen(false);
    onDismiss?.();
  }, [onDismiss]);

  const value = useMemo(() => ({ alert }), [alert]);

  // Register the global alert function so non-hook callers can use it
  React.useEffect(() => {
    globalAlert = alert;
    return () => {
      globalAlert = null;
    };
  }, [alert]);

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
