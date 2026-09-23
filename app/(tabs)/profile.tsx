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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Card } from "../../components/ui";
import { SubscriptionView } from "../../components/ui/SubscriptionView";
import { Toast } from "../../components/ui/Toast";
import type { ToastType } from "../../components/ui/Toast";
import { COLORS, Colors } from "@/constants";
import { RefreshableContainer } from "@/components/ui/RefreshableContainer";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "../../services/api";
import { getUserProfile, getAllDocuments } from "../../services/localDatabase";
import { exportLocalBackup } from "../../services/backupService";
import * as SecureStore from "expo-secure-store";

type SettingsTab =
  | "none"
  | "security"
  | "notifications"
  | "subscription"
  | "support"
  | "biometrics";

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

interface SettingRowProps {
  icon: string;
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
  <TouchableOpacity onPress={onPress}>
    <View style={[styles.settingRow, isActive && styles.activeSettingRow]}>
      <Ionicons name={icon as any} size={22} color={COLORS.primary} />
      <View style={styles.settingInfo}>
        <Text style={styles.settingTitle}>{title}</Text>
        <Text style={styles.settingSubtitle}>{subtitle}</Text>
      </View>
      <Ionicons
        name={isActive ? "chevron-down" : "chevron-forward"}
        size={20}
        color={isActive ? COLORS.primary : COLORS.border || "#ccc"}
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

export default function ProfileScreen() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<SettingsTab>("none");
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<UserProfile | null>(null);
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
  const [twoFactorSecret, setTwoFactorSecret] = useState("");
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [biometricPin, setBiometricPin] = useState("");
  const [notifyEmail, setNotifyEmail] = useState(true);
  const [notifyPush, setNotifyPush] = useState(false);
  const [notifyExpiry, setNotifyExpiry] = useState(true);
  const [supportMessage, setSupportMessage] = useState("");

  const showToast = (message: string, type: ToastType = "success") => {
    setToast({ visible: true, message, type });
  };

