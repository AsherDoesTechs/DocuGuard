import { showAlert, alertHelpers, type AlertType, type AlertButton } from "@/components/ui/AlertService";
import { useToast, type ToastType } from "@/components/ui/ToastProvider";
import { feedbackManager, type FeedbackType } from "@/hooks/useFeedback";
import { COLORS } from "@/constants";

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel?: () => void;
}

export interface ToastOptions {
  message: string;
  type?: ToastType;
  duration?: number;
}

export interface AlertOptions {
  title: string;
  message?: string;
  type?: AlertType;
  buttons?: AlertButton[];
}

export interface LoadingOptions {
  message?: string;
}

export interface ScanProgressOptions {
  stage: "preparing" | "capturing" | "processing" | "ocr" | "saving" | "complete" | "error";
  message: string;
  progress?: number;
  onRetry?: () => void;
}

export interface StorageWarningOptions {
  used: number;
  total: number;
  action?: string;
}

export class FeedbackService {
  private static instance: FeedbackService;
  private toastContext: ReturnType<typeof useToast> | null = null;

  static getInstance(): FeedbackService {
    if (!FeedbackService.instance) {
      FeedbackService.instance = new FeedbackService();
    }
    return FeedbackService.instance;
  }

  setToastContext(context: ReturnType<typeof useToast>) {
    this.toastContext = context;
  }

  async confirm(options: ConfirmOptions): Promise<void> {
    const {
      title,
      message,
      confirmText = "Confirm",
      cancelText = "Cancel",
      destructive = false,
      onConfirm,
      onCancel,
    } = options;

    const buttons: AlertButton[] = [
      { text: cancelText, style: "cancel", onPress: onCancel },
      {
        text: confirmText,
        style: destructive ? "destructive" : "default",
        onPress: onConfirm,
      },
    ];

    showAlert(title, message, {
      type: destructive ? "warning" : "default",
      buttons,
    });
  }

  success(message: string, duration = 4000): void {
    this.showToast(message, "success", duration);
  }

  error(message: string, duration = 6000): void {
    this.showToast(message, "error", duration);
    this.triggerFeedback("error");
  }

  warning(message: string, duration = 5000): void {
    this.showToast(message, "warning", duration);
    this.triggerFeedback("warning");
  }

  info(message: string, duration = 4000): void {
    this.showToast(message, "info", duration);
    this.triggerFeedback("info");
  }

  private showToast(message: string, type: ToastType, duration: number): void {
    if (this.toastContext) {
      this.toastContext.show(message, type, duration);
    }
  }

  private async triggerFeedback(type: FeedbackType): Promise<void> {
    await feedbackManager.trigger(type, { sound: true, haptic: true });
  }

  async alert(options: AlertOptions): Promise<void> {
    if (options.type === "error") {
      await this.triggerFeedback("error");
    } else if (options.type === "warning") {
      await this.triggerFeedback("warning");
    }
    showAlert(options.title, options.message, {
      type: options.type || "default",
      buttons: options.buttons || [{ text: "OK" }],
    });
  }

  async showDeleteConfirmation(
    itemName: string,
    onConfirm: () => void | Promise<void>,
    onCancel?: () => void
  ): Promise<void> {
    return this.confirm({
      title: "Delete Document",
      message: `Are you sure you want to delete "${itemName}"? This action cannot be undone.`,
      confirmText: "Delete",
      cancelText: "Cancel",
      destructive: true,
      onConfirm,
      onCancel,
    });
  }

  async showNetworkError(retry?: () => void): Promise<void> {
    const buttons: AlertButton[] = [{ text: "OK" }];
    if (retry) {
      buttons.unshift({ text: "Retry", onPress: retry });
    }

    showAlert("Connection Error", "Unable to connect to the server. Please check your internet connection and try again.", {
      type: "error",
      buttons,
    });
  }

  async showServerError(message?: string): Promise<void> {
    showAlert("Server Error", message || "Something went wrong on our servers. Please try again later.", {
      type: "error",
      buttons: [{ text: "OK" }],
    });
  }

