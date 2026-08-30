import { api } from "../../services/api";
import React, { useState, useEffect } from "react";
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
import { COLORS } from "@/constants";
import { RefreshableContainer } from "@/components/ui/RefreshableContainer";
import AsyncStorage from "@react-native-async-storage/async-storage";

type SettingsTab =
  | "none"
  | "security"
  | "notifications"
  | "subscription"
  | "support";

interface SubscriptionDetails {
  planName: string;
  renewalDate: string;
  storageUsed: number;
  storageTotal: number;
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
  subscription: SubscriptionDetails;
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

  const [passwords, setPasswords] = useState({
    current: "",
    new: "",
    confirm: "",
  });
  const [twoFactor, setTwoFactor] = useState(false);
  const [notifyEmail, setNotifyEmail] = useState(true);
  const [notifyPush, setNotifyPush] = useState(false);
  const [notifyExpiry, setNotifyExpiry] = useState(true);
  const [supportMessage, setSupportMessage] = useState("");

  const fetchProfile = async () => {
    try {
      const res = await api.client.get("/profile");
      setUser(res.data);
      setTwoFactor(res.data.twoFactor);
      setNotifyEmail(res.data.notifyEmail);
      setNotifyPush(res.data.notifyPush);
      setNotifyExpiry(res.data.notifyExpiry);
    } catch (err: any) {
      console.error(
        "Server error response:",
        err.response?.status,
        err.response?.data,
      );
      Alert.alert("Error", "Could not load profile details.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProfile();
  }, []);

  const handleDataReload = async () => {
    await fetchProfile();
  };

  const handleSaveSecurity = async () => {
    if (passwords.new && passwords.new !== passwords.confirm) {
      return Alert.alert("Error", "New passwords do not match.");
    }
    try {
      const token = await AsyncStorage.getItem("userToken");
      const res = await api.client.patch(
        "/profile/security",
        {
          currentPassword: passwords.current,
          newPassword: passwords.new,
          twoFactor,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      if (res.status !== 200 && res.status !== 201) {
        throw new Error(res.data?.error || "Failed to update security");
      }

      Alert.alert("Success", "Security settings updated");
      setPasswords({ current: "", new: "", confirm: "" });
    } catch (err: any) {
      Alert.alert("Error", err.response?.data?.error || err.message);
    }
  };

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
          headers: {
            Authorization: `Bearer ${token}`,
          },
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
      Alert.alert("Sent", "Support team notified.");
      setSupportMessage("");
    } catch (err) {
      Alert.alert("Error", "Could not submit support ticket.");
    }
  };

  const handleExportToCloud = async () => {
    try {
      const res = await api.cloud.exportData();
      if (res.status === "success") {
        Alert.alert(
          "Export Complete",
          "Your documents have been exported to Supabase cloud.",
        );
      }
    } catch (err) {
      Alert.alert(
        "Export Failed",
        "Could not export data to cloud. Please try again.",
      );
    }
  };

  const handleLogout = async () => {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel" },
      {
        text: "Sign Out",
        onPress: async () => {
          await AsyncStorage.removeItem("userToken");
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
                    secureTextEntry
                    value={passwords.current}
                    onChangeText={(t) =>
                      setPasswords({ ...passwords, current: t })
                    }
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="New Password"
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
                  <View style={styles.switchRow}>
                    <Text>Enable 2FA Authentication</Text>
                    <Switch
                      value={twoFactor}
                      onValueChange={setTwoFactor}
                      trackColor={{ true: COLORS.primary }}
                    />
                  </View>
                  <TouchableOpacity
                    style={styles.primaryButton}
                    onPress={handleSaveSecurity}
                  >
                    <Text style={styles.buttonText}>Save Changes</Text>
                  </TouchableOpacity>
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
                    <Text>Email Alerts</Text>
                    <Switch
                      value={notifyEmail}
                      onValueChange={(val) =>
                        handleSavePreferences(val, notifyPush, notifyExpiry)
                      }
                    />
                  </View>
                  <View style={styles.switchRow}>
                    <Text>Push Notifications</Text>
                    <Switch
                      value={notifyPush}
                      onValueChange={(val) =>
                        handleSavePreferences(notifyEmail, val, notifyExpiry)
                      }
                    />
                  </View>
                  <View style={styles.switchRow}>
                    <Text>Expiry Alerts</Text>
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
  version: {
    textAlign: "center",
    fontSize: 13,
    color: COLORS.textSecondary,
    marginBottom: 20,
  },
});