  const fetchProfile = useCallback(async () => {
    try {
      const localProfile = await getUserProfile();
      const localDocs = await getAllDocuments();

      let serialNumber = "";
      if (localProfile?.name) {
        const nameParts = localProfile.name.trim().toUpperCase().split(" ");
        const lastName = nameParts[nameParts.length - 1] || "USER";
        const docCount = String(localDocs.length).padStart(4, "0");
        serialNumber = `DG-${lastName.substring(0, 3)}-${docCount}`;
      }

      if (localProfile) {
        const storedBiometric = await AsyncStorage.getItem("biometricEnabled");
        const storedSecret = await AsyncStorage.getItem("twoFactorSecret");

        setUser({
          name: localProfile.name,
          email: localProfile.email || "user@example.com",
          securityLevel: "Standard",
          documentCount: localDocs.length,
          expiringCount: localDocs.filter(
            (d) => d.status === "expiring",
          ).length,
          notifyEmail: localProfile.notifyEmail,
          notifyPush: false,
          notifyExpiry: localProfile.notifyExpiry,
          twoFactor: localProfile.twoFactor,
          serialNumber,
          subscription: {
            planName: "Free",
            renewalDate: "",
            storageUsed: localDocs.length * 0.5,
            storageTotal: 50,
            serialNumber,
          },
          biometricEnabled: false,
        });
        setTwoFactor(localProfile.twoFactor);
        setNotifyEmail(localProfile.notifyEmail);
        setNotifyExpiry(localProfile.notifyExpiry);
        if (storedBiometric !== null) {
          setBiometricEnabled(storedBiometric === "true");
        }
        if (storedSecret !== null) {
          setTwoFactorSecret(storedSecret);
        }
      } else {
        setUser({
          name: "User",
          email: "user@example.com",
          securityLevel: "Standard",
          documentCount: localDocs.length,
          expiringCount: localDocs.filter(
            (d) => d.status === "expiring",
          ).length,
          notifyEmail: true,
          notifyPush: false,
          notifyExpiry: true,
          twoFactor: false,
          biometricEnabled: false,
          serialNumber: `DG-USER-${String(localDocs.length).padStart(4, "0")}`,
          subscription: {
            planName: "Free",
            renewalDate: "",
            storageUsed: localDocs.length * 0.5,
            storageTotal: 50,
            serialNumber: `DG-USER-${String(localDocs.length).padStart(4, "0")}`,
          },
        });
      }

      const token = await AsyncStorage.getItem("userToken");
      if (token) {
        try {
          const res = await api.client.get("/profile");
          const subData = res.data.subscription || {};
          setUser((prev) => ({
            ...prev,
            ...res.data,
            serialNumber: res.data.serialNumber || prev?.serialNumber || serialNumber,
            subscription: {
              planName: subData.planName || prev?.subscription?.planName || "Free",
              renewalDate: subData.renewalDate || prev?.subscription?.renewalDate || "",
              storageUsed: subData.storageUsed ?? prev?.subscription?.storageUsed ?? localDocs.length * 0.5,
              storageTotal: subData.storageTotal ?? prev?.subscription?.storageTotal ?? 50,
              serialNumber: prev?.serialNumber || serialNumber,
            },
          }));
          if (res.data.twoFactor !== undefined) setTwoFactor(res.data.twoFactor);
          if (res.data.notifyEmail !== undefined) setNotifyEmail(res.data.notifyEmail);
          if (res.data.notifyPush !== undefined) setNotifyPush(res.data.notifyPush);
          if (res.data.notifyExpiry !== undefined) setNotifyExpiry(res.data.notifyExpiry);
        } catch (err) {
          // Fall back to local data silently
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
  }, [fetchProfile]);

  const handleDataReload = async () => {
    await fetchProfile();
  };

  const handleSaveSecurity = async () => {
    if (passwords.new && passwords.new !== passwords.confirm) {
      return Alert.alert("Error", "New passwords do not match.");
    }
    if (passwords.new && passwords.new.length < 6) {
      return Alert.alert("Error", "Password must be at least 6 characters.");
    }
    try {
      const token = await AsyncStorage.getItem("userToken");
      await AsyncStorage.setItem(
        "biometricEnabled",
        String(biometricEnabled),
      );
      if (biometricPin) {
        await AsyncStorage.setItem("biometricPin", biometricPin);
      }
      if (twoFactorSecret) {
        await AsyncStorage.setItem("twoFactorSecret", twoFactorSecret);
      }
      const res = await api.client.patch(
        "/profile/security",
        {
          currentPassword: passwords.current,
          newPassword: passwords.new,
          twoFactor,
          twoFactorCode: twoFactorCode || undefined,
          biometricEnabled,
        },
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      if (res.status !== 200 && res.status !== 201) {
        throw new Error(res.data?.error || "Failed to update security");
      }

      showToast("Security settings updated successfully");
      setPasswords({ current: "", new: "", confirm: "" });
      setTwoFactorCode("");
    } catch (err: any) {
      Alert.alert("Error", err.response?.data?.error || err.message);
    }
  };

  function generateTOTPSecret(): string {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let result = "";
    for (let i = 0; i < 32; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  const handleSavePreferences = async (
    email: boolean,
    push: boolean,
    expiry: boolean,
  ) => {
    setNotifyEmail(email);
    setNotifyPush(push);
    setNotifyExpiry(expiry);

    try {
      const token = await AsyncStorage.getItem("userToken");
      await api.client.patch(
        "/profile/preferences",
        {
          notifyEmail: email,
          notifyPush: push,
          notifyExpiry: expiry,
        },
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
    } catch (err) {
      console.error("Failed to update notification flags", err);
    }
  };

  const handleSubmitTicket = async () => {
    if (!supportMessage.trim()) return;
    try {
      const token = await AsyncStorage.getItem("userToken");
      const res = await api.client.post(
        "/profile/support",
        { message: supportMessage },
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );
      if (res.status !== 200 && res.status !== 201)
        throw new Error("Failed to submit ticket");
      showToast("Support team notified.");
      setSupportMessage("");
    } catch (err: any) {
      Alert.alert("Error", "Could not submit support ticket.");
    }
  };

  const handleExportToCloud = async () => {
    try {
      const res = await api.cloud.exportData();
      showToast("Documents exported to cloud backup successfully.");
    } catch (err: any) {
      Alert.alert(
        "Cloud Export Failed",
        "Could not export data to cloud. Try local backup instead.",
      );
    }
  };

  const handleLocalBackup = async () => {
    try {
      showToast("Preparing your backup...");
      await exportLocalBackup();
    } catch (err: any) {
      Alert.alert("Backup Failed", "Could not create local backup.");
    }
  };

  const handleLogout = async () => {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel" },
      {
        text: "Sign Out",
        onPress: async () => {
          await AsyncStorage.removeItem("userToken");
          await SecureStore.deleteItemAsync("userToken").catch(() => {});
          router.replace("/login" as any);
        },
        style: "destructive",
      },
    ]);
  };

  const toggleTab = (tab: SettingsTab) =>
    setActiveTab(activeTab === tab ? "none" : tab);

  if (loading || !user) {
    return (
      <SafeAreaView
        style={{
          flex: 1,
          backgroundColor: COLORS.background,
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={{ marginTop: 12, color: COLORS.textSecondary, fontSize: 14 }}>
          Loading your vault...
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background }}>
      <RefreshableContainer
        onRefresh={handleDataReload}
        contentContainerStyle={styles.content}
      >
        <ScrollView
          style={styles.container}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <Card style={styles.userCard}>
            <View style={styles.userCardContent}>
              <UniqueAvatar name={user.name} />
              <View style={styles.userInfo}>
                <Text style={styles.userName}>{user.name}</Text>
                <Text style={styles.userEmail}>{user.email}</Text>
                <View style={styles.tierRow}>
                  <View style={styles.securityLevel}>
                    <Ionicons
                      name="shield-checkmark"
                      size={16}
                      color={COLORS.primary}
                    />
                    <Text style={styles.securityLevelText}>
                      {user.securityLevel}
                    </Text>
                  </View>
                  {user.serialNumber ? (
                    <Text style={styles.serialNumber}>
                      {user.serialNumber}
                    </Text>
                  ) : null}
                </View>
              </View>
            </View>
          </Card>

          <View style={styles.statsContainer}>
            <Card style={[styles.statCard, { backgroundColor: "#EFF6FF" }]}>
              <Text style={[styles.statValue, { color: "#2563EB" }]}>
                {user.documentCount}
              </Text>
              <Text style={styles.statLabel}>Documents</Text>
            </Card>

            <Card style={[styles.statCard, { backgroundColor: "#FEF2F2" }]}>
              <Text style={[styles.statValue, { color: "#DC2626" }]}>
                {user.expiringCount}
              </Text>
              <Text style={styles.statLabel}>Expiring Soon</Text>
            </Card>
          </View>

          <View style={styles.settingsSection}>
            <Text style={styles.settingsTitle}>Settings Management</Text>
            <Card style={{ padding: 0 }}>
              <SettingRow
                icon="lock-closed"
                title="Account Security"
                subtitle="Password & 2FA"
                isActive={activeTab === "security"}
                onPress={() => toggleTab("security")}
              />
              {activeTab === "security" && (
                <View style={styles.expandedContent}>
                  <TextInput
                    style={styles.input}
                    placeholder="Current Password"
                    placeholderTextColor="#999"
                    secureTextEntry
                    value={passwords.current}
                    onChangeText={(t) =>
                      setPasswords({ ...passwords, current: t })
                    }
                    autoCorrect={false}
                    autoComplete="current-password"
                    textContentType="password"
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="New Password (min 6 chars)"
                    placeholderTextColor="#999"
                    secureTextEntry
                    value={passwords.new}
                    onChangeText={(t) => setPasswords({ ...passwords, new: t })}
                    autoCorrect={false}
                    autoComplete="new-password"
                    textContentType="newPassword"
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="Confirm New Password"
                    placeholderTextColor="#999"
                    secureTextEntry
                    value={passwords.confirm}
                    onChangeText={(t) =>
                      setPasswords({ ...passwords, confirm: t })
                    }
                    autoCorrect={false}
                    autoComplete="new-password"
                    textContentType="newPassword"
                  />
                  <View style={styles.switchRow}>
                    <Text style={{ fontSize: 14 }}>Enable 2FA (Authenticator App)</Text>
                    <Switch
                      value={twoFactor}
                      onValueChange={(val) => {
                        setTwoFactor(val);
                        if (!val) {
                          setTwoFactorCode("");
                          setTwoFactorSecret("");
                          AsyncStorage.removeItem("twoFactorSecret").catch(() => {});
                        }
                      }}
                      trackColor={{ true: COLORS.primary }}
                    />
                  </View>
                  {twoFactor && !twoFactorSecret && (
                    <View style={styles.totpSetupContainer}>
                      <Text style={styles.totpSecretLabel}>Setup Key:</Text>
                      <Text style={styles.totpSecret} selectable>{twoFactorSecret || "—"}</Text>
                      <TouchableOpacity
                        style={styles.primaryButton}
                        onPress={() => {
                          const secret = generateTOTPSecret();
                          setTwoFactorSecret(secret);
                          AsyncStorage.setItem("twoFactorSecret", secret).catch(() => {});
                        }}
                      >
                        <Text style={styles.buttonText}>Generate Setup Key</Text>
                      </TouchableOpacity>
                      <Text style={styles.totpHint}>
                        Scan this key in your Authenticator App (Google/Microsoft Authenticator)
                      </Text>
                    </View>
                  )}
                  {twoFactor && twoFactorSecret && (
                    <TextInput
                      style={styles.input}
                      placeholder="Enter 6-digit code from Authenticator App"
                      placeholderTextColor="#999"
                      keyboardType="number-pad"
                      maxLength={6}
                      value={twoFactorCode}
                      onChangeText={(t) => {
                        const clean = t.replace(/[^0-9]/g, "").slice(0, 6);
                        setTwoFactorCode(clean);
                      }}
                      autoCorrect={false}
                    />
                  )}
                  <TouchableOpacity
                    style={styles.primaryButton}
                    onPress={handleSaveSecurity}
                  >
                    <Text style={styles.buttonText}>Save Changes</Text>
                  </TouchableOpacity>

                  <View style={styles.switchRow}>
                    <Text style={{ fontSize: 14 }}>Biometric Login (Fingerprint)</Text>
                    <Switch
                      value={biometricEnabled}
                      onValueChange={async (val) => {
                        setBiometricEnabled(val);
                        if (!val) {
                          setBiometricPin("");
                          AsyncStorage.removeItem("biometricPin").catch(() => {});
                        }
                      }}
                      trackColor={{ true: COLORS.primary }}
                    />
                  </View>
                  {biometricEnabled && (
                    <TextInput
                      style={styles.input}
                      placeholder="Set a PIN for biometric fallback"
                      placeholderTextColor="#999"
                      secureTextEntry
                      value={biometricPin}
                      onChangeText={(t) => {
                        const clean = t.replace(/[^0-9]/g, "").slice(0, 6);
                        setBiometricPin(clean);
                      }}
                      keyboardType="number-pad"
                      maxLength={6}
                      autoCorrect={false}
                    />
                  )}
                </View>
              )}

              <SettingRow
                icon="notifications"
                title="Notifications"
                subtitle="Alert preferences"
                isActive={activeTab === "notifications"}
                onPress={() => toggleTab("notifications")}
              />
              {activeTab === "notifications" && (
                <View style={styles.expandedContent}>
                  <View style={styles.switchRow}>
                    <Text style={{ fontSize: 14 }}>Email Alerts</Text>
                    <Switch
                      value={notifyEmail}
                      onValueChange={(val) =>
                        handleSavePreferences(val, notifyPush, notifyExpiry)
                      }
                    />
                  </View>
                  <View style={styles.switchRow}>
                    <Text style={{ fontSize: 14 }}>Push Notifications</Text>
                    <Switch
                      value={notifyPush}
                      onValueChange={(val) =>
                        handleSavePreferences(notifyEmail, val, notifyExpiry)
                      }
                    />
                  </View>
                  <View style={styles.switchRow}>
                    <Text style={{ fontSize: 14 }}>Expiry Alerts</Text>
                    <Switch
                      value={notifyExpiry}
                      onValueChange={(val) =>
                        handleSavePreferences(notifyEmail, notifyPush, val)
                      }
                    />
                  </View>
                </View>
              )}

              <SettingRow
                icon="card"
                title="Subscription"
                subtitle="Manage plan"
                isActive={activeTab === "subscription"}
                onPress={() => toggleTab("subscription")}
              />
              {activeTab === "subscription" && (
                <View style={styles.expandedContent}>
                  <SubscriptionView
                    planName={user.subscription?.planName || user.securityLevel}
                    renewalDate={
                      user.subscription?.renewalDate
                        ? new Date(
                            user.subscription.renewalDate,
                          ).toLocaleDateString()
                        : "Active Plan"
                    }
                    storageUsed={user.subscription?.storageUsed ?? 0}
                    storageTotal={user.subscription?.storageTotal ?? 50}
                  />
                </View>
              )}

              <SettingRow
                icon="help-circle"
                title="Help & Support"
                subtitle="Send us a message"
                isActive={activeTab === "support"}
                onPress={() => toggleTab("support")}
              />
              {activeTab === "support" && (
                <View style={styles.expandedContent}>
                  <TextInput
                    style={[styles.input, { height: 100 }]}
                    placeholder="How can we help you?"
                    multiline
                    value={supportMessage}
                    onChangeText={setSupportMessage}
                    autoCorrect={false}
                  />
                  <TouchableOpacity
                    style={styles.primaryButton}
                    onPress={handleSubmitTicket}
                  >
                    <Text style={styles.buttonText}>Submit Ticket</Text>
                  </TouchableOpacity>
                </View>
              )}
            </Card>
          </View>

          <Card style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Cloud Sync</Text>
            <Text style={styles.sectionSubtitle}>
              Export your documents and reminders to Supabase cloud backup.
            </Text>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={handleExportToCloud}
            >
              <Text style={styles.buttonText}>Export to Cloud</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.primaryButton, { backgroundColor: Colors.textMuted, marginTop: 12 }]}
              onPress={handleLocalBackup}
            >
              <Ionicons name="download-outline" size={20} color="white" />
              <Text style={styles.buttonText}>Export Local Backup</Text>
            </TouchableOpacity>
          </Card>

          <TouchableOpacity style={styles.signOutButton} onPress={handleLogout}>
            <View style={styles.signOutButtonContent}>
              <Ionicons name="log-out" size={20} color={COLORS.danger} />
              <Text style={[styles.actionButtonText, { color: COLORS.danger }]}>
                Sign Out
              </Text>
            </View>
          </TouchableOpacity>

          <Text style={styles.version}>DocuGuard v1.0.0</Text>
        </ScrollView>
      </RefreshableContainer>

      <Toast
        visible={toast.visible}
        message={toast.message}
        type={toast.type}
        onDismiss={() => setToast((t) => ({ ...t, visible: false }))}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 60 },
  userCard: { marginBottom: 24, padding: 24, borderRadius: 24 },
  userCardContent: { alignItems: "center" },
  uniqueAvatarContainer: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: "#1E293B",
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
    borderWidth: 3,
    borderColor: `${COLORS.primary}30`,
  },
  switchRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  abstractShape: { position: "absolute", borderRadius: 50, opacity: 0.6 },
  shape1: {
    width: 80,
    height: 80,
    backgroundColor: COLORS.primary,
    top: -25,
    left: -25,
  },
  shape2: {
    width: 70,
    height: 70,
    backgroundColor: "#8B5CF6",
    bottom: -20,
    right: -15,
  },
  shape3: {
    width: 45,
    height: 45,
    backgroundColor: "#10B981",
    top: 30,
    left: 45,
  },
  avatarInitials: {
    fontSize: 32,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: 2,
  },
  userInfo: { alignItems: "center", marginTop: 8 },
  userName: {
    fontSize: 22,
    fontWeight: "700",
    color: COLORS.text,
    marginBottom: 4,
  },
  userEmail: { fontSize: 15, color: COLORS.textSecondary, marginBottom: 12 },
  tierRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  securityLevel: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: `${COLORS.primary}10`,
    borderRadius: 24,
  },
  securityLevelText: { fontSize: 14, fontWeight: "600", color: COLORS.primary },
  serialNumber: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.primary,
    backgroundColor: `${COLORS.primary}10`,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    letterSpacing: 1,
  },
  statsContainer: { flexDirection: "row", gap: 16, marginBottom: 28 },
  statCard: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 24,
    borderRadius: 20,
  },
  statValue: { fontSize: 28, fontWeight: "800", color: COLORS.text },
  statLabel: { fontSize: 13, color: COLORS.textSecondary, marginTop: 4 },
  settingsSection: { marginBottom: 28 },
  settingsTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: COLORS.text,
    marginBottom: 16,
    marginLeft: 4,
  },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 18,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  activeSettingRow: { backgroundColor: `${COLORS.primary}05` },
  settingInfo: { flex: 1, marginLeft: 16 },
  settingTitle: { fontSize: 16, fontWeight: "600", color: COLORS.text },
  settingSubtitle: { fontSize: 14, color: COLORS.textSecondary, marginTop: 4 },
  expandedContent: {
    padding: 20,
    backgroundColor: "#F9FAFB",
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  input: {
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#ddd",
    paddingHorizontal: 16,
    height: 48,
    marginBottom: 12,
    fontSize: 15,
  },
  primaryButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    height: 48,
    justifyContent: "center",
    alignItems: "center",
  },
  buttonText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  signOutButton: { marginTop: 16, marginBottom: 32 },
  signOutButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.danger,
    backgroundColor: `${COLORS.danger}08`,
  },
  actionButtonText: { fontWeight: "600", fontSize: 14 },
  sectionCard: {
    padding: 16,
    marginBottom: 28,
    backgroundColor: COLORS.surface,
    borderRadius: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: COLORS.text,
    marginBottom: 8,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginBottom: 16,
    lineHeight: 20,
  },
  version: {
    textAlign: "center",
    fontSize: 13,
    color: COLORS.textSecondary,
    marginBottom: 20,
  },
  totpSetupContainer: {
    padding: 12,
    backgroundColor: "#f0f4ff",
    borderRadius: 10,
    marginTop: 12,
    marginBottom: 12,
    alignItems: "center",
  },
  totpSecretLabel: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginBottom: 4,
  },
  totpSecret: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.primary,
    letterSpacing: 2,
    marginBottom: 8,
  },
  totpHint: {
    fontSize: 12,
    color: COLORS.textSecondary,
    textAlign: "center",
    marginTop: 8,
    lineHeight: 18,
  },
});
