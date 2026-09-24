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
import { exportLocalBackup } from "../../services/backupService";
import * as SecureStore from "expo-secure-store";
import * as LocalAuthentication from "expo-local-authentication";

type SettingsTab =
  | "none"
  | "personal"
  | "security"
  | "notifications"
  | "documents"
  | "sync"
  | "appearance"
  | "subscription"
  | "support"
  | "privacy"
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

interface LoginSession {
  id: string;
  device: string;
  browser: string;
  location: string;
  lastActive: string;
  current: boolean;
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
  <TouchableOpacity onPress={onPress} accessibilityRole="button" accessibilityLabel={title}>
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

// Error handling helper
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
  const [totpVerified, setTotpVerified] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [biometricPin, setBiometricPin] = useState("");
  const [fingerprintEnrolled, setFingerprintEnrolled] = useState(false);
  const [fingerprintBusy, setFingerprintBusy] = useState(false);
  const [showFingerprintModal, setShowFingerprintModal] = useState(false);
  const [fingerprintError, setFingerprintError] = useState("");
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
  const [savingDocPrefs, setSavingDocPrefs] = useState(false);
  const [appearance, setAppearance] = useState({
    theme: "system",
    fontSize: "medium",
    reducedMotion: false,
  });
  const [savingAppearance, setSavingAppearance] = useState(false);
  const [privacy, setPrivacy] = useState({
    analytics: false,
    crashReports: true,
    dataSharing: false,
  });
  const [savingPrivacy, setSavingPrivacy] = useState(false);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showBiometricPin, setShowBiometricPin] = useState(false);
  const [savingNotifications, setSavingNotifications] = useState(false);
  const [revokingSessionId, setRevokingSessionId] = useState<string | null>(null);
  const [revokingAllSessions, setRevokingAllSessions] = useState(false);
  const [exportingData, setExportingData] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [cloudExporting, setCloudExporting] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [submittingTicket, setSubmittingTicket] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [showingSessionRevoke, setShowingSessionRevoke] = useState<string | null>(null);
  const [showingRevokeAll, setShowingRevokeAll] = useState(false);

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
        const storedSecret = await SecureStore.getItemAsync("twoFactorSecret", {
          keychainService: "docuguard.2fa",
        });

        setUser({
          name: localProfile.name,
          email: localProfile.email || "user@example.com",
          securityLevel: "Standard",
          documentCount: localDocs.length,
          expiringCount: localDocs.filter(
            (d) => d.status === "expiring",
          ).length,
          notifyEmail: localProfile.notifyEmail,
          notifyPush: localProfile.notifyPush || false,
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
        setPersonalInfo({
          name: localProfile.name || "",
          email: localProfile.email || "",
        });
        setTwoFactor(localProfile.twoFactor);
        setNotifyEmail(localProfile.notifyEmail);
        setNotifyPush(localProfile.notifyPush || false);
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
        setPersonalInfo({
          name: "User",
          email: "user@example.com",
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
          setPersonalInfo({
            name: res.data.name || "",
            email: res.data.email || "",
          });
          if (res.data.twoFactor !== undefined) setTwoFactor(res.data.twoFactor);
          if (res.data.notifyEmail !== undefined) setNotifyEmail(res.data.notifyEmail);
          if (res.data.notifyPush !== undefined) setNotifyPush(res.data.notifyPush);
          if (res.data.notifyExpiry !== undefined) setNotifyExpiry(res.data.notifyExpiry);
          // Load preferences from backend
          if (res.data.documentPreferences) {
            setDocPreferences(res.data.documentPreferences);
          }
          if (res.data.themeMode || res.data.fontSize || res.data.reducedMotion !== undefined) {
            setAppearance({
              theme: res.data.themeMode || "system",
              fontSize: res.data.fontSize || "medium",
              reducedMotion: res.data.reducedMotion || false,
            });
          }
          if (res.data.analyticsEnabled !== undefined || res.data.crashReportsEnabled !== undefined || res.data.dataSharingEnabled !== undefined) {
            setPrivacy({
              analytics: res.data.analyticsEnabled || false,
              crashReports: res.data.crashReportsEnabled !== false,
              dataSharing: res.data.dataSharingEnabled || false,
            });
          }
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

  const checkFingerprintSupport = useCallback(async () => {
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      const stored = await SecureStore.getItemAsync(
        "docuguard.fingerprint.enrolled",
        { keychainService: "docuguard.fingerprint" },
      );
      setFingerprintEnrolled(!!stored && hasHardware && isEnrolled);
    } catch (err) {
      console.warn("Fingerprint support check failed:", err);
      setFingerprintEnrolled(false);
    }
  }, []);

  useEffect(() => {
    fetchProfile();
    checkFingerprintSupport();
  }, [fetchProfile, checkFingerprintSupport]);

  const handleDataReload = async () => {
    await fetchProfile();
  };

  const handleSaveSecurity = async () => {
    if (!passwords.current) {
      return Alert.alert("Error", "Please enter your current password.");
    }
    if ((passwords.new || passwords.confirm) && !passwords.new) {
      return Alert.alert("Error", "Please enter a new password.");
    }
    if (passwords.new && passwords.new !== passwords.confirm) {
      return Alert.alert("Error", "New passwords do not match.");
    }
    if (passwords.new && passwords.new.length < 8) {
      return Alert.alert("Error", "Password must be at least 8 characters.");
    }
    if (biometricEnabled && biometricPin.length !== 6) {
      return Alert.alert(
        "Error",
        "Biometric PIN must be exactly 6 digits.",
      );
    }
    if (biometricEnabled && !fingerprintEnrolled) {
      return Alert.alert(
        "Error",
        "Please enroll a fingerprint first before enabling biometric login.",
      );
    }
    if (twoFactor && twoFactorSecret && twoFactorCode.length !== 6) {
      return Alert.alert(
        "Error",
        "Please enter a valid 6-digit code from your Authenticator App.",
      );
    }
    if (twoFactor && !twoFactorSecret) {
      return Alert.alert(
        "Error",
        "Please generate a setup key first, then scan it with your Authenticator App.",
      );
    }
    if (twoFactor && twoFactorSecret && twoFactorCode.length === 6 && !totpVerified) {
      const isValid = await verifyTotp(twoFactorCode);
      if (!isValid) {
        return Alert.alert(
          "Error",
          "The code from your Authenticator App is incorrect. Please try again.",
        );
      }
    }
    try {
      const token = await AsyncStorage.getItem("userToken");
      await AsyncStorage.setItem(
        "biometricEnabled",
        String(biometricEnabled),
      );
      if (biometricPin) {
        await SecureStore.setItemAsync(
          "biometricPin",
          biometricPin,
          { keychainService: "docuguard.biometric" },
        );
      }
      if (twoFactorSecret) {
        await SecureStore.setItemAsync(
          "twoFactorSecret",
          twoFactorSecret,
          { keychainService: "docuguard.2fa" },
        );
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

      if (biometricEnabled && !biometricPin) {
        showToast(
          "Biometric login enabled. Set your PIN in settings.",
          "info",
        );
      } else if (biometricEnabled) {
        showToast("Biometric login enabled successfully", "success");
      } else {
        showToast("Biometric login disabled", "info");
      }
      if (twoFactor && twoFactorCode) {
        showToast(
          totpVerified
            ? "2FA Authenticator App verified and enabled"
            : "2FA enabled. Verify with your Authenticator App code.",
          totpVerified ? "success" : "info",
        );
      } else if (twoFactor) {
        showToast(
          "2FA enabled. Verify with your Authenticator App code.",
          "info",
        );
      }
      setPasswords({ current: "", new: "", confirm: "" });
      setTwoFactorCode("");
    } catch (err: any) {
      Alert.alert("Error", err.response?.data?.error || err.message);
    }
  };

  const enrollFingerprint = useCallback(async () => {
    setFingerprintBusy(true);
    setFingerprintError("");
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      if (!hasHardware) {
        setFingerprintError("No biometric hardware detected on this device.");
        setFingerprintBusy(false);
        return;
      }
      if (!isEnrolled) {
        setFingerprintError("No biometrics enrolled on this device. Add one in Settings.");
        setFingerprintBusy(false);
        return;
      }
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "Authenticate to enable biometric login",
        cancelLabel: "Cancel",
        fallbackLabel: "Use Passcode",
        disableDeviceFallback: false,
      });
      if (!result.success) {
        setFingerprintError("Authentication cancelled or failed. Please try again.");
        setFingerprintBusy(false);
        return;
      }
      await SecureStore.setItemAsync(
        "docuguard.fingerprint.enrolled",
        "true",
        { requireAuthentication: true, keychainService: "docuguard.fingerprint" },
      );
      setFingerprintEnrolled(true);
      showToast("Biometric login enabled", "success");
    } catch (err: any) {
      console.error("Fingerprint enrollment error:", err);
      setFingerprintError("Could not enroll fingerprint. Please try again.");
    } finally {
      setFingerprintBusy(false);
    }
  }, []);

  const verifyFingerprint = useCallback(async (): Promise<boolean> => {
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      if (!hasHardware || !isEnrolled) return false;
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "Verify fingerprint to access DocuGuard",
        cancelLabel: "Cancel",
        fallbackLabel: "Use Passcode",
        disableDeviceFallback: false,
      });
      return !!result.success;
    } catch (err) {
      console.error("Fingerprint verification error:", err);
      return false;
    }
  }, []);

  const removeFingerprint = useCallback(() => {
    Alert.alert(
      "Disable Biometric Login",
      "This will disable biometric login for DocuGuard. You can re-enable it later.",
      [
        { text: "Cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            try {
              await SecureStore.deleteItemAsync(
                "docuguard.fingerprint.enrolled",
                { keychainService: "docuguard.fingerprint" },
              );
              setFingerprintEnrolled(false);
              showToast("Fingerprint removed", "info");
            } catch (err) {
              console.error("Remove fingerprint error:", err);
              Alert.alert("Error", "Could not remove fingerprint.");
            }
          },
        },
      ],
    );
  }, []);

  function generateTOTPSecret(): string {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    const bytes = new Uint32Array(20);
    if (typeof crypto !== "undefined" && crypto.getRandomValues) {
      crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = Math.floor(Math.random() * 0xffffffff);
      }
    }
    return base32Encode(bytes);
  }

  function base32Encode(buffer: Uint32Array): string {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let bits = 0;
    let value = 0;
    let output = "";
    for (let i = 0; i < buffer.length; i++) {
      value = (value << 8) | (buffer[i] & 0xff);
      bits += 8;
      while (bits >= 5) {
        output += chars[(value >> (bits - 5)) & 0x1f];
        bits -= 5;
      }
    }
    if (bits > 0) {
      output += chars[(value << (5 - bits)) & 0x1f];
    }
    return output;
  }

  // Client-side TOTP verification (for immediate feedback before backend verification)
  async function verifyTotp(code: string): Promise<boolean> {
    if (code.length !== 6 || !/^\d{6}$/.test(code)) return false;
    try {
      const secret = await SecureStore.getItemAsync("twoFactorSecret", {
        keychainService: "docuguard.2fa",
      });
      if (!secret) return false;
      return verifyTotpWithSecret(secret, code);
    } catch {
      return false;
    }
  }

  function verifyTotpWithSecret(secret: string, code: string, window = 1): boolean {
    const key = base32Decode(secret);
    const counter = Math.floor(Date.now() / 1000 / 30);
    for (let i = -window; i <= window; i++) {
      const buf = new DataView(new ArrayBuffer(8));
      buf.setUint32(0, Math.floor((counter + i) / 0x100000000), false);
      buf.setUint32(4, (counter + i) >>> 0, false);
      const hash = hmacSha1(key, new Uint8Array(buf.buffer));
      const offset = hash[hash.length - 1] & 0x0f;
      const binary =
        ((hash[offset] & 0x7f) << 24) |
        ((hash[offset + 1] & 0xff) << 16) |
        ((hash[offset + 2] & 0xff) << 8) |
        (hash[offset + 3] & 0xff);
      const expected = String(binary % 1000000).padStart(6, "0");
      if (expected === code) return true;
    }
    return false;
  }

  function base32Decode(secret: string): Uint8Array {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let bits = 0;
    let value = 0;
    const output: number[] = [];
    for (let i = 0; i < secret.length; i++) {
      const idx = chars.indexOf(secret.charAt(i).toUpperCase());
      if (idx === -1) continue;
      value = (value << 5) | idx;
      bits += 5;
      while (bits >= 8) {
        output.push((value >> (bits - 8)) & 0xff);
        bits -= 8;
      }
    }
    return new Uint8Array(output);
  }

  function hmacSha1(key: Uint8Array, message: Uint8Array): Uint8Array {
    const blockSize = 64;
    const keyPadded = new Uint8Array(blockSize);
    keyPadded.set(key.length > blockSize ? new Uint8Array(sha1(key)) : key);
    const ipad = new Uint8Array(blockSize).fill(0x36);
    const opad = new Uint8Array(blockSize).fill(0x5c);
    const inner = new Uint8Array(blockSize + message.length);
    const outer = new Uint8Array(blockSize + 20);
    for (let i = 0; i < blockSize; i++) {
      inner[i] = keyPadded[i] ^ ipad[i];
      outer[i] = keyPadded[i] ^ opad[i];
    }
    inner.set(message, blockSize);
    const innerHash = sha1(inner);
    outer.set(innerHash, blockSize);
    return sha1(outer);
  }

  function sha1(message: Uint8Array): Uint8Array {
    const ml = message.length * 8;
    const withOne = new Uint8Array(message.length + 1);
    withOne.set(message);
    withOne[message.length] = 0x80;
    const totalLen = ((withOne.length + 8) / 64) * 64;
    const padded = new Uint8Array(totalLen);
    padded.set(withOne);
    const view = new DataView(padded.buffer);
    view.setUint32(totalLen - 4, ml >>> 0, false);

    const h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
    const rot = (x: number, n: number) => ((x << n) | (x >>> (32 - n))) >>> 0;

    for (let i = 0; i < padded.length; i += 64) {
      const w = new Uint32Array(80);
      for (let j = 0; j < 16; j++) {
        w[j] = view.getUint32(i + j * 4, false);
      }
      for (let j = 16; j < 80; j++) {
        w[j] = rot(w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16], 1);
      }
      let a = h[0];
      let b = h[1];
      let c = h[2];
      let d = h[3];
      let e = h[4];
      for (let j = 0; j < 80; j++) {
        let f: number;
        let k: number;
        if (j < 20) {
          f = (b & c) | (~b & d);
          k = 0x5a827999;
        } else if (j < 40) {
          f = b ^ c ^ d;
          k = 0x6ed9eba1;
        } else if (j < 60) {
          f = (b & c) | (b & d) | (c & d);
          k = 0x8f1bbcdc;
        } else {
          f = b ^ c ^ d;
          k = 0xca62c1d6;
        }
        const tmp = (rot(a, 5) + f + e + k + w[j]) >>> 0;
        e = d;
        d = c;
        c = rot(b, 30);
        b = a;
        a = tmp;
      }
      h[0] = (h[0] + a) >>> 0;
      h[1] = (h[1] + b) >>> 0;
      h[2] = (h[2] + c) >>> 0;
      h[3] = (h[3] + d) >>> 0;
      h[4] = (h[4] + e) >>> 0;
    }
    const out = new Uint8Array(20);
    const oview = new DataView(out.buffer);
    for (let i = 0; i < 5; i++) {
      oview.setUint32(i * 4, h[i], false);
    }
    return out;
  }

  const handleSavePreferences = async (
    email: boolean,
    push: boolean,
    expiry: boolean,
  ) => {
    const previous = { email: notifyEmail, push: notifyPush, expiry: notifyExpiry };
    setNotifyEmail(email);
    setNotifyPush(push);
    setNotifyExpiry(expiry);
    setSavingNotifications(true);

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
      showToast("Notification preferences updated", "success");
    } catch (err) {
      setNotifyEmail(previous.email);
      setNotifyPush(previous.push);
      setNotifyExpiry(previous.expiry);
      showToast(getApiErrorMessage(err, "Could not update notification preferences"), "error");
    } finally {
      setSavingNotifications(false);
    }
  };

  const handleSavePersonalInfo = async () => {
    if (!personalInfo.name.trim()) {
      return Alert.alert("Error", "Please enter your name.");
    }
    if (!personalInfo.email.trim()) {
      return Alert.alert("Error", "Please enter your email.");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(personalInfo.email.trim())) {
      return Alert.alert("Error", "Please enter a valid email address.");
    }

    setSavingPersonal(true);
    try {
      const token = await AsyncStorage.getItem("userToken");
      const res = await api.client.patch(
        "/profile",
        {
          name: personalInfo.name.trim(),
          email: personalInfo.email.trim(),
        },
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      if (res.status !== 200 && res.status !== 201) {
        throw new Error(res.data?.error || "Failed to update profile");
      }

      setUser((prev) => ({
        ...prev,
        name: personalInfo.name.trim(),
        email: personalInfo.email.trim(),
      }));
      showToast("Personal information updated", "success");
    } catch (err: any) {
      Alert.alert("Error", err.response?.data?.error || err.message);
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
      console.error("Failed to fetch login sessions:", err);
    } finally {
      setLoadingSessions(false);
    }
  }, []);

  const revokeSession = (sessionId: string) => {
    const session = loginSessions.find((s) => s.id === sessionId);
    if (!session) return;
    setShowingSessionRevoke(sessionId);
    Alert.alert(
      "Revoke Session?",
      `${session.device}\n${session.browser} · ${session.location}\n\nThis device will be signed out.`,
      [
        { text: "Cancel", onPress: () => setShowingSessionRevoke(null) },
        {
          text: "Revoke",
          style: "destructive",
          onPress: async () => {
            setShowingSessionRevoke(null);
            setRevokingSessionId(sessionId);
            try {
              const token = await AsyncStorage.getItem("userToken");
              if (!token) return;
              await api.client.delete(`/auth/sessions/${sessionId}`, {
                headers: { Authorization: `Bearer ${token}` },
              });
              showToast("Session revoked", "success");
              fetchLoginSessions();
            } catch (err: any) {
              showToast(getApiErrorMessage(err, "Failed to revoke session"), "error");
            } finally {
              setRevokingSessionId(null);
            }
          },
        },
      ],
    );
  };

  const revokeAllOtherSessions = () => {
    const otherCount = loginSessions.filter((s) => !s.current).length;
    if (otherCount === 0) return;
    setShowingRevokeAll(true);
    Alert.alert(
      "Revoke All Other Sessions?",
      `${otherCount} other session(s) will be signed out.`,
      [
        { text: "Cancel", onPress: () => setShowingRevokeAll(false) },
        {
          text: "Revoke All",
          style: "destructive",
          onPress: async () => {
            setShowingRevokeAll(false);
            setRevokingAllSessions(true);
            try {
              const token = await AsyncStorage.getItem("userToken");
              if (!token) return;
              await api.client.delete("/auth/sessions", {
                headers: { Authorization: `Bearer ${token}` },
              });
              showToast("All other sessions revoked", "success");
              fetchLoginSessions();
            } catch (err: any) {
              showToast(getApiErrorMessage(err, "Failed to revoke sessions"), "error");
            } finally {
              setRevokingAllSessions(false);
            }
          },
        },
      ],
    );
  };

  const handleSaveDocPreferences = async () => {
    setSavingDocPrefs(true);
    try {
      const token = await AsyncStorage.getItem("userToken");
      await api.client.patch(
        "/profile/preferences",
        {
          documentPreferences: docPreferences,
        },
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      showToast("Document preferences saved", "success");
    } catch (err: any) {
      Alert.alert("Error", err.response?.data?.error || err.message);
    } finally {
      setSavingDocPrefs(false);
    }
  };

  const handleSaveAppearance = async () => {
    setSavingAppearance(true);
    try {
      const token = await AsyncStorage.getItem("userToken");
      await api.client.patch(
        "/profile/appearance",
        appearance,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      showToast("Appearance settings saved", "success");
    } catch (err: any) {
      Alert.alert("Error", err.response?.data?.error || err.message);
    } finally {
      setSavingAppearance(false);
    }
  };

  const handleSavePrivacy = async () => {
    setSavingPrivacy(true);
    try {
      const token = await AsyncStorage.getItem("userToken");
      await api.client.patch(
        "/profile/privacy",
        privacy,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      showToast("Privacy settings saved", "success");
    } catch (err: any) {
      Alert.alert("Error", err.response?.data?.error || err.message);
    } finally {
      setSavingPrivacy(false);
    }
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      "Delete Account",
      "This will permanently delete your account and all data. This action cannot be undone.\n\nType DELETE to confirm:",
      [
        { text: "Cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            Alert.prompt(
              "Confirm Deletion",
              "Type DELETE to permanently delete your account",
              [
                { text: "Cancel" },
                {
                  text: "Delete",
                  style: "destructive",
                  onPress: (text?: string) => {
                    if (text !== "DELETE") {
                      Alert.alert("Error", "Confirmation text must be exactly 'DELETE'");
                      return;
                    }
                    (async () => {
                      setDeletingAccount(true);
                      try {
                        const token = await AsyncStorage.getItem("userToken");
                        await api.client.delete("/profile", {
                          headers: { Authorization: `Bearer ${token}` },
                        });
                      await AsyncStorage.removeItem("userToken");
                      await SecureStore.deleteItemAsync("userToken").catch(() => {});
                      router.replace("/login" as any);
                    } catch (err: any) {
                      showToast(getApiErrorMessage(err, "Failed to delete account"), "error");
                    } finally {
                      setDeletingAccount(false);
                    }
                  })();
                  },
                },
              ],
              "plain-text",
              "",
            );
          },
        },
      ],
    );
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
    setCloudExporting(true);
    try {
      const res = await api.cloud.exportData();
      showToast("Documents exported to cloud backup successfully.");
    } catch (err: any) {
      showToast(getApiErrorMessage(err, "Could not export data to cloud"), "error");
    } finally {
      setCloudExporting(false);
    }
  };

  const handleLocalBackup = async () => {
    setBackingUp(true);
    try {
      showToast("Preparing your backup...");
      await exportLocalBackup();
      showToast("Local backup created", "success");
    } catch (err: any) {
      showToast(getApiErrorMessage(err, "Could not create local backup"), "error");
    } finally {
      setBackingUp(false);
    }
  };

  const handleExportData = async () => {
    setExportingData(true);
    try {
      const token = await AsyncStorage.getItem("userToken");
      const res = await api.client.get("/profile/export", {
        headers: { Authorization: `Bearer ${token}` },
        responseType: "blob",
      });
      showToast("Data export prepared", "success");
    } catch (err: any) {
      showToast(getApiErrorMessage(err, "Failed to export data"), "error");
    } finally {
      setExportingData(false);
    }
  };

  const handleLogout = () => {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel" },
      {
        text: "Sign Out",
        onPress: async () => {
          setLoggingOut(true);
          try {
            await AsyncStorage.removeItem("userToken");
            await SecureStore.deleteItemAsync("userToken").catch(() => {});
            router.replace("/login" as any);
          } catch (err: any) {
            showToast(getApiErrorMessage(err, "Failed to sign out"), "error");
          } finally {
            setLoggingOut(false);
          }
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
                icon="person"
                title="Personal Information"
                subtitle="Manage your saved personal details"
                isActive={activeTab === "personal"}
                onPress={() => toggleTab("personal")}
              />
              {activeTab === "personal" && (
                <View style={styles.expandedContent}>
                  <TextInput
                    style={styles.input}
                    placeholder="Full Name"
                    placeholderTextColor="#999"
                    value={personalInfo.name}
                    onChangeText={(t) =>
                      setPersonalInfo({ ...personalInfo, name: t })
                    }
                    autoCapitalize="words"
                    autoCorrect={false}
                    autoComplete="name"
                    textContentType="name"
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="Email Address"
                    placeholderTextColor="#999"
                    value={personalInfo.email}
                    onChangeText={(t) =>
                      setPersonalInfo({ ...personalInfo, email: t })
                    }
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="email"
                    textContentType="emailAddress"
                  />
                  <TouchableOpacity
                    style={styles.primaryButton}
                    onPress={handleSavePersonalInfo}
                    disabled={savingPersonal}
                  >
                    <Text style={styles.buttonText}>
                      {savingPersonal ? "Saving..." : "Save Changes"}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

              <SettingRow
                icon="lock-closed"
                title="Account Security"
                subtitle="Password, biometrics, login sessions"
                isActive={activeTab === "security"}
                onPress={() => {
                  toggleTab("security");
                  fetchLoginSessions();
                }}
              />
              {activeTab === "security" && (
                <View style={styles.expandedContent}>
                  <View style={styles.passwordInputWrapper}>
                    <TextInput
                      style={[styles.input, { paddingRight: 48 }]}
                      placeholder="Current Password"
                      placeholderTextColor="#999"
                      secureTextEntry={!showCurrentPassword}
                      value={passwords.current}
                      onChangeText={(t) =>
                        setPasswords({ ...passwords, current: t })
                      }
                      autoCorrect={false}
                      autoComplete="current-password"
                      textContentType="password"
                    />
                    <TouchableOpacity
                      style={styles.passwordToggle}
                      onPress={() => setShowCurrentPassword(!showCurrentPassword)}
                      accessibilityLabel={showCurrentPassword ? "Hide current password" : "Show current password"}
                    >
                      <Ionicons name={showCurrentPassword ? "eye-off" : "eye"} size={22} color={COLORS.textSecondary} />
                    </TouchableOpacity>
                  </View>
                  <View style={styles.passwordInputWrapper}>
                    <TextInput
                      style={[styles.input, { paddingRight: 48 }]}
                      placeholder="New Password (min 8 chars)"
                      placeholderTextColor="#999"
                      secureTextEntry={!showNewPassword}
                      value={passwords.new}
                      onChangeText={(t) => setPasswords({ ...passwords, new: t })}
                      autoCorrect={false}
                      autoComplete="new-password"
                      textContentType="newPassword"
                    />
                    <TouchableOpacity
                      style={styles.passwordToggle}
                      onPress={() => setShowNewPassword(!showNewPassword)}
                      accessibilityLabel={showNewPassword ? "Hide new password" : "Show new password"}
                    >
                      <Ionicons name={showNewPassword ? "eye-off" : "eye"} size={22} color={COLORS.textSecondary} />
                    </TouchableOpacity>
                  </View>
                  <View style={styles.passwordInputWrapper}>
                    <TextInput
                      style={[styles.input, { paddingRight: 48 }]}
                      placeholder="Confirm New Password"
                      placeholderTextColor="#999"
                      secureTextEntry={!showConfirmPassword}
                      value={passwords.confirm}
                      onChangeText={(t) =>
                        setPasswords({ ...passwords, confirm: t })
                      }
                      autoCorrect={false}
                      autoComplete="new-password"
                      textContentType="newPassword"
                    />
                    <TouchableOpacity
                      style={styles.passwordToggle}
                      onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                      accessibilityLabel={showConfirmPassword ? "Hide confirm password" : "Show confirm password"}
                    >
                      <Ionicons name={showConfirmPassword ? "eye-off" : "eye"} size={22} color={COLORS.textSecondary} />
                    </TouchableOpacity>
                  </View>
                  <View style={styles.switchRow}>
                    <Text style={{ fontSize: 14 }}>Enable 2FA (Authenticator App)</Text>
                    <Switch
                      value={twoFactor}
                      onValueChange={(val) => {
                        setTwoFactor(val);
                        setTotpVerified(false);
                        if (!val) {
                          setTwoFactorCode("");
                          setTwoFactorSecret("");
                          SecureStore.deleteItemAsync("twoFactorSecret", {
                            keychainService: "docuguard.2fa",
                          }).catch(() => {});
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
                          setTwoFactorCode("");
                          setTotpVerified(false);
                          SecureStore.setItemAsync("twoFactorSecret", secret, {
                            keychainService: "docuguard.2fa",
                          }).catch(() => {});
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
                    <View>
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
                          setTotpVerified(false);
                        }}
                        autoCorrect={false}
                      />
                      <TouchableOpacity
                        style={styles.secondaryButton}
                        onPress={async () => {
                          if (twoFactorCode.length !== 6) {
                            return Alert.alert(
                              "Error",
                              "Please enter a 6-digit code first.",
                            );
                          }
                          const isValid = await verifyTotp(twoFactorCode);
                          if (isValid) {
                            setTotpVerified(true);
                            showToast("Code verified", "success");
                          } else {
                            Alert.alert(
                              "Error",
                              "The code is incorrect. Check your Authenticator App.",
                            );
                          }
                        }}
                      >
                        <Text style={styles.secondaryButtonText}>
                          {totpVerified ? "Verified" : "Verify Code"}
                        </Text>
                      </TouchableOpacity>
                      {totpVerified && (
                        <View style={styles.verifiedBadge}>
                          <Ionicons
                            name="checkmark-circle"
                            size={14}
                            color={COLORS.success}
                          />
                          <Text style={styles.verifiedText}>
                            Authenticator App verified
                          </Text>
                        </View>
                      )}
                    </View>
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
                        if (val && !fingerprintEnrolled) {
                          setBiometricEnabled(false);
                          setShowFingerprintModal(true);
                          return;
                        }
                        setBiometricEnabled(val);
                        if (!val) {
                          setBiometricPin("");
                          removeFingerprint();
                          AsyncStorage.removeItem("biometricPin").catch(() => {});
                        }
                      }}
                      trackColor={{ true: COLORS.primary }}
                    />
                  </View>
                  {biometricEnabled && (
                    <View>
                      <View style={styles.passwordInputWrapper}>
                        <TextInput
                          style={[styles.input, { paddingRight: 48 }]}
                          placeholder="Set a PIN for biometric fallback"
                          placeholderTextColor="#999"
                          secureTextEntry={!showBiometricPin}
                          value={biometricPin}
                          onChangeText={(t) => {
                            const clean = t.replace(/[^0-9]/g, "").slice(0, 6);
                            setBiometricPin(clean);
                          }}
                          keyboardType="number-pad"
                          maxLength={6}
                          autoCorrect={false}
                        />
                        <TouchableOpacity
                          style={styles.passwordToggle}
                          onPress={() => setShowBiometricPin(!showBiometricPin)}
                          accessibilityLabel={showBiometricPin ? "Hide PIN" : "Show PIN"}
                        >
                          <Ionicons name={showBiometricPin ? "eye-off" : "eye"} size={22} color={COLORS.textSecondary} />
                        </TouchableOpacity>
                      </View>
                      <View style={styles.fingerprintStatusRow}>
                        <Ionicons
                          name={fingerprintEnrolled ? "finger-print" : "finger-print-outline"}
                          size={18}
                          color={fingerprintEnrolled ? COLORS.success : COLORS.textSecondary}
                        />
                        <Text style={styles.fingerprintStatusText}>
                          {fingerprintEnrolled
                            ? "Biometric login enabled"
                            : "No biometrics enrolled yet"}
                        </Text>
                      </View>
                      {fingerprintEnrolled ? (
                        <TouchableOpacity
                          style={[styles.secondaryButton, { marginTop: 8 }]}
                          onPress={removeFingerprint}
                        >
                          <Text style={styles.secondaryButtonText}>
                            Disable Biometric Login
                          </Text>
                        </TouchableOpacity>
                      ) : (
                        <TouchableOpacity
                          style={[styles.primaryButton, { marginTop: 8 }]}
                          onPress={enrollFingerprint}
                          disabled={fingerprintBusy}
                        >
                          <Text style={styles.buttonText}>
                            {fingerprintBusy ? "Enabling…" : "Enable Biometric Login"}
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  )}

                  <View style={styles.sectionDivider} />
                  <Text style={styles.subsectionTitle}>Login Sessions</Text>
                  {loadingSessions ? (
                    <View style={styles.loadingSessions}>
                      <ActivityIndicator size="small" color={COLORS.primary} />
                      <Text style={styles.loadingText}>Loading sessions...</Text>
                    </View>
                  ) : loginSessions.length === 0 ? (
                    <View style={styles.emptySessions}>
                      <Ionicons name="phone-portrait" size={32} color={COLORS.textSecondary} />
                      <Text style={styles.emptySessionsText}>No active sessions found</Text>
                    </View>
                  ) : (
                    <View style={styles.sessionsList}>
                      {loginSessions.map((session) => (
                        <View key={session.id} style={styles.sessionCard}>
                          <View style={styles.sessionInfo}>
                            <View style={styles.sessionDeviceIcon}>
                              <Ionicons
                                name={session.device.includes("Mobile") ? "phone-portrait" : "desktop"}
                                size={24}
                                color={session.current ? COLORS.primary : COLORS.textSecondary}
                              />
                            </View>
                            <View style={styles.sessionDetails}>
                              <View style={styles.sessionHeader}>
                                <Text style={styles.sessionDevice}>
                                  {session.device}
                                  {session.current && (
                                    <Text style={styles.currentBadge}>Current</Text>
                                  )}
                                </Text>
                              </View>
                              <Text style={styles.sessionMeta}>
                                {session.browser} · {session.location}
                              </Text>
                              <Text style={styles.sessionMeta}>
                                Last active: {new Date(session.lastActive).toLocaleString()}
                              </Text>
                            </View>
                          </View>
                          {!session.current && (
                            <TouchableOpacity
                              style={styles.revokeButton}
                              onPress={() => revokeSession(session.id)}
                              disabled={revokingSessionId === session.id}
                              accessibilityLabel={`Revoke session on ${session.device}`}
                            >
                              {revokingSessionId === session.id ? (
                                <ActivityIndicator size="small" color={COLORS.danger} />
                              ) : (
                                <Ionicons name="log-out" size={18} color={COLORS.danger} />
                              )}
                            </TouchableOpacity>
                          )}
                        </View>
                      ))}
                      {loginSessions.filter((s) => !s.current).length > 0 && (
                        <TouchableOpacity
                          style={styles.revokeAllButton}
                          onPress={revokeAllOtherSessions}
                          disabled={revokingAllSessions}
                        >
                          {revokingAllSessions ? (
                            <ActivityIndicator size="small" color={COLORS.danger} />
                          ) : (
                            <Text style={styles.revokeAllText}>Revoke All Other Sessions</Text>
                          )}
                        </TouchableOpacity>
                      )}
                    </View>
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
                      disabled={savingNotifications}
                    />
                  </View>
                  <View style={styles.switchRow}>
                    <Text style={{ fontSize: 14 }}>Push Notifications</Text>
                    <Switch
                      value={notifyPush}
                      onValueChange={(val) =>
                        handleSavePreferences(notifyEmail, val, notifyExpiry)
                      }
                      disabled={savingNotifications}
                    />
                  </View>
                  <View style={styles.switchRow}>
                    <Text style={{ fontSize: 14 }}>Expiry Alerts</Text>
                    <Switch
                      value={notifyExpiry}
                      onValueChange={(val) =>
                        handleSavePreferences(notifyEmail, notifyPush, val)
                      }
                      disabled={savingNotifications}
                    />
                  </View>
                </View>
              )}

              <SettingRow
                icon="document-text"
                title="Document Preferences"
                subtitle="Document and reminder behavior"
                isActive={activeTab === "documents"}
                onPress={() => toggleTab("documents")}
              />
              {activeTab === "documents" && (
                <View style={styles.expandedContent}>
                  <View style={styles.switchRow}>
                    <Text style={{ fontSize: 14 }}>Auto Scan Documents</Text>
                    <Switch
                      value={docPreferences.autoScan}
                      onValueChange={(val) =>
                        setDocPreferences({ ...docPreferences, autoScan: val })
                      }
                    />
                  </View>
                  <View style={styles.switchRow}>
                    <Text style={{ fontSize: 14 }}>Auto Categorize</Text>
                    <Switch
                      value={docPreferences.autoCategorize}
                      onValueChange={(val) =>
                        setDocPreferences({ ...docPreferences, autoCategorize: val })
                      }
                    />
                  </View>
                  <View style={styles.settingRow}>
                    <Text style={{ fontSize: 14 }}>Expiry Reminder (days before)</Text>
                    <View style={styles.selectWrapper}>
                      <TextInput
                        style={[styles.input, { width: 100, textAlign: "center" }]}
                        placeholder="30"
                        keyboardType="number-pad"
                        value={String(docPreferences.expiryReminderDays)}
                        onChangeText={(t) => {
                          const clean = t.replace(/[^0-9]/g, "").slice(0, 3);
                          const days = Math.min(365, Math.max(1, parseInt(clean) || 30));
                          setDocPreferences({
                            ...docPreferences,
                            expiryReminderDays: days,
                          });
                        }}
                        autoCorrect={false}
                      />
                    </View>
                  </View>
                  <View style={styles.settingRow}>
                    <Text style={{ fontSize: 14 }}>Default Category</Text>
                    <View style={styles.selectWrapper}>
                      <TextInput
                        style={[styles.input, { width: 140 }]}
                        placeholder="other"
                        value={docPreferences.defaultCategory}
                        onChangeText={(t) =>
                          setDocPreferences({ ...docPreferences, defaultCategory: t.toLowerCase() })
                        }
                        autoCapitalize="words"
                        autoCorrect={false}
                      />
                    </View>
                  </View>
                  <View style={styles.settingRow}>
                    <Text style={{ fontSize: 14 }}>Sort By</Text>
                    <View style={styles.selectWrapper}>
                      <TextInput
                        style={[styles.input, { width: 140 }]}
                        placeholder="expiry"
                        value={docPreferences.sortBy}
                        onChangeText={(t) => {
                          const validSortBy = ["expiry", "name", "category", "createdAt"];
                          if (validSortBy.includes(t)) {
                            setDocPreferences({ ...docPreferences, sortBy: t });
                          }
                        }}
                        autoCorrect={false}
                        editable={false}
                        onFocus={() => {
                          // Could show a picker modal here
                        }}
                      />
                    </View>
                  </View>
                  <View style={styles.settingRow}>
                    <Text style={{ fontSize: 14 }}>Sort Order</Text>
                    <View style={styles.selectWrapper}>
                      <TextInput
                        style={[styles.input, { width: 100 }]}
                        placeholder="asc"
                        value={docPreferences.sortOrder}
                        onChangeText={(t) => {
                          const validSortOrder = ["asc", "desc"];
                          if (validSortOrder.includes(t)) {
                            setDocPreferences({ ...docPreferences, sortOrder: t });
                          }
                        }}
                        autoCorrect={false}
                        editable={false}
                      />
                    </View>
                  </View>
                  <TouchableOpacity
                    style={styles.primaryButton}
                    onPress={handleSaveDocPreferences}
                    disabled={savingDocPrefs}
                  >
                    <Text style={styles.buttonText}>
                      {savingDocPrefs ? "Saving..." : "Save Changes"}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

              <SettingRow
                icon="cloud"
                title="Cloud Sync & Backup"
                subtitle="Sync, backup and data export"
                isActive={activeTab === "sync"}
                onPress={() => toggleTab("sync")}
              />
              {activeTab === "sync" && (
                <View style={styles.expandedContent}>
                  <Text style={styles.subsectionTitle}>Cloud Backup</Text>
                  <TouchableOpacity
                    style={styles.primaryButton}
                    onPress={handleExportToCloud}
                    disabled={cloudExporting}
                  >
                    {cloudExporting ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <Text style={styles.buttonText}>Export to Cloud</Text>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.primaryButton, { backgroundColor: COLORS.textMuted, marginTop: 12 }]}
                    onPress={handleLocalBackup}
                    disabled={backingUp}
                  >
                    {backingUp ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <>
                        <Ionicons name="download-outline" size={20} color="white" />
                        <Text style={styles.buttonText}>Export Local Backup</Text>
                      </>
                    )}
                  </TouchableOpacity>
                  <View style={styles.sectionDivider} />
                  <Text style={styles.subsectionTitle}>Data Export</Text>
                  <TouchableOpacity
                    style={styles.primaryButton}
                    onPress={handleExportData}
                    disabled={exportingData}
                  >
                    {exportingData ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <Text style={styles.buttonText}>Export All Data (JSON)</Text>
                    )}
                  </TouchableOpacity>
                </View>
              )}

              <SettingRow
                icon="palette"
                title="Appearance"
                subtitle="Theme and display preferences"
                isActive={activeTab === "appearance"}
                onPress={() => toggleTab("appearance")}
              />
              {activeTab === "appearance" && (
                <View style={styles.expandedContent}>
                  <View style={styles.settingRow}>
                    <Text style={{ fontSize: 14 }}>Theme</Text>
                    <View style={styles.selectWrapper}>
                      <TextInput
                        style={[styles.input, { width: 120 }]}
                        placeholder="system"
                        value={appearance.theme}
                        onChangeText={(t) => {
                          const validThemes = ["system", "light", "dark"];
                          if (validThemes.includes(t)) {
                            setAppearance({ ...appearance, theme: t });
                          }
                        }}
                        autoCorrect={false}
                      />
                    </View>
                  </View>
                  <View style={styles.settingRow}>
                    <Text style={{ fontSize: 14 }}>Font Size</Text>
                    <View style={styles.selectWrapper}>
                      <TextInput
                        style={[styles.input, { width: 120 }]}
                        placeholder="medium"
                        value={appearance.fontSize}
                        onChangeText={(t) => {
                          const validSizes = ["small", "medium", "large"];
                          if (validSizes.includes(t)) {
                            setAppearance({ ...appearance, fontSize: t });
                          }
                        }}
                        autoCorrect={false}
                      />
                    </View>
                  </View>
                  <View style={styles.switchRow}>
                    <Text style={{ fontSize: 14 }}>Reduce Motion</Text>
                    <Switch
                      value={appearance.reducedMotion}
                      onValueChange={(val) =>
                        setAppearance({ ...appearance, reducedMotion: val })
                      }
                    />
                  </View>
                  <TouchableOpacity
                    style={styles.primaryButton}
                    onPress={handleSaveAppearance}
                    disabled={savingAppearance}
                  >
                    <Text style={styles.buttonText}>
                      {savingAppearance ? "Saving..." : "Save Changes"}
                    </Text>
                  </TouchableOpacity>
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

              <SettingRow
                icon="shield-checkmark"
                title="Privacy & Data"
                subtitle="Manage your data and privacy"
                isActive={activeTab === "privacy"}
                onPress={() => toggleTab("privacy")}
              />
              {activeTab === "privacy" && (
                <View style={styles.expandedContent}>
                  <View style={styles.switchRow}>
                    <Text style={{ fontSize: 14 }}>Analytics Collection</Text>
                    <Switch
                      value={privacy.analytics}
                      onValueChange={(val) =>
                        setPrivacy({ ...privacy, analytics: val })
                      }
                    />
                  </View>
                  <View style={styles.switchRow}>
                    <Text style={{ fontSize: 14 }}>Crash Reports</Text>
                    <Switch
                      value={privacy.crashReports}
                      onValueChange={(val) =>
                        setPrivacy({ ...privacy, crashReports: val })
                      }
                    />
                  </View>
                  <View style={styles.switchRow}>
                    <Text style={{ fontSize: 14 }}>Data Sharing for Improvements</Text>
                    <Switch
                      value={privacy.dataSharing}
                      onValueChange={(val) =>
                        setPrivacy({ ...privacy, dataSharing: val })
                      }
                    />
                  </View>
                  <View style={styles.sectionDivider} />
                  <Text style={styles.subsectionTitle}>Data Management</Text>
                  <TouchableOpacity
                    style={styles.primaryButton}
                    onPress={handleExportData}
                    disabled={exportingData}
                  >
                    {exportingData ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <Text style={styles.buttonText}>Export My Data</Text>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.primaryButton, { backgroundColor: COLORS.danger, marginTop: 12 }]}
                    onPress={handleDeleteAccount}
                    disabled={deletingAccount}
                  >
                    {deletingAccount ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <Text style={styles.buttonText}>Delete Account</Text>
                    )}
                  </TouchableOpacity>
                </View>
              )}
            </Card>
          </View>

          <TouchableOpacity style={styles.signOutButton} onPress={handleLogout} disabled={loggingOut}>
            <View style={styles.signOutButtonContent}>
              {loggingOut ? (
                <ActivityIndicator color={COLORS.danger} size="small" />
              ) : (
                <Ionicons name="log-out" size={20} color={COLORS.danger} />
              )}
              <Text style={[styles.actionButtonText, { color: COLORS.danger }]}>
                {loggingOut ? "Signing Out..." : "Sign Out"}
              </Text>
            </View>
          </TouchableOpacity>

          <Text style={styles.version}>DocuGuard v1.0.0</Text>
        </RefreshableContainer>

      <Modal
        visible={showFingerprintModal}
        animationType="slide"
        transparent
        presentationStyle="overFullScreen"
        onRequestClose={() => {
          if (!fingerprintBusy) setShowFingerprintModal(false);
        }}
      >
        <View style={styles.fingerprintModalOverlay}>
          <View style={styles.fingerprintModalCard}>
            <View style={styles.fingerprintIconRing}>
              <Ionicons
                name="finger-print"
                size={48}
                color={COLORS.primary}
              />
            </View>
            <Text style={styles.fingerprintModalTitle}>Enable Biometric Login</Text>
            <Text style={styles.fingerprintModalSubtitle}>
              DocuGuard uses your device's built-in biometric authentication.
              Your fingerprint or Face ID data is managed by the operating system
              and is not accessible to DocuGuard.
            </Text>
            {fingerprintError ? (
              <Text style={styles.fingerprintErrorText}>{fingerprintError}</Text>
            ) : null}
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={enrollFingerprint}
              disabled={fingerprintBusy}
            >
              {fingerprintBusy ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.buttonText}>Enable Biometric Login</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.fingerprintModalCancel}
              onPress={() => {
                if (!fingerprintBusy) setShowFingerprintModal(false);
              }}
            >
              <Text style={styles.fingerprintModalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

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
    color: COLORS.text,
  },
  primaryButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    height: 48,
    justifyContent: "center",
    alignItems: "center",
  },
  secondaryButton: {
    backgroundColor: "#F3F4F6",
    borderRadius: 12,
    height: 44,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 8,
  },
  secondaryButtonText: {
    color: "#374151",
    fontWeight: "700",
    fontSize: 14,
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
  verifiedBadge: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 8,
    paddingVertical: 6,
    backgroundColor: `${COLORS.success}15`,
    borderRadius: 8,
  },
  verifiedText: {
    fontSize: 12,
    fontWeight: "700",
    color: COLORS.success,
  },
  fingerprintStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
    paddingHorizontal: 4,
  },
  fingerprintStatusText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    fontWeight: "500",
  },
  fingerprintModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  fingerprintModalCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 24,
    padding: 28,
    alignItems: "center",
    maxWidth: 360,
    width: "100%",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.3,
    shadowRadius: 24,
    elevation: 12,
  },
  fingerprintIconRing: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: `${COLORS.primary}15`,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
    borderWidth: 2,
    borderColor: `${COLORS.primary}30`,
  },
  fingerprintModalTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: COLORS.text,
    marginBottom: 8,
  },
  fingerprintModalSubtitle: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 16,
  },
  fingerprintErrorText: {
    fontSize: 13,
    color: COLORS.danger,
    textAlign: "center",
    marginBottom: 12,
    fontWeight: "600",
  },
  fingerprintModalCancel: {
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  fingerprintModalCancelText: {
    color: COLORS.textSecondary,
    fontSize: 15,
    fontWeight: "600",
  },
  sectionDivider: {
    height: 1,
    backgroundColor: "#E5E7EB",
    marginVertical: 16,
  },
  subsectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.text,
    marginBottom: 12,
    marginLeft: 4,
  },
  passwordInputWrapper: {
    position: "relative",
    flexDirection: "row",
    alignItems: "center",
  },
  passwordToggle: {
    position: "absolute",
    right: 16,
    padding: 8,
  },
  selectWrapper: {
    flexDirection: "row",
    alignItems: "center",
  },
  loadingSessions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 16,
  },
  loadingText: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  emptySessions: {
    alignItems: "center",
    paddingVertical: 24,
  },
  emptySessionsText: {
    marginTop: 8,
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  sessionsList: { gap: 12 },
  sessionCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  sessionInfo: { flex: 1, flexDirection: "row", gap: 12 },
  sessionDeviceIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: `${COLORS.primary}10`,
    justifyContent: "center",
    alignItems: "center",
  },
  sessionDetails: { flex: 1, justifyContent: "center" },
  sessionHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  sessionDevice: {
    fontSize: 15,
    fontWeight: "600",
    color: COLORS.text,
  },
  currentBadge: {
    fontSize: 10,
    fontWeight: "700",
    color: "#fff",
    backgroundColor: COLORS.primary,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  sessionMeta: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  revokeButton: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: `${COLORS.danger}10`,
  },
  revokeAllButton: {
    marginTop: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.danger,
    backgroundColor: `${COLORS.danger}08`,
    alignItems: "center",
  },
  revokeAllText: {
    color: COLORS.danger,
    fontWeight: "700",
    fontSize: 14,
  },
});