  async showUnauthorized(onSignIn: () => void): Promise<void> {
    showAlert("Session Expired", "Your session has expired. Please sign in again to continue.", {
      type: "warning",
      buttons: [
        { text: "Cancel", style: "cancel" },
        { text: "Sign In", onPress: onSignIn },
      ],
    });
  }

  async showStorageWarning(options: StorageWarningOptions): Promise<void> {
    const { used, total, action } = options;
    const percentage = Math.round((used / total) * 100);

    let message = `You've used ${used.toFixed(1)} MB of ${total} MB (${percentage}%) of your storage.`;
    if (action) {
      message += ` ${action}`;
    }
    message += " Consider upgrading your plan or removing old documents.";

    showAlert("Storage Almost Full", message, {
      type: "warning",
      buttons: [
        { text: "Dismiss", style: "cancel" },
        { text: "View Plans", onPress: () => {} },
      ],
    });
  }

  async showScanProgress(options: ScanProgressOptions): Promise<void> {
    // This would typically update a modal or dedicated scan screen
    // For now, we'll use toast for progress updates
    const { stage, message, progress, onRetry } = options;

    const type: ToastType = stage === "error" ? "error" : stage === "complete" ? "success" : "info";
    const duration = stage === "complete" ? 3000 : 2000;

    this.showToast(`${message}${progress !== undefined ? ` (${Math.round(progress)}%)` : ""}`, type, duration);

    if (stage === "error") {
      await this.triggerFeedback("error");
    }

    if (stage === "error" && onRetry) {
      setTimeout(() => {
        showAlert("Scan Failed", "The document scan encountered an error.", {
          type: "error",
          buttons: [
            { text: "Cancel", style: "cancel" },
            { text: "Retry", onPress: onRetry },
          ],
        });
      }, 500);
    }
  }

  async showEmailVerificationSent(email: string, onResend?: () => void): Promise<void> {
    const buttons: AlertButton[] = [{ text: "OK" }];
    if (onResend) {
      buttons.unshift({
        text: "Resend Email",
        onPress: onResend,
        style: "default",
      });
    }

    showAlert("Verification Email Sent", `We've sent a verification link to ${email}. Please check your inbox (and spam folder).`, {
      type: "info",
      buttons,
    });
  }

  async showResendCooldown(seconds: number): Promise<void> {
    this.warning(`Please wait ${seconds} seconds before requesting another email.`);
  }

  async showReminderSaved(): Promise<void> {
    this.success("Reminder saved successfully");
  }

  async showReminderDeleted(): Promise<void> {
    this.success("Reminder deleted");
  }

  async showDocumentSaved(): Promise<void> {
    this.success("Document saved successfully");
  }

  async showDocumentDeleted(): Promise<void> {
    this.success("Document deleted");
  }

  async showSyncComplete(synced: number, failed: number): Promise<void> {
    if (failed > 0) {
      this.warning(`Synced ${synced} items. ${failed} item(s) failed to sync.`);
    } else {
      this.success(`Successfully synced ${synced} item(s)`);
    }
  }

  async showProfileUpdated(): Promise<void> {
    this.success("Profile updated successfully");
  }

  async showSettingsSaved(): Promise<void> {
    this.success("Settings saved");
  }

  async showBiometricEnabled(type: string): Promise<void> {
    this.success(`${type} enabled for secure access`);
  }

  async showBiometricDisabled(): Promise<void> {
    this.info("Biometric authentication disabled");
  }

  async showAppLockEnabled(): Promise<void> {
    this.success("App Lock enabled. Your vault is now protected.");
  }

  async showAppLockDisabled(): Promise<void> {
    this.info("App Lock disabled");
  }

  async showPasswordChanged(): Promise<void> {
    this.success("Password changed successfully");
  }

  async showTwoFactorEnabled(): Promise<void> {
    this.success("Two-factor authentication enabled");
  }

  async showTwoFactorDisabled(): Promise<void> {
    this.info("Two-factor authentication disabled");
  }
}

export const feedbackService = FeedbackService.getInstance();

export function useFeedbackService() {
  const toast = useToast();

  // Initialize the feedback service with toast context
  if (typeof window !== "undefined" && !feedbackService["toastContext"]) {
    feedbackService.setToastContext(toast);
  }

  return feedbackService;
}