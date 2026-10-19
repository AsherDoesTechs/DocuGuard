import React, { useState, useEffect, useCallback } from "react";
import {
  View,
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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Card } from "../../components/ui";
import { SubscriptionView } from "../../components/ui/SubscriptionView";
import { COLORS } from "@/constants";
import { RefreshableContainer } from "@/components/ui/RefreshableContainer";
import * as SecureStore from "expo-secure-store";
import { api } from "../../services/api";
import {
  getUserProfile,
  getAllDocuments,
  clearLocalSession,
} from "../../services/localDatabase";
import * as LocalAuthentication from "expo-local-authentication";
import {
  feedbackService,
  useFeedbackService,
} from "../../services/feedbackService";
import { useTheme } from "@/context/ThemeContext";
import type { ThemeMode } from "@/constants/colors";

type SettingsTab =
  | "none"
  | "personal"
  | "security"
  | "notifications"
  | "documents"
  | "appearance"
  | "subscription"
  | "support"
  | "privacy";

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
  icon: IconName;
  title: string;
  subtitle: string;
  isActive: boolean;
  onPress: () => void;
  isDestructive?: boolean;
}

const SettingRow = ({
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
    <View style={[styles.settingRow, isActive && styles.activeSettingRow]}>
      <Ionicons
        name={icon}
        size={22}
        color={isDestructive ? COLORS.danger : COLORS.primary}
      />
      <View style={styles.settingInfo}>
        <Text
          style={[
            styles.settingTitle,
            isDestructive && { color: COLORS.danger },
          ]}
        >
          {title}
        </Text>
        <Text style={styles.settingSubtitle}>{subtitle}</Text>
      </View>
      <Ionicons
        name={isActive ? "chevron-down" : "chevron-forward"}
        size={20}
        color={isActive ? COLORS.primary : COLORS.border}
      />
    </View>
  </TouchableOpacity>
);

const { themeMode, setThemeMode, colors, isDark } = useTheme();

const UniqueAvatar = ({ name }: { name: string }) => {
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
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<SettingsTab>("none");
  const [, setLoading] = useState(true);
  const [user, setUser] = useState<UserProfile | null>(null);

  useFeedbackService();

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
  });
  const [savingPersonal, setSavingPersonal] = useState(false);
  const [maskPersonalData, setMaskPersonalData] = useState(true);

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
          notifyPush: localProfile.notifyPush ?? false,
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
        setPersonalInfo({
          name: localProfile.name || "",
          email: localProfile.email || "",
          phone: localProfile.phone || "",
        });
        setTwoFactor(localProfile.twoFactor ?? false);
        setNotifyEmail(localProfile.notifyEmail ?? true);
        setNotifyPush(localProfile.notifyPush ?? false);
        setNotifyExpiry(localProfile.notifyExpiry ?? true);
      }

      const token = await SecureStore.getItemAsync("userToken");
      if (token) {
        try {
          const res = await api.client.get("/profile");
          const subData = res.data.subscription || {};
          setUser((prev) => ({
            ...prev!,
            ...res.data,
            serialNumber:
              res.data.serialNumber || prev?.serialNumber || serialNumber,
            subscription: {
              planName:
                subData.planName || prev?.subscription?.planName || "Free",
              renewalDate: subData.renewalDate || "N/A",
              storageUsed: subData.storageUsed ?? localDocs.length * 0.5,
              storageTotal: subData.storageTotal ?? 50,
              serialNumber: res.data.serialNumber || serialNumber,
            },
          }));
          setPersonalInfo({
            name: res.data.name || "",
            email: res.data.email || "",
            phone: res.data.phone || "",
          });
          if (res.data.twoFactor !== undefined)
            setTwoFactor(res.data.twoFactor);
          if (res.data.documentPreferences)
            setDocPreferences(res.data.documentPreferences);
        } catch {
          // Fall back gracefully
        }
      }
    } catch (err: any) {
      console.error("Failed to load profile:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProfile();
    checkBiometrics();
  }, [fetchProfile, checkBiometrics]);

  useEffect(() => {
    if (user?.subscription?.storageUsed && user?.subscription?.storageTotal) {
      const percentage =
        (user.subscription.storageUsed / user.subscription.storageTotal) * 100;
      if (percentage >= 80) {
        feedbackService.showStorageWarning({
          used: user.subscription.storageUsed,
          total: user.subscription.storageTotal,
          action: "Consider upgrading your plan or removing old documents.",
        });
      }
    }
  }, [user?.subscription?.storageUsed, user?.subscription?.storageTotal]);

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
      await api.client.post(
        "/profile/security/2fa/verify",
        {
          code: twoFactorCode,
        },
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      setTwoFactor(true);
      setTwoFactorSetup(null);
      setTwoFactorCode("");
      feedbackService.success(
        "Two-factor authentication enabled successfully.",
      );
    } catch (error) {
      feedbackService.error(
        getApiErrorMessage(error, "Invalid verification code."),
      );
    } finally {
      setVerifying2FA(false);
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
      feedbackService.success(
        value ? "Biometrics enabled" : "Biometrics disabled",
      );
    } catch {
      feedbackService.error("Failed to update biometric preference");
    }
  };

  const handleToggleAppLock = async (value: boolean) => {
    if (value && (!biometric.available || !biometric.enrolled)) {
      feedbackService.alert({
        title: "Error",
        message:
          "App lock requires device biometrics or passcode to be configured.",
        type: "error",
      });
      return;
    }
    try {
      await SecureStore.setItemAsync(
        "docuguard.appLock.enabled",
        String(value),
      );
      setAppLockEnabled(value);
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
        twoFactor,
        biometricEnabled: biometric.enabled,
        appLockEnabled,
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
      await api.client.patch("/profile", personalInfo, {
        headers: { Authorization: `Bearer ${token}` },
      });
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
    if (!deletePassword) {
      feedbackService.error(
        "Please enter your account password to confirm deletion.",
      );
      return;
    }

    try {
      setDeletingAccount(true);
      const token = await SecureStore.getItemAsync("userToken");
      await api.client.post(
        "/profile/delete-account",
        { password: deletePassword },
        { headers: { Authorization: `Bearer ${token}` } },
      );

      await clearLocalSession();
      await SecureStore.deleteItemAsync("userToken");
      setDeleteModalVisible(false);
      feedbackService.success("Account permanently deleted.");
      router.replace("/(auth)/login" as any);
    } catch (err: any) {
      feedbackService.error(
        getApiErrorMessage(
          err,
          "Failed to delete account. Password may be incorrect.",
        ),
      );
    } finally {
      setDeletingAccount(false);
    }
  };

  const handleSignOut = () => {
    feedbackService.confirm({
      title: "Sign Out",
      message: "Are you sure you want to sign out of your account?",
      confirmText: "Sign Out",
      cancelText: "Cancel",
      destructive: true,
      onConfirm: async () => {
        try {
          await clearLocalSession();
          await SecureStore.deleteItemAsync("userToken");
          await SecureStore.deleteItemAsync("biometricEnabled");
          await SecureStore.deleteItemAsync("docuguard.appLock.enabled");
          router.replace("/(auth)/login" as any);
        } catch {
          feedbackService.error("Failed to sign out cleanly");
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
            {/* Header Profile Section */}
            <View style={styles.headerContainer}>
              <UniqueAvatar name={user?.name || "User"} />
              <View style={styles.headerTextContainer}>
                <Text style={styles.userName}>
                  {user?.name || "Loading..."}
                </Text>
                <Text style={styles.userEmail}>
                  {maskEmail(user?.email || "user@example.com")}
                </Text>
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
                  color={COLORS.primary}
                />
                <Text style={styles.storageTitle}>Vault Storage Usage</Text>
              </View>
              <Text style={styles.storageDetails}>
                {(user?.subscription.storageUsed || 0).toFixed(1)} MB /{" "}
                {user?.subscription.storageTotal || 50} MB (
                {user?.documentCount || 0} documents)
              </Text>
              <View style={styles.progressBarBackground}>
                <View
                  style={[
                    styles.progressBarFill,
                    {
                      width: `${Math.min(100, ((user?.subscription.storageUsed || 0) / (user?.subscription.storageTotal || 50)) * 100)}%`,
                    },
                  ]}
                />
              </View>
            </Card>

            {/* Settings Navigation Sections */}
            <View style={styles.sectionsContainer}>
              {/* Personal Information */}
              <SettingRow
                icon="person-outline"
                title="Personal Information"
                subtitle="Anti-theft masking, update name and contact details"
                isActive={activeTab === "personal"}
                onPress={() =>
                  setActiveTab(activeTab === "personal" ? "none" : "personal")
                }
              />
              {activeTab === "personal" && (
                <View style={styles.expandedSection}>
                  <View style={styles.rowBetween}>
                    <Text style={styles.label}>Mask Sensitive On Screen</Text>
                    <Switch
                      value={maskPersonalData}
                      onValueChange={setMaskPersonalData}
                    />
                  </View>
                  <Text style={styles.inputLabel}>Full Name</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Enter your full name"
                    placeholderTextColor="#9CA3AF"
                    value={personalInfo.name}
                    onChangeText={(text) =>
                      setPersonalInfo({ ...personalInfo, name: text })
                    }
                  />
                  <Text style={styles.inputLabel}>Email Address</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Enter your email address"
                    placeholderTextColor="#9CA3AF"
                    value={personalInfo.email}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    onChangeText={(text) =>
                      setPersonalInfo({ ...personalInfo, email: text })
                    }
                  />
                  <Text style={styles.inputLabel}>Phone Number (Optional)</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="+63 900 000 0000"
                    placeholderTextColor="#9CA3AF"
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
                      <ActivityIndicator color="#fff" />
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
                icon="shield-checkmark-outline"
                title="Security & Authentication"
                subtitle="Password, 2FA setup, biometrics and app lock"
                isActive={activeTab === "security"}
                onPress={() => {
                  setActiveTab(activeTab === "security" ? "none" : "security");
                  if (activeTab !== "security") fetchLoginSessions();
                }}
              />
              {activeTab === "security" && (
                <View style={styles.expandedSection}>
                  <Text style={styles.sectionSubtitle}>Change Password</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Current Password"
                    placeholderTextColor="#9CA3AF"
                    secureTextEntry
                    value={passwords.current}
                    onChangeText={(t) =>
                      setPasswords({ ...passwords, current: t })
                    }
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="New Password (min 12 chars)"
                    placeholderTextColor="#9CA3AF"
                    secureTextEntry
                    value={passwords.new}
                    onChangeText={(t) => setPasswords({ ...passwords, new: t })}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="Confirm New Password"
                    placeholderTextColor="#9CA3AF"
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
                    <Text style={styles.label}>Enable Authenticator App</Text>
                    <Switch
                      value={twoFactor}
                      onValueChange={(val) => {
                        setTwoFactor(val);
                        if (val && !twoFactorSetup) handleSetup2FA();
                      }}
                    />
                  </View>

                  {twoFactorSetup && !twoFactor && (
                    <View style={styles.totpSetupContainer}>
                      <Text style={styles.totpInstructions}>
                        Scan this URI key string in your Authenticator App:
                      </Text>
                      <Text style={styles.totpUriText} selectable>
                        {twoFactorSetup.otpauthUri}
                      </Text>
                      <TextInput
                        style={styles.input}
                        placeholder="Enter 6-digit code to verify"
                        placeholderTextColor="#9CA3AF"
                        keyboardType="number-pad"
                        maxLength={6}
                        value={twoFactorCode}
                        onChangeText={setTwoFactorCode}
                      />
                      <TouchableOpacity
                        style={styles.verifyButton}
                        onPress={handleVerify2FA}
                        disabled={verifying2FA}
                      >
                        {verifying2FA ? (
                          <ActivityIndicator color="#fff" />
                        ) : (
                          <Text style={styles.saveButtonText}>
                            Verify & Enable 2FA
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
                      disabled={!biometric.available || !biometric.enrolled}
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
                      <ActivityIndicator color="#fff" />
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
                    <ActivityIndicator color={COLORS.primary} />
                  ) : loginSessions.length === 0 ? (
                    <Text style={styles.emptySessionText}>
                      No active sessions found.
                    </Text>
                  ) : (
                    loginSessions.map((session) => (
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

              {/* Notifications */}
              <SettingRow
                icon="notifications-outline"
                title="Notifications"
                subtitle="Manage push alerts, email digests, and lead times"
                isActive={activeTab === "notifications"}
                onPress={() =>
                  setActiveTab(
                    activeTab === "notifications" ? "none" : "notifications",
                  )
                }
              />
              {activeTab === "notifications" && (
                <View style={styles.expandedSection}>
                  <View style={styles.rowBetween}>
                    <Text style={styles.label}>Email Alerts</Text>
                    <Switch
                      value={notifyEmail}
                      onValueChange={setNotifyEmail}
                    />
                  </View>
                  <View style={styles.rowBetween}>
                    <Text style={styles.label}>Push Notifications</Text>
                    <Switch value={notifyPush} onValueChange={setNotifyPush} />
                  </View>
                  <View style={styles.rowBetween}>
                    <Text style={styles.label}>Document Expiry Reminders</Text>
                    <Switch
                      value={notifyExpiry}
                      onValueChange={setNotifyExpiry}
                    />
                  </View>
                  <Text style={styles.inputLabel}>
                    Alert Lead Time (Days Before Expiry)
                  </Text>
                  <TextInput
                    style={styles.input}
                    placeholder="30"
                    placeholderTextColor="#9CA3AF"
                    keyboardType="numeric"
                    value={expiryLeadDays}
                    onChangeText={setExpiryLeadDays}
                  />
                </View>
              )}

              {/* Document Preferences */}
              <SettingRow
                icon="document-text-outline"
                title="Document Preferences"
                subtitle="Auto-scan settings, sorting preferences, defaults"
                isActive={activeTab === "documents"}
                onPress={() =>
                  setActiveTab(activeTab === "documents" ? "none" : "documents")
                }
              />
              {activeTab === "documents" && (
                <View style={styles.expandedSection}>
                  <View style={styles.rowBetween}>
                    <Text style={styles.label}>Auto-Scan Document Edges</Text>
                    <Switch
                      value={docPreferences.autoScan}
                      onValueChange={(val) =>
                        setDocPreferences({ ...docPreferences, autoScan: val })
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
                    placeholderTextColor="#9CA3AF"
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

              {/* Subscription & Plan */}
              <SettingRow
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

              {/* Sign Out Row */}
              <SettingRow
                icon="log-out-outline"
                title="Sign Out"
                subtitle="Log out safely from your account session"
                isActive={false}
                onPress={handleSignOut}
                isDestructive={false}
              />

              {/* Delete Account Row */}
              <SettingRow
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
          </ScrollView>
        </RefreshableContainer>
      </KeyboardAvoidingView>

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
                ? "⚠️ Permanent Account Deletion"
                : "🔒 Verify Your Password"}
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
                  placeholderTextColor="#9CA3AF"
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
                      <ActivityIndicator color="#fff" />
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

const styles = StyleSheet.create({
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
  avatarInitials: { color: "#fff", fontSize: 20, fontWeight: "bold" },
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
  settingSubtitle: { fontSize: 13, color: COLORS.textSecondary, marginTop: 2 },
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
  saveButton: {
    backgroundColor: COLORS.primary,
    padding: 12,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  saveButtonText: { color: "#fff", fontSize: 14, fontWeight: "600" },
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
    backgroundColor: COLORS.secondary || COLORS.primary,
    padding: 10,
    borderRadius: 6,
    alignItems: "center",
  },
  warningText: { fontSize: 12, color: COLORS.danger, marginTop: 4 },
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
  },
  revokeText: { fontSize: 13, color: COLORS.danger, fontWeight: "600" },
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
  selectorChipTextActive: { color: "#fff" },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
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
    color: COLORS.danger,
    fontWeight: "600",
    marginBottom: 15,
  },
  modalButtonRow: { flexDirection: "row", gap: 10, justifyContent: "flex-end" },
  modalBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8 },
  cancelBtn: { backgroundColor: COLORS.border },
  cancelBtnText: { color: COLORS.text, fontWeight: "600" },
  dangerBtn: { backgroundColor: COLORS.danger },
  dangerBtnText: { color: "#fff", fontWeight: "600" },
});
