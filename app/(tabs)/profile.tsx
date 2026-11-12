import React, { useState, useEffect, useCallback, useMemo } from "react";
import * as ImagePicker from "expo-image-picker";

import {
  View,
  DeviceEventEmitter,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Modal,
  FlatList,
  Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Card } from "../../components/ui";
import { SubscriptionView } from "../../components/ui/SubscriptionView";
import { RefreshableContainer } from "@/components/ui/RefreshableContainer";
import { ProfileSkeleton } from "@/components/ui/Skeleton";
import * as SecureStore from "expo-secure-store";
import { api } from "../../services/api";
import {
  exportLocalBackup,
  importLocalBackup,
} from "../../services/backupService";
import {
  getUserProfile,
  getAllDocuments,
  getLocalDataOwnerIdForSessionExpiration,
  purgeLocalDataForUser,
  saveUserProfile,
} from "../../services/localDatabase";
import { removePushTokenFromBackend } from "../../hooks/usePushNotifications";
import { resolveSignOutTokenOutcome } from "@/shared/sync/pushTokenOwnership";
import { setNotificationsEnabled } from "../../services/notificationPreferences";
import { checkAndScheduleAlerts } from "../../services/notificationScheduler";
import * as LocalAuthentication from "expo-local-authentication";
import * as Clipboard from "expo-clipboard";
import {
  feedbackService,
  useFeedbackService,
} from "../../services/feedbackService";
import { useTheme } from "@/context/ThemeContext";
import type { ThemeMode, ColorScheme } from "@/constants/colors";

type SettingsTab =
  | "none"
  | "personal"
  | "security"
  | "notifications"
  | "documents"
  | "appearance"
  | "activity"
  | "subscription"
  | "support"
  | "privacy"
  | "backup";

type IconName = keyof typeof Ionicons.glyphMap;

interface SubscriptionDetails {
  planName: string;
  renewalDate: string;
  storageUsed: number;
  storageTotal: number;
  serialNumber?: string;
}

interface UserProfile {
  name: string;
  email: string;
  occupation?: string;
  securityLevel: string;
  documentCount: number;
  expiringCount: number;
  notifyPush: boolean;
  notifyEmail: boolean;
  notifyExpiry: boolean;
  twoFactor: boolean;
  biometricEnabled: boolean;
  appLockEnabled: boolean;
  subscription: SubscriptionDetails;
  serialNumber: string;
}

interface LoginSession {
  id: string;
  device: string;
  browser: string;
  location: string;
  lastActive: string;
  current: boolean;
}

interface BiometricState {
  available: boolean;
  enrolled: boolean;
  enabled: boolean;
  type: "fingerprint" | "face" | "iris" | "unknown";
}

interface SettingRowProps {
  colors: ColorScheme;
  styles: Record<string, any>;
  icon: IconName;
  title: string;
  subtitle: string;
  isActive: boolean;
  onPress: () => void;
  isDestructive?: boolean;
}

const OCCUPATION_LIST = [
  "Student",
  "OFW",
  "Senior Citizen",
  "Freelancer",
  "Registered Nurse",
  "Software Engineer",
  "Teacher / Educator",
  "Accountant",
  "Business Owner",
  "Virtual Assistant",
  "Civil Engineer",
  "Graphic Designer",
  "Medical Doctor",
  "Sales Professional",
  "Customer Service Representative",
  "Police Officer / Military",
  "Government Employee",
  "Driver / Delivery Personnel",
  "Chef / Cook",
  "Electrician / Plumber",
  "Others",
];

const SettingRow = ({
  colors,
  styles,
  icon,
  title,
  subtitle,
  isActive,
  onPress,
  isDestructive = false,
}: SettingRowProps) => (
  <TouchableOpacity
    onPress={onPress}
    accessibilityRole="button"
    accessibilityLabel={title}
  >
    <View
      style={[
        styles.settingRow,
        {
          backgroundColor: colors.surface,
          borderColor: isActive ? colors.primary : colors.border,
        },
      ]}
    >
      <Ionicons
        name={icon}
        size={22}
        color={isDestructive ? colors.error : colors.primary}
      />
      <View style={styles.settingInfo}>
        <Text
          style={[
            styles.settingTitle,
            { color: isDestructive ? colors.error : colors.text },
          ]}
        >
          {title}
        </Text>
        <Text style={[styles.settingSubtitle, { color: colors.textSecondary }]}>
          {subtitle}
        </Text>
      </View>
      <Ionicons
        name={isActive ? "chevron-down" : "chevron-forward"}
        size={20}
        color={isActive ? colors.primary : colors.border}
      />
    </View>
  </TouchableOpacity>
);

const UniqueAvatar = ({
  name,
  colors,
  styles,
}: {
  name: string;
  colors: ColorScheme;
  styles: Record<string, any>;
}) => {
  const getInitials = (str: string) => {
    if (!str) return "??";
    const parts = str.trim().split(" ");
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return str.substring(0, 2).toUpperCase();
  };

  return (
    <View style={styles.uniqueAvatarContainer}>
      <View style={[styles.abstractShape, styles.shape1]} />
      <View style={[styles.abstractShape, styles.shape2]} />
      <View style={[styles.abstractShape, styles.shape3]} />
      <Text style={styles.avatarInitials}>{getInitials(name)}</Text>
    </View>
  );
};

const getApiErrorMessage = (err: any, fallback: string): string => {
  return (
    err?.response?.data?.error ||
    err?.response?.data?.message ||
    err?.message ||
    fallback
  );
};

