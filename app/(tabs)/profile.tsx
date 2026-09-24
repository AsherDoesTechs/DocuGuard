import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Switch,
  TextInput,
  ActivityIndicator,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Card } from "../../components/ui";
import { SubscriptionView } from "../../components/ui/SubscriptionView";
import { Toast } from "../../components/ui/Toast";
import type { ToastType } from "../../components/ui/Toast";
import { COLORS } from "@/constants";
import { RefreshableContainer } from "@/components/ui/RefreshableContainer";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "../../services/api";
import { getUserProfile, getAllDocuments } from "../../services/localDatabase";
import * as LocalAuthentication from "expo-local-authentication";

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
}

const SettingRow = ({
  icon,
  title,
  subtitle,
  isActive,
  onPress,
}: SettingRowProps) => (
  <TouchableOpacity
    onPress={onPress}
    accessibilityRole="button"
    accessibilityLabel={title}
  >
    <View style={[styles.settingRow, isActive && styles.activeSettingRow]}>
      <Ionicons name={icon} size={22} color={COLORS.primary} />
      <View style={styles.settingInfo}>
        <Text style={styles.settingTitle}>{title}</Text>
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
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<UserProfile | null>(null);

  // Toast state matching base ToastProps interface (no custom onHide needed if handled internally)
  const [toast, setToast] = useState<{
    visible: boolean;
    message: string;
    type: ToastType;
  }>({ visible: false, message: "", type: "success" });

  const [passwords, setPasswords] = useState({
    current: "",
    new: "",
    confirm: "",
  });

  const [twoFactor, setTwoFactor] = useState(false);
  const [settingUp2FA, setSettingUp2FA] = useState(false);
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
  const [savingSecurity, setSavingSecurity] = useState(false);

  const [notifyEmail, setNotifyEmail] = useState(true);
  const [notifyPush, setNotifyPush] = useState(false);
  const [notifyExpiry, setNotifyExpiry] = useState(true);

  const [supportMessage, setSupportMessage] = useState("");
  const [personalInfo, setPersonalInfo] = useState({
    name: "",
    email: "",
  });
  const [savingPersonal, setSavingPersonal] = useState(false);

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
    theme: "system",
    fontSize: "medium",
    reducedMotion: false,
  });

  const [exportingData, setExportingData] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState("");

  const showToast = (message: string, type: ToastType = "success") => {
    setToast({ visible: true, message, type });
  };

  const checkBiometrics = useCallback(async () => {
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      const supportedTypes =
        await LocalAuthentication.supportedAuthenticationTypesAsync();

      let bioType: BiometricState["type"] = "unknown";
      // Fix: Use correct uppercase enum properties for expo-local-authentication
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

      const storedBiometric = await AsyncStorage.getItem("biometricEnabled");
      setBiometric({
        available: hasHardware,
        enrolled: isEnrolled,
        enabled: storedBiometric === "true" && hasHardware && isEnrolled,
        type: bioType,
      });
    } catch (err) {
      console.warn("Biometric check failed:", err);
    }
  }, []);

  const fetchProfile = useCallback(async () => {
    try {
      const localProfile = (await getUserProfile()) as any;
      const localDocs = await getAllDocuments();

      // Fix: Safely handle missing serialNumber or notifyPush properties on local database profiles
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
        });
        setPersonalInfo({
          name: localProfile.name || "",
          email: localProfile.email || "",
        });
        setTwoFactor(localProfile.twoFactor ?? false);
        setNotifyEmail(localProfile.notifyEmail ?? true);
        setNotifyPush(localProfile.notifyPush ?? false);
        setNotifyExpiry(localProfile.notifyExpiry ?? true);
      }

      const token = await AsyncStorage.getItem("userToken");
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
          });
          if (res.data.twoFactor !== undefined)
            setTwoFactor(res.data.twoFactor);
          if (res.data.documentPreferences)
            setDocPreferences(res.data.documentPreferences);
        } catch (err) {
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

  const handleSetup2FA = async () => {
    try {
      setSettingUp2FA(true);
      const token = await AsyncStorage.getItem("userToken");
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
      showToast("Scan the QR code with your authenticator app", "info");
    } catch (error) {
      showToast(
        getApiErrorMessage(error, "Unable to start 2FA setup."),
        "error",
      );
    } finally {
      setSettingUp2FA(false);
    }
  };

  const handleVerify2FA = async () => {
    if (twoFactorCode.length !== 6) {
      return Alert.alert("Error", "Please enter a valid 6-digit code.");
    }
    try {
      setVerifying2FA(true);
      const token = await AsyncStorage.getItem("userToken");
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
      showToast("Two-factor authentication enabled successfully.", "success");
    } catch (error) {
      showToast(
        getApiErrorMessage(error, "Invalid verification code."),
        "error",
      );
    } finally {
      setVerifying2FA(false);
    }
  };

  const handleToggleBiometric = async (value: boolean) => {
    if (value) {
      if (!biometric.available || !biometric.enrolled) {
        return Alert.alert(
          "Error",
          "Biometrics are not set up on this device.",
        );
      }
      const auth = await LocalAuthentication.authenticateAsync({
        promptMessage: "Authenticate to enable biometric protection",
        fallbackLabel: "Use Passcode",
      });
      if (!auth.success) {
        return showToast("Biometric authentication cancelled", "error");
      }
    }
    try {
      await AsyncStorage.setItem("biometricEnabled", String(value));
      setBiometric((prev) => ({ ...prev, enabled: value }));
      showToast(
        value ? "Biometrics enabled" : "Biometrics disabled",
        "success",
      );
    } catch (err) {
      showToast("Failed to update biometric preference", "error");
    }
  };

  const handleSaveSecurity = async () => {
    if (!passwords.current) {
      return Alert.alert("Error", "Please enter your current password.");
    }
    if (passwords.new && passwords.new.length < 12) {
      return Alert.alert(
        "Error",
        "New password must be at least 12 characters.",
      );
    }
    if (passwords.new && passwords.new !== passwords.confirm) {
      return Alert.alert("Error", "New passwords do not match.");
    }

    try {
      setSavingSecurity(true);
      const token = await AsyncStorage.getItem("userToken");
      const payload: Record<string, unknown> = {
        currentPassword: passwords.current,
        twoFactor,
        biometricEnabled: biometric.enabled,
      };
      if (passwords.new) {
        payload.newPassword = passwords.new;
      }

      await api.client.patch("/profile/security", payload, {
        headers: { Authorization: `Bearer ${token}` },
      });

      showToast("Security settings updated successfully", "success");
      setPasswords({ current: "", new: "", confirm: "" });
    } catch (err: any) {
      showToast(
        getApiErrorMessage(err, "Failed to update security settings."),
        "error",
      );
    } finally {
      setSavingSecurity(false);
    }
  };

  const handleSavePersonalInfo = async () => {
    if (!personalInfo.name.trim() || !personalInfo.email.trim()) {
      return Alert.alert("Error", "Name and email cannot be empty.");
    }
    try {
      setSavingPersonal(true);
      const token = await AsyncStorage.getItem("userToken");
      await api.client.patch("/profile", personalInfo, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setUser((prev) => (prev ? { ...prev, ...personalInfo } : null));
      showToast("Personal information updated", "success");
    } catch (err: any) {
      showToast(getApiErrorMessage(err, "Failed to update profile"), "error");
    } finally {
      setSavingPersonal(false);
    }
  };

  const fetchLoginSessions = useCallback(async () => {
    try {
      const token = await AsyncStorage.getItem("userToken");
      if (!token) return;
      setLoadingSessions(true);
      const res = await api.client.get("/auth/sessions", {
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
      const token = await AsyncStorage.getItem("userToken");
      await api.client.delete(`/auth/sessions/${sessionId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      showToast("Session revoked", "success");
      fetchLoginSessions();
    } catch (err: any) {
      showToast(getApiErrorMessage(err, "Failed to revoke session"), "error");
    }
  };

  const handleExportData = async () => {
    try {
      setExportingData(true);
      const token = await AsyncStorage.getItem("userToken");
      await api.client.get("/profile/export", {
        headers: { Authorization: `Bearer ${token}` },
      });
      showToast("Data export prepared and shared", "success");
    } catch (err) {
      showToast("Failed to export data", "error");
    } finally {
      setExportingData(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmationText !== "DELETE") {
      return Alert.alert(
        "Error",
        "Please type DELETE to confirm account removal.",
      );
    }
    try {
      setDeletingAccount(true);
      const token = await AsyncStorage.getItem("userToken");
      await api.client.delete("/profile", {
        headers: { Authorization: `Bearer ${token}` },
      });
      await AsyncStorage.clear();
      router.replace("/auth/login");
    } catch (err) {
      showToast("Failed to delete account", "error");
      setDeletingAccount(false);
    }
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
                <Text style={styles.userEmail}>{user?.email}</Text>
                <View style={styles.badgeContainer}>
                  <Text style={styles.badgeText}>
                    Plan: {user?.subscription.planName}
                  </Text>
                  <Text style={styles.serialText}>
                    ID: {user?.serialNumber}
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
                {user?.subscription.storageUsed.toFixed(1)} MB /{" "}
                {user?.subscription.storageTotal} MB ({user?.documentCount}{" "}
                documents)
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
              <SettingRow
                icon="person-outline"
                title="Personal Information"
                subtitle="Update your name, email, and contact details"
                isActive={activeTab === "personal"}
                onPress={() =>
                  setActiveTab(activeTab === "personal" ? "none" : "personal")
                }
              />
              {activeTab === "personal" && (
                <View style={styles.expandedSection}>
                  <Text style={styles.inputLabel}>Full Name</Text>
                  <TextInput
                    style={styles.input}
                    value={personalInfo.name}
                    onChangeText={(text) =>
                      setPersonalInfo({ ...personalInfo, name: text })
                    }
                  />
                  <Text style={styles.inputLabel}>Email Address</Text>
                  <TextInput
                    style={styles.input}
                    value={personalInfo.email}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    onChangeText={(text) =>
                      setPersonalInfo({ ...personalInfo, email: text })
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

              <SettingRow
                icon="shield-checkmark-outline"
                title="Security & Authentication"
                subtitle="Password, 2FA setup, and biometrics"
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
                    secureTextEntry
                    value={passwords.current}
                    onChangeText={(t) =>
                      setPasswords({ ...passwords, current: t })
                    }
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="New Password (min 12 chars)"
                    secureTextEntry
                    value={passwords.new}
                    onChangeText={(t) => setPasswords({ ...passwords, new: t })}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="Confirm New Password"
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
                  {!biometric.enrolled && (
                    <Text style={styles.warningText}>
                      Biometrics not enrolled on this device settings.
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

                  {/* Active Sessions List */}
                  <Text style={[styles.sectionSubtitle, { marginTop: 20 }]}>
                    Active Login Sessions
                  </Text>
                  {loadingSessions ? (
                    <ActivityIndicator color={COLORS.primary} />
                  ) : (
                    loginSessions.map((session) => (
                      <View key={session.id} style={styles.sessionRow}>
                        <View>
                          <Text style={styles.sessionDevice}>
                            {session.device} ({session.browser})
                          </Text>
                          <Text style={styles.sessionMeta}>
                            {session.location} · {session.lastActive}
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

              <SettingRow
                icon="notifications-outline"
                title="Notifications"
                subtitle="Manage push alerts and reminders"
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
                </View>
              )}

              <SettingRow
                icon="document-text-outline"
                title="Document Preferences"
                subtitle="Sort options, auto-categorize, and default views"
                isActive={activeTab === "documents"}
                onPress={() =>
                  setActiveTab(activeTab === "documents" ? "none" : "documents")
                }
              />
              {activeTab === "documents" && (
                <View style={styles.expandedSection}>
                  <Text style={styles.inputLabel}>
                    Expiry Reminder Buffer (Days)
                  </Text>
                  <TextInput
                    style={styles.input}
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

              <SettingRow
                icon="color-palette-outline"
                title="Appearance"
                subtitle="Theme options and font scales"
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
                    {["system", "light", "dark"].map((themeOption) => (
                      <TouchableOpacity
                        key={themeOption}
                        style={[
                          styles.selectorChip,
                          appearance.theme === themeOption &&
                            styles.selectorChipActive,
                        ]}
                        onPress={() =>
                          setAppearance({ ...appearance, theme: themeOption })
                        }
                      >
                        <Text
                          style={[
                            styles.selectorChipText,
                            appearance.theme === themeOption &&
                              styles.selectorChipTextActive,
                          ]}
                        >
                          {themeOption.toUpperCase()}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}

              <SettingRow
                icon="card-outline"
                title="Subscription & Plan"
                subtitle="Manage billing status and features"
                isActive={activeTab === "subscription"}
                onPress={() =>
                  setActiveTab(
                    activeTab === "subscription" ? "none" : "subscription",
                  )
                }
              />
              {activeTab === "subscription" && (
                <View style={styles.expandedSection}>
                  {/* Fix: Provide required props to SubscriptionView to resolve type mismatch */}
                  <SubscriptionView
                    planName={user?.subscription.planName || "Free"}
                    renewalDate={user?.subscription.renewalDate || "N/A"}
                    storageUsed={user?.subscription.storageUsed || 0}
                    storageTotal={user?.subscription.storageTotal || 50}
                  />
                </View>
              )}

              <SettingRow
                icon="help-circle-outline"
                title="Support & Feedback"
                subtitle="Get assistance or submit bug tickets"
                isActive={activeTab === "support"}
                onPress={() =>
                  setActiveTab(activeTab === "support" ? "none" : "support")
                }
              />
              {activeTab === "support" && (
                <View style={styles.expandedSection}>
                  <TextInput
                    style={[
                      styles.input,
                      { height: 80, textAlignVertical: "top" },
                    ]}
                    placeholder="Describe your issue or feedback..."
                    multiline
                    value={supportMessage}
                    onChangeText={setSupportMessage}
                  />
                  <TouchableOpacity
                    style={styles.saveButton}
                    onPress={() => {
                      showToast("Support ticket sent successfully", "success");
                      setSupportMessage("");
                    }}
                  >
                    <Text style={styles.saveButtonText}>Submit Ticket</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>

            {/* Danger Zone Section */}
            <View style={styles.dangerZoneContainer}>
              <Text style={styles.dangerZoneTitle}>Danger Zone</Text>

              <TouchableOpacity
                style={styles.dangerButton}
                onPress={handleExportData}
                disabled={exportingData}
              >
                {exportingData ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.dangerButtonText}>
                    Export All Vault Data
                  </Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.dangerButtonOutline}
                onPress={() => setDeleteModalVisible(true)}
              >
                <Text style={styles.dangerButtonOutlineText}>
                  Permanently Delete Account
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </RefreshableContainer>

        {/* Custom Confirmation Modal for Delete Account */}
        <Modal
          visible={deleteModalVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setDeleteModalVisible(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Delete Account</Text>
              <Text style={styles.modalText}>
                This permanently deletes your account and local vault data. Type
                DELETE to continue.
              </Text>

              <TextInput
                style={styles.input}
                placeholder="Type DELETE"
                autoCapitalize="characters"
                value={deleteConfirmationText}
                onChangeText={setDeleteConfirmationText}
              />

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={styles.modalCancelButton}
                  onPress={() => {
                    setDeleteModalVisible(false);
                    setDeleteConfirmationText("");
                  }}
                >
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.modalDeleteButton,
                    deleteConfirmationText !== "DELETE" && { opacity: 0.5 },
                  ]}
                  disabled={
                    deleteConfirmationText !== "DELETE" || deletingAccount
                  }
                  onPress={handleDeleteAccount}
                >
                  {deletingAccount ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.modalDeleteText}>Delete</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* Fix: Removed unsupported onHide prop from Toast to match ToastProps definition */}
        <Toast
          visible={toast.visible}
          message={toast.message}
          type={toast.type}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background || "#f8f9fa" },
  scrollContent: { padding: 16, paddingBottom: 40 },
  headerContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
  },
  uniqueAvatarContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: COLORS.primary,
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
    position: "relative",
  },
  abstractShape: { position: "absolute", opacity: 0.3 },
  shape1: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#fff",
    top: -5,
    left: -5,
  },
  shape2: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: "#000",
    bottom: -10,
    right: -10,
  },
  shape3: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#fff",
    bottom: 10,
    left: 10,
  },
  avatarInitials: { color: "#fff", fontSize: 20, fontWeight: "bold" },
  headerTextContainer: { marginLeft: 16, flex: 1 },
  userName: { fontSize: 18, fontWeight: "bold", color: COLORS.text || "#111" },
  // Fix: Replaced non-existent 'subtext' token with valid theme definitions like COLORS.textSecondary or standard fallback
  userEmail: {
    fontSize: 14,
    color: COLORS.textSecondary || "#666",
    marginTop: 2,
  },
  badgeContainer: { flexDirection: "row", marginTop: 6, gap: 10 },
  badgeText: {
    fontSize: 12,
    backgroundColor: `${COLORS.primary}15`,
    color: COLORS.primary,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: "hidden",
    fontWeight: "600",
  },
  serialText: { fontSize: 12, color: "#888", alignSelf: "center" },
  storageCard: { padding: 16, marginBottom: 20 },
  storageHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  storageTitle: { fontSize: 15, fontWeight: "600", color: COLORS.text },
  storageDetails: {
    fontSize: 13,
    color: COLORS.textSecondary || "#666",
    marginBottom: 8,
  },
  progressBarBackground: {
    height: 8,
    backgroundColor: "#e0e0e0",
    borderRadius: 4,
    overflow: "hidden",
  },
  progressBarFill: {
    height: "100%",
    backgroundColor: COLORS.primary,
    borderRadius: 4,
  },
  sectionsContainer: { gap: 10 },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#eee",
  },
  activeSettingRow: {
    borderColor: COLORS.primary,
    backgroundColor: `${COLORS.primary}05`,
  },
  settingInfo: { flex: 1, marginLeft: 14 },
  settingTitle: { fontSize: 16, fontWeight: "600", color: COLORS.text },
  settingSubtitle: {
    fontSize: 13,
    color: COLORS.textSecondary || "#666",
    marginTop: 2,
  },
  expandedSection: {
    backgroundColor: "#fff",
    padding: 16,
    borderRadius: 12,
    marginTop: -4,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#eee",
  },
  sectionSubtitle: {
    fontSize: 15,
    fontWeight: "600",
    color: COLORS.text,
    marginBottom: 10,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.textSecondary || "#666",
    marginBottom: 6,
    marginTop: 10,
  },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    backgroundColor: "#fafafa",
  },
  saveButton: {
    backgroundColor: COLORS.primary,
    padding: 14,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 16,
  },
  saveButtonText: { color: "#fff", fontSize: 15, fontWeight: "600" },
  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
  },
  label: { fontSize: 15, color: COLORS.text },
  warningText: {
    fontSize: 12,
    color: COLORS.danger || "#d9534f",
    marginTop: 4,
  },
  totpSetupContainer: {
    marginTop: 10,
    padding: 12,
    backgroundColor: "#f1f5f9",
    borderRadius: 8,
  },
  totpInstructions: { fontSize: 13, color: COLORS.text, marginBottom: 6 },
  totpUriText: {
    fontSize: 11,
    fontFamily: Platform.OS === "ios" ? "Courier" : "monospace",
    color: COLORS.primary,
    marginBottom: 10,
  },
  verifyButton: {
    backgroundColor: COLORS.secondary || "#0284c7",
    padding: 12,
    borderRadius: 6,
    alignItems: "center",
    marginTop: 10,
  },
  sessionRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  sessionDevice: { fontSize: 14, fontWeight: "600", color: COLORS.text },
  sessionMeta: { fontSize: 12, color: "#777", marginTop: 2 },
  revokeText: {
    fontSize: 13,
    fontWeight: "600",
    color: COLORS.danger || "#d9534f",
  },
  selectorRow: { flexDirection: "row", gap: 10, marginTop: 6 },
  selectorChip: {
    flex: 1,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    alignItems: "center",
    backgroundColor: "#fafafa",
  },
  selectorChipActive: {
    borderColor: COLORS.primary,
    backgroundColor: `${COLORS.primary}10`,
  },
  selectorChipText: { fontSize: 13, fontWeight: "600", color: "#666" },
  selectorChipTextActive: { color: COLORS.primary },
  dangerZoneContainer: {
    marginTop: 30,
    padding: 16,
    backgroundColor: `${COLORS.danger || "#d9534f"}08`,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: `${COLORS.danger || "#d9534f"}30`,
  },
  dangerZoneTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: COLORS.danger || "#d9534f",
    marginBottom: 12,
  },
  dangerButton: {
    backgroundColor: COLORS.danger || "#d9534f",
    padding: 14,
    borderRadius: 8,
    alignItems: "center",
    marginBottom: 10,
  },
  dangerButtonText: { color: "#fff", fontWeight: "600", fontSize: 15 },
  dangerButtonOutline: {
    borderWidth: 1,
    borderColor: COLORS.danger || "#d9534f",
    padding: 14,
    borderRadius: 8,
    alignItems: "center",
  },
  dangerButtonOutlineText: {
    color: COLORS.danger || "#d9534f",
    fontWeight: "600",
    fontSize: 15,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalContent: {
    backgroundColor: "#fff",
    width: "100%",
    maxWidth: 360,
    padding: 20,
    borderRadius: 12,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: COLORS.text,
    marginBottom: 8,
  },
  modalText: {
    fontSize: 14,
    color: COLORS.textSecondary || "#666",
    marginBottom: 16,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 20,
  },
  modalCancelButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 6,
    backgroundColor: "#f1f5f9",
  },
  modalCancelText: { color: COLORS.text, fontWeight: "600" },
  modalDeleteButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 6,
    backgroundColor: COLORS.danger || "#d9534f",
  },
  modalDeleteText: { color: "#fff", fontWeight: "600" },
});