export default function ProfileScreen() {
  const { themeMode, setThemeMode, colors, isDark } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<SettingsTab>("none");

  // 1. Change initial loading state to false so the UI renders instantly
  const [loading, setLoading] = useState(false);

  // 2. Pre-populate user state with local data immediately if available
  const [user, setUser] = useState<UserProfile | null>(() => {
    // We can do a quick synchronous or initial default fallback state here
    return {
      name: "Loading...",
      email: "",
      securityLevel: "Standard",
      documentCount: 0,
      expiringCount: 0,
      notifyPush: false,
      notifyEmail: true,
      notifyExpiry: true,
      twoFactor: false,
      biometricEnabled: false,
      appLockEnabled: false,
      subscription: {
        planName: "Free",
        renewalDate: "N/A",
        storageUsed: 0,
        storageTotal: 50,
      },
      serialNumber: "DG-USER-0000",
    };
  });

  useFeedbackService();
  // ... (keep all your existing state hooks here: passwords, twoFactor, biometric, etc.)

  const [passwords, setPasswords] = useState({
    current: "",
    new: "",
    confirm: "",
  });

  const [twoFactor, setTwoFactor] = useState(false);
  const [, setSettingUp2FA] = useState(false);
  const [verifying2FA, setVerifying2FA] = useState(false);
  const [twoFactorSetup, setTwoFactorSetup] = useState<{
    secret: string;
    otpauthUri: string;
  } | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [twoFactorDisablePassword, setTwoFactorDisablePassword] = useState("");
  const [twoFactorDisableCode, setTwoFactorDisableCode] = useState("");
  const [twoFactorDisableMode, setTwoFactorDisableMode] = useState<
    "totp" | "recovery"
  >("totp");
  const [disabling2FA, setDisabling2FA] = useState(false);

  const [biometric, setBiometric] = useState<BiometricState>({
    available: false,
    enrolled: false,
    enabled: false,
    type: "unknown",
  });
  const [appLockEnabled, setAppLockEnabled] = useState(false);
  const [savingSecurity, setSavingSecurity] = useState(false);

  const [notifyEmail, setNotifyEmail] = useState(true);
  const [notifyPush, setNotifyPush] = useState(false);
  const [notifyExpiry, setNotifyExpiry] = useState(true);
  const [expiryLeadDays, setExpiryLeadDays] = useState("30");

  const [personalInfo, setPersonalInfo] = useState({
    name: "",
    email: "",
    phone: "",
    occupation: "",
  });
  const [savingPersonal, setSavingPersonal] = useState(false);
  const [maskPersonalData, setMaskPersonalData] = useState(true);

  // Dropdown States for "What I do"
  const [dropdownVisible, setDropdownVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isCustomOccupation, setIsCustomOccupation] = useState(false);

  const [loginSessions, setLoginSessions] = useState<LoginSession[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);

  const [docPreferences, setDocPreferences] = useState({
    autoScan: true,
    autoCategorize: true,
    expiryReminderDays: 30,
    defaultCategory: "other",
    sortBy: "expiry",
    sortOrder: "asc",
  });

  const [appearance, setAppearance] = useState({
    theme: "system", // system, light, dark
    fontSize: "medium",
    reducedMotion: false,
  });

  // Account Deletion States
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [deleteStep, setDeleteStep] = useState<1 | 2>(1);
  const [countdown, setCountdown] = useState(10);
  const [deletePassword, setDeletePassword] = useState("");
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [ticketSubject, setTicketSubject] = useState("");
  const [ticketMessage, setTicketMessage] = useState("");
  const [submittingTicket, setSubmittingTicket] = useState(false);
  const [ticketCategory, setTicketCategory] = useState("Bug / App Glitch");
  const [ticketAttachment, setTicketAttachment] = useState<string | null>(null);
  const [categoryModalVisible, setCategoryModalVisible] = useState(false);

  // Countdown timer for account deletion step 1
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;

    if (deleteModalVisible && deleteStep === 1 && countdown > 0) {
      timer = setInterval(() => {
        setCountdown((c) => c - 1);
      }, 1000);
    }

    return () => {
      if (timer !== undefined) {
        clearInterval(timer);
      }
    };
  }, [deleteModalVisible, deleteStep, countdown]);

  const checkBiometrics = useCallback(async () => {
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      const supportedTypes =
        await LocalAuthentication.supportedAuthenticationTypesAsync();

      let bioType: BiometricState["type"] = "unknown";
      if (
        supportedTypes.includes(
          LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION,
        )
      ) {
        bioType = "face";
      } else if (
        supportedTypes.includes(
          LocalAuthentication.AuthenticationType.FINGERPRINT,
        )
      ) {
        bioType = "fingerprint";
      } else if (
        supportedTypes.includes(LocalAuthentication.AuthenticationType.IRIS)
      ) {
        bioType = "iris";
      }

      const storedBiometric =
        await SecureStore.getItemAsync("biometricEnabled");
      const storedAppLock = await SecureStore.getItemAsync(
        "docuguard.appLock.enabled",
      );

      setBiometric({
        available: hasHardware,
        enrolled: isEnrolled,
        enabled: storedBiometric === "true" && hasHardware && isEnrolled,
        type: bioType,
      });
      setAppLockEnabled(storedAppLock === "true");
    } catch (err) {
      console.warn("Biometric check failed:", err);
    }
  }, []);

  const fetchProfile = useCallback(async () => {
    try {
      // 1. Instantly pull local cached profile & documents so UI renders immediately
      const localProfile = (await getUserProfile()) as any;
      const localDocs = await getAllDocuments();

      let serialNumber =
        localProfile?.serialNumber ||
        `DG-USER-${String(localDocs.length).padStart(4, "0")}`;

      if (localProfile) {
        setUser({
          name: localProfile.name,
          email: localProfile.email || "user@example.com",
          securityLevel: "Standard",
          documentCount: localDocs.length,
          expiringCount: localDocs.filter((d) => d.status === "expiring")
            .length,
          notifyEmail: localProfile.notifyEmail ?? true,
          notifyPush: localProfile.notificationsEnabled ?? false,
          notifyExpiry: localProfile.notifyExpiry ?? true,
          twoFactor: localProfile.twoFactor ?? false,
          serialNumber,
          subscription: {
            planName: "Free",
            renewalDate: "N/A",
            storageUsed: localDocs.length * 0.5,
            storageTotal: 50,
            serialNumber,
          },
          biometricEnabled: false,
          appLockEnabled: false,
        });

        const initialOcc = localProfile.occupation || "";
        const isStandard = OCCUPATION_LIST.includes(initialOcc);
        if (initialOcc && !isStandard) {
          setIsCustomOccupation(true);
        }

        setPersonalInfo({
          name: localProfile.name || "",
          email: localProfile.email || "",
          phone: localProfile.phone || "",
          occupation: initialOcc,
        });

        setTwoFactor(localProfile.twoFactor ?? false);
        setNotifyEmail(localProfile.notifyEmail ?? true);
        setNotifyPush(localProfile.notificationsEnabled ?? false);
        setNotifyExpiry(localProfile.notifyExpiry ?? true);
      }
    } catch (err) {
      console.error("Failed to load local profile cache:", err);
    }

    // 2. Run remote cloud synchronization silently in the background without blocking the UI
    try {
      const token = await SecureStore.getItemAsync("userToken");

      if (token) {
        const res = await api.client.get("/profile");
        const subData = res.data.subscription || {};
        const remoteOcc = res.data.occupation || "";
        const isStandardRemote = OCCUPATION_LIST.includes(remoteOcc);
        if (remoteOcc && !isStandardRemote) {
          setIsCustomOccupation(true);
        }

        setUser((prev) => ({
          ...prev!,
          ...res.data,
          storageUsedMB:
            typeof res.data.storageUsedMB === "number" &&
            isFinite(res.data.storageUsedMB)
              ? res.data.storageUsedMB
              : res.data.storageUsedMB === null
                ? null
                : undefined,
          serialNumber:
            res.data.serialNumber ||
            res.data.user?.serialNumber ||
            subData.serialNumber ||
            prev?.serialNumber ||
            "DG-USER-0000",
          subscription: {
            planName:
              subData.planName || prev?.subscription?.planName || "Free",
            renewalDate:
              subData.renewalDate || prev?.subscription?.renewalDate || "N/A",
            storageUsed:
              subData.storageUsed || prev?.subscription?.storageUsed || 0,
            storageTotal:
              subData.storageTotal || prev?.subscription?.storageTotal || 50,
            serialNumber:
              subData.serialNumber || prev?.subscription?.serialNumber,
          },
        }));

        setPersonalInfo({
          name: res.data.name || "",
          email: res.data.email || "",
          phone: res.data.phone || "",
          occupation: remoteOcc,
        });

        if (res.data.twoFactor !== undefined) {
          setTwoFactor(res.data.twoFactor);
        }

        if (res.data.documentPreferences) {
          setDocPreferences(res.data.documentPreferences);
        }

        try {
          const settingsResponse = await api.profile.getSettings();
          const savedDays = settingsResponse?.settings?.reminderBeforeDays;

          if (
            Number.isInteger(savedDays) &&
            savedDays >= 1 &&
            savedDays <= 30
          ) {
            setExpiryLeadDays(String(savedDays));
          }
        } catch (settingsError) {
          console.warn("Failed to load profile settings:", settingsError);
        }
      }
    } catch (err: any) {
      console.warn(
        "Background remote profile sync failed; continuing with local profile:",
        err,
      );
    }
  }, []);

  useEffect(() => {
    fetchProfile();
    checkBiometrics();
  }, [fetchProfile, checkBiometrics]);

  const handleSetup2FA = async () => {
    try {
      setSettingUp2FA(true);
      const token = await SecureStore.getItemAsync("userToken");
      const res = await api.client.post(
        "/profile/security/2fa/setup",
        {},
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      setTwoFactorSetup({
        secret: res.data.secret,
        otpauthUri: res.data.otpauthUri,
      });
      feedbackService.info("Scan the QR code with your authenticator app");
    } catch (error) {
      feedbackService.error(
        getApiErrorMessage(error, "Unable to start 2FA setup."),
      );
    } finally {
      setSettingUp2FA(false);
    }
  };

  const handleVerify2FA = async () => {
    if (twoFactorCode.length !== 6) {
      feedbackService.error("Please enter a valid 6-digit code.");
      return;
    }
    try {
      setVerifying2FA(true);
      const token = await SecureStore.getItemAsync("userToken");
      if (!token) {
        throw new Error("Your session has expired. Please sign in again.");
      }

      const res = await api.client.post(
        "/profile/security/2fa/verify",
        { code: twoFactorCode },
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      const issuedCodes = res.data?.recoveryCodes;
      if (!Array.isArray(issuedCodes) || issuedCodes.length !== 10) {
        throw new Error(
          "2FA was enabled, but recovery codes were not returned. Contact support before signing out.",
        );
      }

      setRecoveryCodes(issuedCodes);
      setTwoFactor(true);
      setTwoFactorSetup(null);
      setTwoFactorCode("");
      feedbackService.success(
        "Two-factor authentication enabled. Save your recovery codes now.",
      );
    } catch (error) {
      feedbackService.error(
        getApiErrorMessage(error, "Invalid verification code."),
      );
    } finally {
      setVerifying2FA(false);
    }
  };

  const handleDisable2FA = async () => {
    if (!twoFactorDisablePassword.trim()) {
      feedbackService.error("Enter your current password to disable 2FA.");
      return;
    }

    const normalizedCode = twoFactorDisableCode
      .replace(/[\s-]/g, "")
      .toUpperCase();

    if (twoFactorDisableMode === "totp" && !/^\d{6}$/.test(normalizedCode)) {
      feedbackService.error("Enter a valid 6-digit authenticator code.");
      return;
    }

    if (
      twoFactorDisableMode === "recovery" &&
      !/^[A-F0-9]{32}$/.test(normalizedCode)
    ) {
      feedbackService.error("Enter a valid 32-character recovery code.");
      return;
    }

    try {
      setDisabling2FA(true);
      const token = await SecureStore.getItemAsync("userToken");
      if (!token) {
        throw new Error("Your session has expired. Please sign in again.");
      }

      const payload: Record<string, unknown> = {
        currentPassword: twoFactorDisablePassword,
        twoFactor: false,
      };

      if (twoFactorDisableMode === "totp") {
        payload.twoFactorCode = normalizedCode;
      } else {
        payload.recoveryCode = normalizedCode;
      }

      await api.client.patch("/profile/security", payload, {
        headers: { Authorization: `Bearer ${token}` },
      });

      setTwoFactor(false);
      setRecoveryCodes(null);
      setTwoFactorSetup(null);
      setTwoFactorDisablePassword("");
      setTwoFactorDisableCode("");
      setTwoFactorDisableMode("totp");

      feedbackService.success("Two-factor authentication disabled.");
    } catch (error) {
      feedbackService.error(
        getApiErrorMessage(error, "Unable to disable 2FA."),
      );
    } finally {
      setDisabling2FA(false);
    }
  };

  const handleSubmitSupportTicket = async () => {
    if (!ticketMessage.trim()) {
      feedbackService.error("Please enter a message for your support ticket.");
      return;
    }

    try {
      setSubmittingTicket(true);
      const token = await SecureStore.getItemAsync("userToken");

      await api.client.post(
        "/profile/support",
        {
          subject: ticketSubject.trim() || "Support Request",
          category: ticketCategory,
          message: ticketMessage.trim(),
          attachmentUrl: ticketAttachment, // Optional file/image reference
        },
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      feedbackService.success("Support ticket submitted successfully.");
      setTicketSubject("");
      setTicketMessage("");
      setTicketAttachment(null);
      setTicketCategory("Bug / App Glitch");
    } catch (err: any) {
      feedbackService.error(
        getApiErrorMessage(err, "Failed to submit support ticket."),
      );
    } finally {
      setSubmittingTicket(false);
    }
  };

  const handlePickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0].uri) {
      setTicketAttachment(result.assets[0].uri);
      feedbackService.success("Screenshot attached successfully.");
    }
  };

  const handleToggleBiometric = async (value: boolean) => {
    if (value) {
      if (!biometric.available || !biometric.enrolled) {
        feedbackService.alert({
          title: "Error",
          message: "Biometrics are not set up on this device.",
          type: "error",
        });
        return;
      }
      const auth = await LocalAuthentication.authenticateAsync({
        promptMessage: "Authenticate to enable biometric protection",
        fallbackLabel: "Use Passcode",
      });
      if (!auth.success) {
        feedbackService.error("Biometric authentication cancelled");
        return;
      }
    }
    try {
      await SecureStore.setItemAsync("biometricEnabled", String(value));
      setBiometric((prev) => ({ ...prev, enabled: value }));
      DeviceEventEmitter.emit("docuguard.securityPreferencesChanged");
      feedbackService.success(
        value ? "Biometrics enabled" : "Biometrics disabled",
      );
    } catch {
      feedbackService.error("Failed to update biometric preference");
    }
  };

  const handleToggleAppLock = async (value: boolean) => {
    try {
      await SecureStore.setItemAsync(
        "docuguard.appLock.enabled",
        String(value),
      );
      setAppLockEnabled(value);
      DeviceEventEmitter.emit("docuguard.securityPreferencesChanged");
      feedbackService.success(
        value ? "App Lock enabled successfully" : "App Lock disabled",
      );
    } catch {
      feedbackService.error("Failed to update App Lock preference");
    }
  };

  const handleSaveSecurity = async () => {
    if (!passwords.current) {
      feedbackService.error("Please enter your current password.");
      return;
    }
    if (passwords.new && passwords.new.length < 12) {
      feedbackService.error("New password must be at least 12 characters.");
      return;
    }
    if (passwords.new && passwords.new !== passwords.confirm) {
      feedbackService.error("New passwords do not match.");
      return;
    }

    try {
      setSavingSecurity(true);
      const token = await SecureStore.getItemAsync("userToken");
      const payload: Record<string, unknown> = {
        currentPassword: passwords.current,
      };
      if (passwords.new) {
        payload.newPassword = passwords.new;
      }

      await api.client.patch("/profile/security", payload, {
        headers: { Authorization: `Bearer ${token}` },
      });

      feedbackService.success("Security settings updated successfully");
      setPasswords({ current: "", new: "", confirm: "" });
    } catch (err: any) {
      feedbackService.error(
        getApiErrorMessage(err, "Failed to update security settings."),
      );
    } finally {
      setSavingSecurity(false);
    }
  };

  const handleSavePersonalInfo = async () => {
    if (!personalInfo.name.trim() || !personalInfo.email.trim()) {
      feedbackService.error("Name and email cannot be empty.");
      return;
    }
    try {
      setSavingPersonal(true);
      const token = await SecureStore.getItemAsync("userToken");

      // 1. Save to backend/Supabase via API
      await api.client.patch("/profile", personalInfo, {
        headers: { Authorization: `Bearer ${token}` },
      });

      // 2. Persist locally including phone and occupation
      const currentLocalProfile = await getUserProfile();
      if (currentLocalProfile) {
        await saveUserProfile({
          ...currentLocalProfile,
          name: personalInfo.name,
          email: personalInfo.email,
          occupation: personalInfo.occupation,
          phone: personalInfo.phone, // Cast or include if local database supports it
        } as any);
      }

      setUser((prev) => (prev ? { ...prev, ...personalInfo } : null));
      feedbackService.success("Personal information updated securely.");
    } catch (err: any) {
      feedbackService.error(
        getApiErrorMessage(err, "Failed to update profile"),
      );
    } finally {
      setSavingPersonal(false);
    }
  };

  const handleExpiryLeadDaysSave = async () => {
    const days = Number(expiryLeadDays);

    if (
      !expiryLeadDays.trim() ||
      !Number.isInteger(days) ||
      days < 1 ||
      days > 30
    ) {
      feedbackService.error("Enter a whole number from 1 to 30 days.");
      return;
    }

    try {
      const token = await SecureStore.getItemAsync("userToken");

      if (!token) {
        feedbackService.error("Please sign in to save this setting.");
        return;
      }

      await api.profile.updateSettings({ reminderBeforeDays: days });

      setExpiryLeadDays(String(days));
      feedbackService.success("Reminder lead time saved.");
    } catch (err: any) {
      feedbackService.error(
        getApiErrorMessage(err, "Failed to save reminder lead time"),
      );
    }
  };

  const handleNotificationPreferenceChange = async (
    key: "notifyEmail" | "notifyPush" | "notifyExpiry",
    value: boolean,
  ) => {
    if (key === "notifyEmail") {
      setNotifyEmail(value);
    } else if (key === "notifyPush") {
      setNotifyPush(value);
    } else {
      setNotifyExpiry(value);
    }

    try {
      const current = await getUserProfile();

      if (current) {
        await saveUserProfile({
          ...current,
          preferencesDirty: true,
          notificationsEnabled:
            key === "notifyPush" ? value : current.notificationsEnabled,
          notifyEmail: key === "notifyEmail" ? value : current.notifyEmail,
          notifyExpiry: key === "notifyExpiry" ? value : current.notifyExpiry,
        });
      }

      if (key === "notifyPush") {
        await setNotificationsEnabled(value);
        await checkAndScheduleAlerts();
      }

      const token = await SecureStore.getItemAsync("userToken");

      if (token) {
        await api.client.patch(
          "/profile/preferences",
          {
            notifyEmail: key === "notifyEmail" ? value : undefined,
            notifyPush: key === "notifyPush" ? value : undefined,
            notifyExpiry: key === "notifyExpiry" ? value : undefined,
          },
          { headers: { Authorization: `Bearer ${token}` } },
        );
      }

      setUser((prev) =>
        prev
          ? {
              ...prev,
              notifyEmail: key === "notifyEmail" ? value : prev.notifyEmail,
              notifyPush: key === "notifyPush" ? value : prev.notifyPush,
              notifyExpiry: key === "notifyExpiry" ? value : prev.notifyExpiry,
            }
          : prev,
      );
    } catch (err: any) {
      feedbackService.error(
        getApiErrorMessage(err, "Failed to update notification settings"),
      );
    }
  };

  const fetchLoginSessions = useCallback(async () => {
    try {
      const token = await SecureStore.getItemAsync("userToken");
      if (!token) return;
      setLoadingSessions(true);
      const res = await api.client.get("/profile/sessions", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.data?.sessions) {
        setLoginSessions(res.data.sessions);
      }
    } catch (err) {
      console.error("Failed to fetch sessions:", err);
    } finally {
      setLoadingSessions(false);
    }
  }, []);

  const revokeSession = async (sessionId: string) => {
    try {
      const token = await SecureStore.getItemAsync("userToken");
      await api.client.delete(`/profile/sessions/${sessionId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      feedbackService.success("Session revoked");
      fetchLoginSessions();
    } catch (err: any) {
      feedbackService.error(
        getApiErrorMessage(err, "Failed to revoke session"),
      );
    }
  };

  const handleConfirmAccountDeletion = async () => {
    const password = deletePassword;

    if (!password) {
      feedbackService.error(
        "Please enter your account password to confirm deletion.",
      );
      return;
    }

    setDeletingAccount(true);

    let token: string | null;
    let ownerId: number | null;

    try {
      [token, ownerId] = await Promise.all([
        api.getStoredToken(),
        getLocalDataOwnerIdForSessionExpiration(),
      ]);

      if (!token || !ownerId || ownerId <= 0) {
        throw new Error(
          "The active account session or local account owner could not be verified.",
        );
      }
    } catch (error) {
      console.error("Could not capture the account deletion session:", error);
      feedbackService.error(
        "Could not verify the active account. Please sign in again before deleting your account.",
      );
      setDeletingAccount(false);
      return;
    }

    let tokenRemoved = false;

    try {
      tokenRemoved = await removePushTokenFromBackend(token);
    } catch {
      tokenRemoved = false;
    }

    try {
      await api.client.post(
        "/profile/delete-account",
        { password },
        { headers: { Authorization: `Bearer ${token}` } },
      );
    } catch (err: any) {
      feedbackService.error(
        getApiErrorMessage(
          err,
          "Failed to delete account. Password may be incorrect.",
        ),
      );
      setDeletingAccount(false);
      return;
    }

    let localCleanupFailed = false;

    try {
      await purgeLocalDataForUser(ownerId);
    } catch (error) {
      localCleanupFailed = true;
      console.error("Failed to remove the local copy of a deleted account:", {
        error,
        ownerId,
      });
    }

    let originalSessionClosed = false;

    try {
      originalSessionClosed = await api.auth.logout(token, ownerId);
    } catch (error) {
      console.error(
        "Could not conditionally close the deleted account session:",
        error,
      );
    }

    setDeleteModalVisible(false);
    setDeletingAccount(false);

    if (!originalSessionClosed) {
      feedbackService.warning(
        "The account was deleted, but a different or newer session is active. DocuGuard left that session untouched. Please verify the active account before continuing.",
      );
      return;
    }

    const cleanupFailed = localCleanupFailed || !tokenRemoved;

    if (cleanupFailed) {
      let message =
        "The account was deleted, but its copy on this device could not be removed. The data is not readable and is removed the next time an account signs in on this device.";

      if (!tokenRemoved && localCleanupFailed) {
        message =
          "The account was deleted, but this device could not be unregistered for push notifications and its local copy could not be removed. The notifications of the deleted account can still reach this device until the token is detached, and the local data is removed the next time an account signs in.";
      } else if (!tokenRemoved) {
        message =
          "The account was deleted, but this device could not be unregistered for push notifications. The notifications of the deleted account can still reach this device until the device reconnects and registers for another account.";
      }

      feedbackService.warning(message);
    } else {
      feedbackService.success("Account permanently deleted.");
    }

    router.replace("/(auth)/login" as any);
  };

  const SUPPORT_CATEGORIES = [
    "Bug / App Glitch",
    "Billing & Subscription",
    "Document / OCR Sync Issue",
    "Feature Request",
    "Account & Security",
    "General Inquiry",
  ];

  const handleSignOut = () => {
    feedbackService.confirm({
      title: "Sign Out",
      message: "Are you sure you want to sign out of your account?",
      confirmText: "Sign Out",
      cancelText: "Cancel",
      destructive: true,
      onConfirm: async () => {
        try {
          // 1. Immediately wipe local auth state and redirect away from protected screens first
          await SecureStore.deleteItemAsync("userToken");
          await SecureStore.deleteItemAsync("refreshToken");
          await SecureStore.deleteItemAsync("biometric_credentials");

          router.replace("/(auth)/login" as any);

          // 2. Perform server session cleanup & push-token removal in the background
          const [token, ownerId] = await Promise.all([
            api.getStoredToken(),
            getLocalDataOwnerIdForSessionExpiration(),
          ]);

          if (token && ownerId && ownerId > 0) {
            await api.auth.logout(token, ownerId).catch((err) => {
              console.warn("Server session revocation failed or offline:", err);
            });
            await removePushTokenFromBackend(token).catch(() => {});
          }
        } catch (error) {
          console.error("Failed to sign out cleanly:", error);
          // Fallback redirect just in case
          router.replace("/(auth)/login" as any);
        }
      },
      onCancel: () => {},
    });
  };

  const maskEmail = (email: string) => {
    if (!email || !maskPersonalData) return email;
    const parts = email.split("@");
    if (parts.length !== 2) return email;
    const namePart = parts[0];
    const maskedName =
      namePart.length > 2 ? namePart.substring(0, 2) + "***" : "***";
    return `${maskedName}@${parts[1]}`;
  };

  const filteredOccupations = OCCUPATION_LIST.filter((item) =>
    item.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <RefreshableContainer onRefresh={fetchProfile}>
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {loading ? (
              <ProfileSkeleton />
            ) : (
              <>
                {/* Header Profile Section */}
                <View style={styles.headerContainer}>
                  <UniqueAvatar
                    name={user?.name || "User"}
                    colors={colors}
                    styles={styles}
                  />
                  <View style={styles.headerTextContainer}>
                    <Text style={styles.userName}>
                      {user?.name || "Loading..."}
                    </Text>
                    <Text style={styles.userEmail}>
                      {maskEmail(user?.email || "user@example.com")}
                    </Text>

                    {/* --- Prominent Occupation Badge --- */}
                    {user?.occupation ? (
                      <View style={styles.occupationBadge}>
                        <Ionicons
                          name="briefcase-outline"
                          size={12}
                          color={colors.primary}
                          style={{ marginRight: 4 }}
                        />
                        <Text style={styles.occupationText}>
                          {user.occupation}
                        </Text>
                      </View>
                    ) : null}
                    {/* ----------------------------------- */}

                    <View style={styles.badgeContainer}>
                      <Text style={styles.badgeText}>
                        Plan: {user?.subscription.planName || "Free"}
                      </Text>
                      <Text style={styles.serialText}>
                        ID: {user?.serialNumber || "DG-USER-0000"}
                      </Text>
                    </View>
                  </View>
                </View>

                {/* Storage Card Section */}
                <Card style={styles.storageCard}>
                  <View style={styles.storageHeader}>
                    <Ionicons
                      name="cloud-outline"
                      size={20}
                      color={colors.primary}
                    />
                    <Text style={styles.storageTitle}>Vault Storage Usage</Text>
                  </View>
                  {(() => {
                    const storageUsedMB = (user as any)?.storageUsedMB;
                    if (
                      typeof storageUsedMB === "number" &&
                      isFinite(storageUsedMB)
                    ) {
                      return (
                        <>
                          <Text style={styles.storageDetails}>
                            {storageUsedMB.toFixed(1)} MB /{" "}
                            {user?.subscription?.storageTotal || 50} MB (
                            {user?.documentCount || 0} documents)
                          </Text>
                          <View style={styles.progressBarBackground}>
                            <View
                              style={[
                                styles.progressBarFill,
                                {
                                  width: `${Math.min(
                                    100,
                                    (storageUsedMB /
                                      (user?.subscription?.storageTotal ||
                                        50)) *
                                      100,
                                  )}%`,
                                },
                              ]}
                            />
                          </View>
                        </>
                      );
                    } else {
                      return (
                        <>
                          <Text style={styles.storageDetails}>
                            Storage usage unavailable
                          </Text>
                          <Text
                            style={{
                              fontSize: 11,
                              color: colors.textSecondary,
                              marginTop: 4,
                            }}
                          >
                            Physical storage usage could not be verified from
                            stored objects.
                          </Text>
                        </>
                      );
                    }
                  })()}
                </Card>

                {/* Settings Navigation Sections */}
                <View style={styles.sectionsContainer}>
                  {/* Personal Information */}
                  <SettingRow
                    colors={colors}
                    styles={styles}
                    icon="person-outline"
                    title="Personal Information"
                    subtitle="Anti-theft masking, update name and contact details"
                    isActive={activeTab === "personal"}
                    onPress={() =>
                      setActiveTab(
                        activeTab === "personal" ? "none" : "personal",
                      )
                    }
                  />
                  {activeTab === "personal" && (
                    <View style={styles.expandedSection}>
                      <View style={styles.rowBetween}>
                        <Text style={styles.label}>
                          Mask Sensitive On Screen
                        </Text>
                        <Switch
                          value={maskPersonalData}
                          onValueChange={setMaskPersonalData}
                        />
                      </View>
                      <Text style={styles.inputLabel}>Full Name</Text>
                      <TextInput
                        style={styles.input}
                        placeholder="Enter your full name"
                        placeholderTextColor={colors.textMuted}
                        value={personalInfo.name}
                        onChangeText={(text) =>
                          setPersonalInfo({ ...personalInfo, name: text })
                        }
                      />

                      <Text style={styles.inputLabel}>Email Address</Text>
                      <TextInput
                        style={styles.input}
                        placeholder="Enter your email address"
                        placeholderTextColor={colors.textMuted}
                        value={personalInfo.email}
                        autoCapitalize="none"
                        keyboardType="email-address"
                        onChangeText={(text) =>
                          setPersonalInfo({ ...personalInfo, email: text })
                        }
                      />

                      {/* --- What I do Dropdown Selection --- */}
                      <Text style={styles.inputLabel}>What I do</Text>
                      <TouchableOpacity
                        style={styles.dropdownSelectorButton}
                        onPress={() => setDropdownVisible(true)}
                      >
                        <Text
                          style={[
                            styles.dropdownSelectorText,
                            !personalInfo.occupation && { color: colors.textMuted },
                          ]}
                        >
                          {personalInfo.occupation || "Select what you do..."}
                        </Text>
                        <Ionicons
                          name="chevron-down"
                          size={18}
                          color={colors.textSecondary}
                        />
                      </TouchableOpacity>

                      {/* Manual Input Container if "Others" is chosen */}
                      {isCustomOccupation && (
                        <View style={{ marginTop: 8 }}>
                          <Text
                            style={[
                              styles.inputLabel,
                              { fontSize: 12, color: colors.textSecondary },
                            ]}
                          >
                            Please specify your occupation:
                          </Text>
                          <TextInput
                            style={styles.input}
                            placeholder="Type what you do..."
                            placeholderTextColor={colors.textMuted}
                            value={personalInfo.occupation}
                            onChangeText={(text) =>
                              setPersonalInfo({
                                ...personalInfo,
                                occupation: text,
                              })
                            }
                          />
                        </View>
                      )}
                      {/* ------------------------------------- */}

                      <Text style={styles.inputLabel}>
                        Phone Number (Optional)
                      </Text>
                      <TextInput
                        style={styles.input}
                        placeholder="+63 900 000 0000"
                        placeholderTextColor={colors.textMuted}
                        keyboardType="phone-pad"
                        value={personalInfo.phone}
                        onChangeText={(text) =>
                          setPersonalInfo({ ...personalInfo, phone: text })
                        }
                      />
                      <TouchableOpacity
                        style={styles.saveButton}
                        onPress={handleSavePersonalInfo}
                        disabled={savingPersonal}
                      >
                        {savingPersonal ? (
                          <ActivityIndicator color={colors.buttonPrimaryText} />
                        ) : (
                          <Text style={styles.saveButtonText}>
                            Save Personal Info
                          </Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  )}

                  {/* Security & Authentication */}
                  <SettingRow
                    colors={colors}
                    styles={styles}
                    icon="shield-checkmark-outline"
                    title="Security & Authentication"
                    subtitle="Password, 2FA setup, biometrics and app lock"
                    isActive={activeTab === "security"}
                    onPress={() => {
                      setActiveTab(
                        activeTab === "security" ? "none" : "security",
                      );
                      if (activeTab !== "security") fetchLoginSessions();
                    }}
                  />
                  {activeTab === "security" && (
                    <View style={styles.expandedSection}>
                      <Text style={styles.sectionSubtitle}>
                        Change Password
                      </Text>
                      <TextInput
                        style={styles.input}
                        placeholder="Current Password"
                        placeholderTextColor={colors.textMuted}
                        secureTextEntry
                        value={passwords.current}
                        onChangeText={(t) =>
                          setPasswords({ ...passwords, current: t })
                        }
                      />
                      <TextInput
                        style={styles.input}
                        placeholder="New Password (min 12 chars)"
                        placeholderTextColor={colors.textMuted}
                        secureTextEntry
                        value={passwords.new}
                        onChangeText={(t) =>
                          setPasswords({ ...passwords, new: t })
                        }
                      />
                      <TextInput
                        style={styles.input}
                        placeholder="Confirm New Password"
                        placeholderTextColor={colors.textMuted}
                        secureTextEntry
                        value={passwords.confirm}
                        onChangeText={(t) =>
                          setPasswords({ ...passwords, confirm: t })
                        }
                      />

                      <Text style={[styles.sectionSubtitle, { marginTop: 15 }]}>
                        Two-Factor Authentication (2FA)
                      </Text>

                      <View style={styles.rowBetween}>
                        <Text style={styles.label}>
                          Authenticator App:{" "}
                          {twoFactor ? "Enabled" : "Disabled"}
                        </Text>
                        {!twoFactor && !twoFactorSetup && (
                          <TouchableOpacity
                            style={styles.verifyButton}
                            onPress={handleSetup2FA}
                          >
                            <Text style={styles.saveButtonText}>
                              Set Up 2FA
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>

                      {twoFactorSetup && !twoFactor && (
                        <View style={styles.totpSetupContainer}>
                          <Text style={styles.totpInstructions}>
                            Add this key to your authenticator app or copy the
                            details below:
                          </Text>

                          {/* Secret Key Field with Copy Button */}
                          <View style={styles.rowBetween}>
                            <Text
                              style={[
                                styles.label,
                                {
                                  fontFamily:
                                    Platform.OS === "ios"
                                      ? "Courier"
                                      : "monospace",
                                  fontSize: 12,
                                },
                              ]}
                            >
                              Secret: {twoFactorSetup.secret}
                            </Text>
                            <TouchableOpacity
                              style={{
                                padding: 6,
                                backgroundColor: colors.primary,
                                borderRadius: 6,
                              }}
                              onPress={async () => {
                                await Clipboard.setStringAsync(
                                  twoFactorSetup.secret,
                                );
                                feedbackService.success(
                                  "Secret copied to clipboard!",
                                );
                              }}
                            >
                              <Ionicons
                                name="copy-outline"
                                size={16}
                                color={colors.buttonPrimaryText}
                              />
                            </TouchableOpacity>
                          </View>

                          {/* Provisioning URI with Copy Button */}
                          <Text
                            style={[styles.totpUriText, { marginTop: 8 }]}
                            numberOfLines={2}
                            selectable
                          >
                            {twoFactorSetup.otpauthUri}
                          </Text>
                          <TouchableOpacity
                            style={[
                              styles.saveButton,
                              {
                                padding: 8,
                                marginTop: 4,
                                flexDirection: "row",
                                gap: 6,
                                justifyContent: "center",
                              },
                            ]}
                            onPress={async () => {
                              await Clipboard.setStringAsync(
                                twoFactorSetup.otpauthUri,
                              );
                              feedbackService.success(
                                "Setup URI copied to clipboard!",
                              );
                            }}
                          >
                            <Ionicons
                              name="copy-outline"
                              size={16}
                              color={colors.buttonPrimaryText}
                            />
                            <Text
                              style={[styles.saveButtonText, { fontSize: 12 }]}
                            >
                              Copy Setup URI
                            </Text>
                          </TouchableOpacity>

                          <TextInput
                            style={[styles.input, { marginTop: 12 }]}
                            placeholder="Enter 6-digit code"
                            placeholderTextColor={colors.textMuted}
                            keyboardType="number-pad"
                            maxLength={6}
                            value={twoFactorCode}
                            onChangeText={(value) =>
                              setTwoFactorCode(
                                value.replace(/\D/g, "").slice(0, 6),
                              )
                            }
                          />
                          <TouchableOpacity
                            style={styles.verifyButton}
                            onPress={handleVerify2FA}
                            disabled={verifying2FA}
                          >
                            {verifying2FA ? (
                              <ActivityIndicator
                                color={colors.buttonPrimaryText}
                              />
                            ) : (
                              <Text style={styles.saveButtonText}>
                                Verify & Enable 2FA
                              </Text>
                            )}
                          </TouchableOpacity>
                        </View>
                      )}

                      {twoFactor && recoveryCodes && (
                        <View style={styles.totpSetupContainer}>
                          <Text style={styles.totpInstructions}>
                            Save these recovery codes in a secure location. Each
                            code can only be used once. They will not be shown
                            again after leaving this screen.
                          </Text>
                          <Text style={styles.totpUriText} selectable>
                            {recoveryCodes.join("\n")}
                          </Text>

                          <TouchableOpacity
                            style={[styles.verifyButton, { marginTop: 10 }]}
                            onPress={() => setRecoveryCodes(null)}
                          >
                            <Text style={styles.saveButtonText}>
                              I Have Saved These Codes
                            </Text>
                          </TouchableOpacity>
                        </View>
                      )}

                      {twoFactor && (
                        <View style={styles.totpSetupContainer}>
                          <Text style={styles.totpInstructions}>
                            To disable 2FA, confirm your current password and
                            provide either an authenticator code or an unused
                            recovery code.
                          </Text>

                          <TextInput
                            style={styles.input}
                            placeholder="Current password"
                            placeholderTextColor={colors.textMuted}
                            secureTextEntry
                            value={twoFactorDisablePassword}
                            onChangeText={setTwoFactorDisablePassword}
                          />

                          <View style={styles.rowBetween}>
                            <TouchableOpacity
                              style={[
                                styles.verifyButton,
                                twoFactorDisableMode === "totp" && {
                                  opacity: 0.8,
                                },
                              ]}
                              onPress={() => {
                                setTwoFactorDisableMode("totp");
                                setTwoFactorDisableCode("");
                              }}
                            >
                              <Text style={styles.saveButtonText}>
                                Authenticator{" "}
                                {twoFactorDisableMode === "totp" ? "✓" : ""}
                              </Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[
                                styles.verifyButton,
                                twoFactorDisableMode === "recovery" && {
                                  opacity: 0.8,
                                },
                              ]}
                              onPress={() => {
                                setTwoFactorDisableMode("recovery");
                                setTwoFactorDisableCode("");
                              }}
                            >
                              <Text style={styles.saveButtonText}>
                                Recovery Code{" "}
                                {twoFactorDisableMode === "recovery" ? "✓" : ""}
                              </Text>
                            </TouchableOpacity>
                          </View>

                          <TextInput
                            style={styles.input}
                            placeholder={
                              twoFactorDisableMode === "totp"
                                ? "6-digit authenticator code"
                                : "32-character recovery code"
                            }
                            placeholderTextColor={colors.textMuted}
                            keyboardType={
                              twoFactorDisableMode === "totp"
                                ? "number-pad"
                                : "default"
                            }
                            autoCapitalize="characters"
                            maxLength={twoFactorDisableMode === "totp" ? 6 : 32}
                            value={twoFactorDisableCode}
                            onChangeText={(value) =>
                              setTwoFactorDisableCode(
                                twoFactorDisableMode === "totp"
                                  ? value.replace(/\D/g, "").slice(0, 6)
                                  : value
                                      .replace(/[^a-fA-F0-9]/g, "")
                                      .toUpperCase()
                                      .slice(0, 32),
                              )
                            }
                          />

                          <TouchableOpacity
                            style={[
                              styles.verifyButton,
                              (!twoFactorDisablePassword ||
                                !twoFactorDisableCode ||
                                disabling2FA) && { opacity: 0.6 },
                            ]}
                            onPress={handleDisable2FA}
                            disabled={
                              !twoFactorDisablePassword ||
                              !twoFactorDisableCode ||
                              disabling2FA
                            }
                          >
                            {disabling2FA ? (
                              <ActivityIndicator
                                color={colors.buttonPrimaryText}
                              />
                            ) : (
                              <Text style={styles.saveButtonText}>
                                Disable 2FA
                              </Text>
                            )}
                          </TouchableOpacity>
                        </View>
                      )}

                      <Text style={[styles.sectionSubtitle, { marginTop: 15 }]}>
                        Device Biometrics ({biometric.type.toUpperCase()})
                      </Text>
                      <View style={styles.rowBetween}>
                        <Text style={styles.label}>
                          Use {biometric.type} for Login
                        </Text>
                        <Switch
                          disabled={!biometric.available || !biometric.enrolled}
                          value={biometric.enabled}
                          onValueChange={handleToggleBiometric}
                        />
                      </View>

                      <Text style={[styles.sectionSubtitle, { marginTop: 15 }]}>
                        App Protection
                      </Text>
                      <View style={styles.rowBetween}>
                        <Text style={styles.label}>
                          Require App Lock on Startup
                        </Text>
                        <Switch
                          value={appLockEnabled}
                          onValueChange={handleToggleAppLock}
                        />
                      </View>

                      {!biometric.enrolled && (
                        <Text style={styles.warningText}>
                          Biometrics not enrolled on device settings.
                        </Text>
                      )}

                      <TouchableOpacity
                        style={[styles.saveButton, { marginTop: 20 }]}
                        onPress={handleSaveSecurity}
                        disabled={savingSecurity}
                      >
                        {savingSecurity ? (
                          <ActivityIndicator color={colors.buttonPrimaryText} />
                        ) : (
                          <Text style={styles.saveButtonText}>
                            Save Security Changes
                          </Text>
                        )}
                      </TouchableOpacity>

                      <Text style={[styles.sectionSubtitle, { marginTop: 20 }]}>
                        Active Login Sessions
                      </Text>
                      {loadingSessions ? (
                        <ActivityIndicator color={colors.primary} />
                      ) : loginSessions.length === 0 ? (
                        <Text style={styles.emptySessionText}>
                          No active sessions found.
                        </Text>
                      ) : (
                        loginSessions.slice(0, 3).map((session) => (
                          <View key={session.id} style={styles.sessionRow}>
                            <View>
                              <Text style={styles.sessionDevice}>
                                {session.device || "Unknown Device"} (
                                {session.browser || "Browser"})
                              </Text>
                              <Text style={styles.sessionMeta}>
                                {session.location || "Unknown Location"} ·{" "}
                                {session.lastActive || "Recently"}
                              </Text>
                            </View>
                            {!session.current && (
                              <TouchableOpacity
                                onPress={() => revokeSession(session.id)}
                              >
                                <Text style={styles.revokeText}>Revoke</Text>
                              </TouchableOpacity>
                            )}
                          </View>
                        ))
                      )}
                    </View>
                  )}

                  {/* Activity History & Audit Logs */}
                  <SettingRow
                    colors={colors}
                    styles={styles}
                    icon="time-outline"
                    title="Activity History"
                    subtitle="Review document uploads, edits, views, and security events"
                    isActive={activeTab === "activity"}
                    onPress={() =>
                      setActiveTab(
                        activeTab === "activity" ? "none" : "activity",
                      )
                    }
                  />
                  {activeTab === "activity" && (
                    <View style={styles.expandedSection}>
                      <Text style={styles.sectionSubtitle}>
                        Vault Security & Activity Log
                      </Text>
                      <Text
                        style={[styles.settingSubtitle, { marginBottom: 12 }]}
                      >
                        Full immutable record of document accesses,
                        modifications, and deletions for transparency.
                      </Text>

                      <TouchableOpacity
                        style={styles.saveButton}
                        onPress={() =>
                          router.push("/document-activity-history" as any)
                        }
                      >
                        <Ionicons
                          name="list-outline"
                          size={18}
                          color={colors.buttonPrimaryText}
                          style={{ marginRight: 6 }}
                        />
                        <Text style={styles.saveButtonText}>
                          Open Full Activity Log Screen
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {/* Notifications */}
                  <SettingRow
                    colors={colors}
                    styles={styles}
                    icon="notifications-outline"
                    title="Notifications"
                    subtitle="Manage push alerts, email digests, and lead times"
                    isActive={activeTab === "notifications"}
                    onPress={() =>
                      setActiveTab(
                        activeTab === "notifications"
                          ? "none"
                          : "notifications",
                      )
                    }
                  />
                  {activeTab === "notifications" && (
                    <View style={styles.expandedSection}>
                      <View style={styles.rowBetween}>
                        <Text style={styles.label}>Email Alerts</Text>
                        <Switch
                          value={notifyEmail}
                          onValueChange={(value) =>
                            handleNotificationPreferenceChange(
                              "notifyEmail",
                              value,
                            )
                          }
                        />
                      </View>
                      <View style={styles.rowBetween}>
                        <Text style={styles.label}>Push Notifications</Text>
                        <Switch
                          value={notifyPush}
                          onValueChange={(value) =>
                            handleNotificationPreferenceChange(
                              "notifyPush",
                              value,
                            )
                          }
                        />
                      </View>
                      <View style={styles.rowBetween}>
                        <Text style={styles.label}>
                          Document Expiry Reminders
                        </Text>
                        <Switch
                          value={notifyExpiry}
                          onValueChange={(value) =>
                            handleNotificationPreferenceChange(
                              "notifyExpiry",
                              value,
                            )
                          }
                        />
                      </View>
                      <Text style={styles.inputLabel}>
                        Alert Lead Time (Days Before Expiry)
                      </Text>
                      <TextInput
                        style={styles.input}
                        placeholder="30"
                        placeholderTextColor={colors.textMuted}
                        keyboardType="numeric"
                        value={expiryLeadDays}
                        onChangeText={setExpiryLeadDays}
                        onEndEditing={() => {
                          void handleExpiryLeadDaysSave();
                        }}
                      />
                    </View>
                  )}

                  {/* Document Preferences */}
                  <SettingRow
                    colors={colors}
                    styles={styles}
                    icon="document-text-outline"
                    title="Document Preferences"
                    subtitle="Auto-scan settings, sorting preferences, defaults"
                    isActive={activeTab === "documents"}
                    onPress={() =>
                      setActiveTab(
                        activeTab === "documents" ? "none" : "documents",
                      )
                    }
                  />
                  {activeTab === "documents" && (
                    <View style={styles.expandedSection}>
                      <View style={styles.rowBetween}>
                        <Text style={styles.label}>
                          Auto-Scan Document Edges
                        </Text>
                        <Switch
                          value={docPreferences.autoScan}
                          onValueChange={(val) =>
                            setDocPreferences({
                              ...docPreferences,
                              autoScan: val,
                            })
                          }
                        />
                      </View>
                      <View style={styles.rowBetween}>
                        <Text style={styles.label}>
                          AI Auto-Categorize Documents
                        </Text>
                        <Switch
                          value={docPreferences.autoCategorize}
                          onValueChange={(val) =>
                            setDocPreferences({
                              ...docPreferences,
                              autoCategorize: val,
                            })
                          }
                        />
                      </View>
                      <Text style={styles.inputLabel}>
                        Default Expiry Buffer (Days)
                      </Text>
                      <TextInput
                        style={styles.input}
                        placeholder="30"
                        placeholderTextColor={colors.textMuted}
                        keyboardType="number-pad"
                        value={String(docPreferences.expiryReminderDays)}
                        onChangeText={(val) =>
                          setDocPreferences({
                            ...docPreferences,
                            expiryReminderDays: val === "" ? 30 : Number(val),
                          })
                        }
                      />
                    </View>
                  )}

                  {/* Appearance */}
                  <SettingRow
                    colors={colors}
                    styles={styles}
                    icon="color-palette-outline"
                    title="Appearance"
                    subtitle={`Theme selection (${themeMode === "system" ? "System" : themeMode === "light" ? "Light" : "Dark"})`}
                    isActive={activeTab === "appearance"}
                    onPress={() =>
                      setActiveTab(
                        activeTab === "appearance" ? "none" : "appearance",
                      )
                    }
                  />

                  {activeTab === "appearance" && (
                    <View style={styles.expandedSection}>
                      <Text style={styles.inputLabel}>Theme Selector</Text>

                      <View style={styles.selectorRow}>
                        {(["system", "light", "dark"] as ThemeMode[]).map(
                          (themeOption) => {
                            const selected = themeMode === themeOption;

                            return (
                              <TouchableOpacity
                                key={themeOption}
                                accessibilityRole="button"
                                accessibilityState={{ selected }}
                                style={[
                                  styles.selectorChip,
                                  selected && styles.selectorChipActive,
                                ]}
                                onPress={async () => {
                                  try {
                                    await setThemeMode(themeOption);

                                    feedbackService.success(
                                      `Theme updated to ${themeOption.toUpperCase()}`,
                                    );
                                  } catch {
                                    feedbackService.error(
                                      "Unable to update theme. Please try again.",
                                    );
                                  }
                                }}
                              >
                                <Text
                                  style={[
                                    styles.selectorChipText,
                                    selected && styles.selectorChipTextActive,
                                  ]}
                                >
                                  {themeOption.toUpperCase()}
                                </Text>
                              </TouchableOpacity>
                            );
                          },
                        )}
                      </View>
                    </View>
                  )}

                  {/* Backup & Restore */}
                  <SettingRow
                    colors={colors}
                    styles={styles}
                    icon="shield-checkmark-outline"
                    title="Backup & Restore"
                    subtitle="Export or restore your document and reminder records"
                    isActive={activeTab === "backup"}
                    onPress={() =>
                      setActiveTab(activeTab === "backup" ? "none" : "backup")
                    }
                  />
                  {activeTab === "backup" && (
                    <View style={styles.expandedSection}>
                      <Text style={styles.sectionSubtitle}>
                        Create a portable backup of your document and reminder
                        metadata, or restore records from a previously exported
                        DocuGuard backup.
                      </Text>
                      <Text
                        style={{
                          fontSize: 11,
                          color: colors.textSecondary,
                          marginTop: 4,
                        }}
                      >
                        Document files and attachments are not included.
                        Restored records remain local and are not automatically
                        uploaded to the cloud.
                      </Text>
                      <TouchableOpacity
                        style={[styles.saveButton, { marginTop: 16, flexDirection: "row", gap: 8 }]}
                        onPress={() => void exportLocalBackup()}
                        accessibilityRole="button"
                        accessibilityLabel="Export local backup"
                      >
                        <Ionicons
                          name="download-outline"
                          size={18}
                          color={colors.buttonPrimaryText}
                        />
                        <Text style={styles.saveButtonText}>Export Backup</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.saveButton, { marginTop: 10, flexDirection: "row", gap: 8 }]}
                        onPress={() => void importLocalBackup()}
                        accessibilityRole="button"
                        accessibilityLabel="Import local backup"
                      >
                        <Ionicons
                          name="cloud-download-outline"
                          size={18}
                          color={colors.buttonPrimaryText}
                        />
                        <Text style={styles.saveButtonText}>Import Backup</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {/* Subscription & Plan */}
                  <SettingRow
                    colors={colors}
                    styles={styles}
                    icon="card-outline"
                    title="Subscription & Plan"
                    subtitle="Manage billing status and storage upgrades"
                    isActive={activeTab === "subscription"}
                    onPress={() =>
                      setActiveTab(
                        activeTab === "subscription" ? "none" : "subscription",
                      )
                    }
                  />
                  {activeTab === "subscription" && (
                    <View style={styles.expandedSection}>
                      <SubscriptionView
                        planName={user?.subscription.planName || "Free"}
                        renewalDate={user?.subscription.renewalDate || "N/A"}
                        storageUsed={user?.subscription.storageUsed || 0}
                        storageTotal={user?.subscription.storageTotal || 50}
                      />
                    </View>
                  )}

                  {/* Help & Support Ticket */}
                  <SettingRow
                    colors={colors}
                    styles={styles}
                    icon="help-buoy-outline"
                    title="Help & Support"
                    subtitle="Submit a support ticket and our team will follow up"
                    isActive={activeTab === "support"}
                    onPress={() =>
                      setActiveTab(activeTab === "support" ? "none" : "support")
                    }
                  />
                  {activeTab === "support" && (
                    <View style={styles.expandedSection}>
                      <Text style={styles.sectionSubtitle}>
                        Need help? Send us a message and our team will follow
                        up.
                      </Text>

                      {/* --- 1. Issue Category Selector --- */}
                      <Text style={styles.inputLabel}>Issue Category</Text>
                      <TouchableOpacity
                        style={styles.dropdownSelectorButton}
                        onPress={() => setCategoryModalVisible(true)}
                      >
                        <Text style={styles.dropdownSelectorText}>
                          {ticketCategory}
                        </Text>
                        <Ionicons
                          name="chevron-down"
                          size={18}
                          color={colors.textSecondary}
                        />
                      </TouchableOpacity>

                      <Text style={styles.inputLabel}>Subject (Optional)</Text>
                      <TextInput
                        style={styles.input}
                        placeholder="Brief title of your issue..."
                        placeholderTextColor={colors.textSecondary}
                        value={ticketSubject}
                        onChangeText={setTicketSubject}
                        editable={!submittingTicket}
                        maxLength={255}
                      />

                      <Text style={styles.inputLabel}>Message</Text>
                      <TextInput
                        style={[styles.input, styles.ticketMessageInput]}
                        placeholder="Describe your issue or request in detail..."
                        placeholderTextColor={colors.textSecondary}
                        value={ticketMessage}
                        onChangeText={setTicketMessage}
                        editable={!submittingTicket}
                        multiline
                        textAlignVertical="top"
                        maxLength={5000}
                      />

                      {/* --- 2. Screenshot Attachment Button & Preview --- */}
                      <View style={{ marginVertical: 8 }}>
                        {ticketAttachment ? (
                          <View
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                              gap: 10,
                            }}
                          >
                            <Text
                              style={[
                                styles.label,
                                {
                                  fontSize: 13,
                                  color: colors.primary,
                                  flex: 1,
                                },
                              ]}
                            >
                              ✓ Screenshot attached
                            </Text>
                            <TouchableOpacity
                              onPress={() => setTicketAttachment(null)}
                            >
                              <Ionicons
                                name="close-circle"
                                size={20}
                                color={colors.error}
                              />
                            </TouchableOpacity>
                          </View>
                        ) : (
                          <TouchableOpacity
                            style={[
                              styles.dropdownSelectorButton,
                              { marginBottom: 0 },
                            ]}
                            onPress={handlePickImage}
                          >
                            <View
                              style={{
                                flexDirection: "row",
                                alignItems: "center",
                                gap: 8,
                              }}
                            >
                              <Ionicons
                                name="camera-outline"
                                size={18}
                                color={colors.primary}
                              />
                              <Text
                                style={[
                                  styles.dropdownSelectorText,
                                  { color: colors.primary },
                                ]}
                              >
                                Attach Screenshot (Optional)
                              </Text>
                            </View>
                          </TouchableOpacity>
                        )}
                      </View>

                      <TouchableOpacity
                        style={[
                          styles.actionButton,
                          styles.supportTicketButton,
                          { marginTop: 12 },
                          (submittingTicket || !ticketMessage.trim()) && {
                            opacity: 0.6,
                          },
                        ]}
                        onPress={handleSubmitSupportTicket}
                        disabled={submittingTicket || !ticketMessage.trim()}
                        activeOpacity={0.85}
                      >
                        {submittingTicket ? (
                          <ActivityIndicator
                            size="small"
                            color={colors.primary}
                          />
                        ) : (
                          <Ionicons
                            name="help-buoy-outline"
                            size={18}
                            color={colors.primary}
                          />
                        )}
                        <Text
                          style={[
                            styles.actionButtonText,
                            styles.supportTicketText,
                          ]}
                        >
                          {submittingTicket
                            ? "Submitting..."
                            : "Submit Support Ticket"}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {/* Sign Out Row */}
                  <SettingRow
                    colors={colors}
                    styles={styles}
                    icon="log-out-outline"
                    title="Sign Out"
                    subtitle="Log out safely from your account session"
                    isActive={false}
                    onPress={handleSignOut}
                    isDestructive={false}
                  />

                  {/* Delete Account Row */}
                  <SettingRow
                    colors={colors}
                    styles={styles}
                    icon="trash-outline"
                    title="Delete Account"
                    subtitle="Permanently erase your vault and data records"
                    isActive={false}
                    onPress={() => {
                      setCountdown(10);
                      setDeleteStep(1);
                      setDeletePassword("");
                      setDeleteModalVisible(true);
                    }}
                    isDestructive={true}
                  />
                </View>
              </>
            )}
          </ScrollView>
        </RefreshableContainer>
      </KeyboardAvoidingView>

      {/* --- Searchable Dropdown Modal for Occupation --- */}
      <Modal
        visible={dropdownVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setDropdownVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContainer, { height: "70%" }]}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>Select What You Do</Text>
              <TouchableOpacity onPress={() => setDropdownVisible(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            {/* Search Bar inside Modal */}
            <View style={styles.modalSearchContainer}>
              <Ionicons
                name="search"
                size={18}
                color={colors.textSecondary}
                style={{ marginRight: 8 }}
              />
              <TextInput
                style={styles.modalSearchInput}
                placeholder="Search occupation..."
                placeholderTextColor={colors.textMuted}
                value={searchQuery}
                onChangeText={setSearchQuery}
                clearButtonMode="while-editing"
              />
            </View>

            {/* List of Occupations */}
            <FlatList
              data={filteredOccupations}
              keyExtractor={(item) => item}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.dropdownItemRow}
                  onPress={() => {
                    if (item === "Others") {
                      setIsCustomOccupation(true);
                      setPersonalInfo({ ...personalInfo, occupation: "" });
                    } else {
                      setIsCustomOccupation(false);
                      setPersonalInfo({ ...personalInfo, occupation: item });
                    }
                    setSearchQuery("");
                    setDropdownVisible(false);
                  }}
                >
                  <Text
                    style={[
                      styles.dropdownItemText,
                      personalInfo.occupation === item && {
                        color: colors.primary,
                        fontWeight: "700",
                      },
                    ]}
                  >
                    {item}
                  </Text>
                  {personalInfo.occupation === item && (
                    <Ionicons
                      name="checkmark"
                      size={18}
                      color={colors.primary}
                    />
                  )}
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <Text style={styles.emptySessionText}>
                  No occupations found. Choose "Others" to input manually.
                </Text>
              }
            />
          </View>
        </View>
      </Modal>

      <Modal
        visible={categoryModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setCategoryModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContainer, { height: "50%" }]}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>Select Issue Category</Text>
              <TouchableOpacity onPress={() => setCategoryModalVisible(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            <FlatList
              data={SUPPORT_CATEGORIES}
              keyExtractor={(item) => item}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.dropdownItemRow}
                  onPress={() => {
                    setTicketCategory(item);
                    setCategoryModalVisible(false);
                  }}
                >
                  <Text
                    style={[
                      styles.dropdownItemText,
                      ticketCategory === item && {
                        color: colors.primary,
                        fontWeight: "700",
                      },
                    ]}
                  >
                    {item}
                  </Text>
                  {ticketCategory === item && (
                    <Ionicons
                      name="checkmark"
                      size={18}
                      color={colors.primary}
                    />
                  )}
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>

      {/* Account Deletion Modal (2 Layers) */}
      <Modal
        visible={deleteModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setDeleteModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>
              {deleteStep === 1
                ? "âš ï¸ Permanent Account Deletion"
                : "ðŸ”’ Verify Your Password"}
            </Text>

            {deleteStep === 1 ? (
              <>
                <Text style={styles.modalBody}>
                  This action is irreversible. All of your scanned documents,
                  personal vaults, and reminders will be permanently purged from
                  the servers.
                </Text>
                <Text style={styles.countdownText}>
                  {countdown > 0
                    ? `Please wait (${countdown}s) before confirming...`
                    : "You can now proceed."}
                </Text>
                <View style={styles.modalButtonRow}>
                  <TouchableOpacity
                    style={[styles.modalBtn, styles.cancelBtn]}
                    onPress={() => setDeleteModalVisible(false)}
                  >
                    <Text style={styles.cancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.modalBtn,
                      styles.dangerBtn,
                      countdown > 0 && { opacity: 0.5 },
                    ]}
                    disabled={countdown > 0}
                    onPress={() => setDeleteStep(2)}
                  >
                    <Text style={styles.dangerBtnText}>I Understand</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                <Text style={styles.modalBody}>
                  Enter your current account password to authorize final
                  deletion:
                </Text>
                <TextInput
                  style={styles.input}
                  placeholder="Account Password"
                  placeholderTextColor={colors.textMuted}
                  secureTextEntry
                  value={deletePassword}
                  onChangeText={setDeletePassword}
                />
                <View style={styles.modalButtonRow}>
                  <TouchableOpacity
                    style={[styles.modalBtn, styles.cancelBtn]}
                    onPress={() => setDeleteModalVisible(false)}
                  >
                    <Text style={styles.cancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalBtn, styles.dangerBtn]}
                    onPress={handleConfirmAccountDeletion}
                    disabled={deletingAccount}
                  >
                    {deletingAccount ? (
                      <ActivityIndicator color={colors.buttonPrimaryText} />
                    ) : (
                      <Text style={styles.dangerBtnText}>
                        Delete Permanently
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const createStyles = (COLORS: ColorScheme) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: COLORS.background },
    scrollContent: { padding: 16 },
    headerContainer: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 20,
    },
    uniqueAvatarContainer: {
      width: 60,
      height: 60,
      borderRadius: 30,
      backgroundColor: COLORS.primary,
      justifyContent: "center",
      alignItems: "center",
      overflow: "hidden",
    },
    abstractShape: { position: "absolute" },
    shape1: {
      width: 30,
      height: 30,
      borderRadius: 15,
      backgroundColor: "rgba(255,255,255,0.2)",
      top: -5,
      left: -5,
    },
    shape2: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: "rgba(255,255,255,0.1)",
      bottom: -10,
      right: -10,
    },
    shape3: {
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: "rgba(255,255,255,0.15)",
      top: 15,
      right: 10,
    },
    avatarInitials: {
      color: COLORS.buttonPrimaryText,
      fontSize: 20,
      fontWeight: "bold",
    },
    headerTextContainer: { marginLeft: 15, flex: 1 },
    userName: { fontSize: 18, fontWeight: "bold", color: COLORS.text },
    userEmail: { fontSize: 14, color: COLORS.textSecondary, marginBottom: 4 },
    badgeContainer: { flexDirection: "row", gap: 10 },
    badgeText: { fontSize: 12, color: COLORS.primary, fontWeight: "600" },
    serialText: { fontSize: 12, color: COLORS.textSecondary },
    storageCard: { marginBottom: 20, padding: 16 },
    storageHeader: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 8,
    },
    occupationBadge: {
      flexDirection: "row",
      alignItems: "center",
      alignSelf: "flex-start",
      backgroundColor: COLORS.surface,
      borderWidth: 1,
      borderColor: COLORS.primary,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 6,
      marginBottom: 6,
      marginTop: 2,
    },
    occupationText: {
      fontSize: 12,
      fontWeight: "600",
      color: COLORS.primary,
    },
    storageTitle: {
      fontSize: 16,
      fontWeight: "600",
      marginLeft: 8,
      color: COLORS.text,
    },
    storageDetails: {
      fontSize: 14,
      color: COLORS.textSecondary,
      marginBottom: 8,
    },
    progressBarBackground: {
      height: 8,
      backgroundColor: COLORS.border,
      borderRadius: 4,
      overflow: "hidden",
    },
    progressBarFill: { height: "100%", backgroundColor: COLORS.primary },
    sectionsContainer: { gap: 10 },
    settingRow: {
      flexDirection: "row",
      alignItems: "center",
      padding: 16,
      backgroundColor: COLORS.surface,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: COLORS.border,
    },
    activeSettingRow: { borderColor: COLORS.primary },
    settingInfo: { flex: 1, marginLeft: 12, marginRight: 12 },
    settingTitle: { fontSize: 16, fontWeight: "500", color: COLORS.text },
    settingSubtitle: {
      fontSize: 13,
      color: COLORS.textSecondary,
      marginTop: 2,
    },
    expandedSection: {
      padding: 16,
      backgroundColor: COLORS.surface,
      borderRadius: 12,
      marginTop: -6,
      marginBottom: 10,
      borderWidth: 1,
      borderColor: COLORS.border,
    },
    inputLabel: {
      fontSize: 14,
      fontWeight: "500",
      color: COLORS.text,
      marginBottom: 6,
      marginTop: 10,
    },
    input: {
      borderWidth: 1,
      borderColor: COLORS.border,
      borderRadius: 8,
      padding: 12,
      fontSize: 14,
      color: COLORS.text,
      backgroundColor: COLORS.background,
      marginBottom: 12,
    },
    dropdownSelectorButton: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      borderWidth: 1,
      borderColor: COLORS.border,
      borderRadius: 8,
      padding: 12,
      backgroundColor: COLORS.background,
      marginBottom: 12,
    },
    dropdownSelectorText: {
      fontSize: 14,
      color: COLORS.text,
    },
    modalHeaderRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 12,
    },
    modalSearchContainer: {
      flexDirection: "row",
      alignItems: "center",
      borderWidth: 1,
      borderColor: COLORS.border,
      borderRadius: 8,
      paddingHorizontal: 10,
      backgroundColor: COLORS.background,
      marginBottom: 12,
    },
    modalSearchInput: {
      flex: 1,
      paddingVertical: 10,
      fontSize: 14,
      color: COLORS.text,
    },
    dropdownItemRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: COLORS.border,
    },
    dropdownItemText: {
      fontSize: 14,
      color: COLORS.text,
    },
    saveButton: {
      backgroundColor: COLORS.primary,
      padding: 12,
      borderRadius: 8,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 10,
    },
    saveButtonText: {
      color: COLORS.buttonPrimaryText,
      fontSize: 14,
      fontWeight: "600",
    },
    sectionSubtitle: {
      fontSize: 15,
      fontWeight: "600",
      color: COLORS.text,
      marginBottom: 8,
    },
    rowBetween: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginVertical: 8,
    },
    label: { fontSize: 14, color: COLORS.text },
    totpSetupContainer: {
      marginTop: 10,
      padding: 12,
      backgroundColor: COLORS.background,
      borderRadius: 8,
    },
    totpInstructions: {
      fontSize: 13,
      color: COLORS.textSecondary,
      marginBottom: 6,
    },
    totpUriText: { fontSize: 12, color: COLORS.primary, marginBottom: 10 },
    verifyButton: {
      backgroundColor: COLORS.primary,
      padding: 10,
      borderRadius: 6,
      alignItems: "center",
    },
    warningText: { fontSize: 12, color: COLORS.error, marginTop: 4 },
    sessionRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: COLORS.border,
    },
    sessionDevice: { fontSize: 14, fontWeight: "500", color: COLORS.text },
    sessionMeta: { fontSize: 12, color: COLORS.textSecondary },
    emptySessionText: {
      fontSize: 13,
      color: COLORS.textSecondary,
      fontStyle: "italic",
      marginVertical: 6,
      textAlign: "center",
      marginTop: 20,
    },
    revokeText: { fontSize: 13, color: COLORS.error, fontWeight: "600" },
    selectorRow: { flexDirection: "row", gap: 10, marginTop: 6 },
    selectorChip: {
      flex: 1,
      paddingVertical: 10,
      borderWidth: 1,
      borderColor: COLORS.border,
      borderRadius: 8,
      alignItems: "center",
    },
    selectorChipActive: {
      backgroundColor: COLORS.primary,
      borderColor: COLORS.primary,
    },
    selectorChipText: { fontSize: 12, fontWeight: "600", color: COLORS.text },
    selectorChipTextActive: { color: COLORS.buttonPrimaryText },
    modalOverlay: {
      flex: 1,
      backgroundColor: COLORS.modalOverlay,
      justifyContent: "center",
      alignItems: "center",
      padding: 20,
    },
    modalContainer: {
      width: "100%",
      maxWidth: 380,
      backgroundColor: COLORS.surface,
      borderRadius: 16,
      padding: 20,
      borderWidth: 1,
      borderColor: COLORS.border,
    },
    modalTitle: {
      fontSize: 18,
      fontWeight: "700",
      color: COLORS.text,
      marginBottom: 10,
    },
    modalBody: {
      fontSize: 14,
      color: COLORS.textSecondary,
      lineHeight: 20,
      marginBottom: 15,
    },
    countdownText: {
      fontSize: 13,
      color: COLORS.error,
      fontWeight: "600",
      marginBottom: 15,
    },
    modalButtonRow: {
      flexDirection: "row",
      gap: 10,
      justifyContent: "flex-end",
    },
    modalBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8 },
    cancelBtn: { backgroundColor: COLORS.border },
    cancelBtnText: { color: COLORS.text, fontWeight: "600" },
    dangerBtn: { backgroundColor: COLORS.error },
    dangerBtnText: { color: COLORS.buttonPrimaryText, fontWeight: "600" },
    supportTicketButton: {
      backgroundColor: "transparent",
      borderWidth: 1,
      borderColor: COLORS.primary,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
    },
    supportTicketText: { color: COLORS.primary, fontWeight: "600" },
    ticketMessageInput: {
      minHeight: 100,
      marginTop: 10,
      textAlignVertical: "top",
    },
    actionButton: {
      backgroundColor: COLORS.buttonPrimary,
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: 10,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 12,
    },

    actionButtonText: {
      color: COLORS.buttonPrimaryText,
      fontSize: 14,
      fontWeight: "600",
    },
  });
