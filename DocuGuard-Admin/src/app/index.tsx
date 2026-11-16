import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import {
  adminLogin,
  createAdminChallenge,
  enrollAdminDevice,
  verifyAdminDevice,
} from "../services/adminApi";
import {
  prepareAdminSigningKey,
  signAdminChallenge,
} from "../services/adminBiometrics";
import {
  getAdminDeviceId,
  getAdminToken,
  saveAdminDeviceId,
  saveAdminId,
  saveAdminToken,
  setDevAdminToken,
} from "../services/adminSession";
import { AdminColors, AdminRadii } from "../theme/adminTheme";

export default function AdminLoginScreen() {
  const [adminId, setAdminId] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [enrollmentToken, setEnrollmentToken] = useState("");
  const [devToken, setDevToken] = useState("");
  const [requiresTwoFactor, setRequiresTwoFactor] = useState(false);
  const [enrollmentMode, setEnrollmentMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [showAdminId, setShowAdminId] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showJwtToken, setShowJwtToken] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const token = await getAdminToken();
        if (active && token) {
          router.replace("/dashboard");
          return;
        }
      } finally {
        if (active) setCheckingSession(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const handleSignIn = async () => {
    if (Platform.OS === "web") {
      if (!adminId.trim()) {
        Alert.alert("Admin ID required", "Enter your Admin ID.");
        return;
      }
      if (!password.trim()) {
        Alert.alert("Password required", "Enter your password.");
        return;
      }
      if (!devToken.trim()) {
        Alert.alert("JWT token required", "Paste a valid admin JWT/bearer token.");
        return;
      }
      setLoading(true);
      try {
        setDevAdminToken(devToken.trim());
        await saveAdminToken(devToken.trim());
        await saveAdminId(adminId.trim());
        setPassword("");
        router.replace("/dashboard");
      } finally {
        setLoading(false);
      }
      return;
    }

    if (!adminId.trim()) { Alert.alert("Missing information", "Enter your Admin ID."); return; }
    if (!password.trim()) { Alert.alert("Missing information", "Enter your password."); return; }
    if (requiresTwoFactor && !totpCode.trim()) { Alert.alert("Verification required", "Enter the authenticator code."); return; }

    setLoading(true);
    try {
      const deviceId = await getAdminDeviceId();
      if (!deviceId) {
        setEnrollmentMode(true);
        Alert.alert("Device enrollment required", "This device key is not registered. Enroll to continue.");
        return;
      }
      const login = await adminLogin(adminId, password, requiresTwoFactor ? totpCode : undefined);
      if (login.requiresTwoFactor) {
        setRequiresTwoFactor(true);
        setTotpCode("");
        Alert.alert("Two-factor verification", "Enter the code from your authenticator app.");
        return;
      }
      if (!login.pendingToken || login.requiresDeviceVerification !== true) throw new Error("Invalid pending administrator login.");
      const challenge = await createAdminChallenge(login.pendingToken, deviceId);
      if (!challenge.challengeId || !challenge.challenge) throw new Error("Invalid device challenge.");
      const signature = await signAdminChallenge(challenge.challenge);
      const verified = await verifyAdminDevice(login.pendingToken, challenge.challengeId, deviceId, signature);
      if (!verified.token || !verified.user) throw new Error("Device verification failed.");
      await saveAdminToken(verified.token);
      await saveAdminId(String(verified.user?.id ?? adminId.trim()));
      setRequiresTwoFactor(false);
      setTotpCode("");
      setPassword("");
      router.replace("/dashboard");
    } catch (error: any) {
      const msg = error?.response?.data?.error || error?.response?.data?.message || error?.message || "Sign-in failed.";
      Alert.alert("Sign-in failed", msg);
    } finally {
      setLoading(false);
    }
  };

  const handleEnrollDevice = async () => {
    if (!enrollmentToken.trim()) { Alert.alert("Enrollment token required", "Enter the one-time enrollment token."); return; }
    setLoading(true);
    try {
      const existingDeviceId = await getAdminDeviceId();
      if (existingDeviceId) { Alert.alert("Device already enrolled", "This app already has a saved admin device key."); return; }
      const key = await prepareAdminSigningKey();
      const enrolled = await enrollAdminDevice(enrollmentToken.trim(), key.publicKeyPem, "DocuGuard Admin device");
      if (enrolled.enrolled !== true || enrolled.keyAlgorithm !== "ECDSA_P256_SHA256" || !enrolled.deviceId) throw new Error("Invalid enrollment response.");
      await saveAdminDeviceId(String(enrolled.deviceId));
      setEnrollmentToken("");
      setEnrollmentMode(false);
      Alert.alert("Device enrolled", "Cryptographic key registered successfully.");
    } catch (error: any) {
      Alert.alert("Enrollment failed", error?.message || "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const isWeb = Platform.OS === "web";

  if (checkingSession) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.center}><ActivityIndicator size="large" color={AdminColors.primary} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.hero}>
            <View style={styles.logoWrap}><Ionicons name="shield-checkmark" size={28} color="#fff" /></View>
            <Text style={styles.brand}>DocuGuard Admin</Text>
            <Text style={styles.tagline}>Clean, secure operations dashboard</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.title}>
              {isWeb ? "Access Dashboard" : enrollmentMode ? "Enroll Device" : requiresTwoFactor ? "Verify Identity" : "Secure Sign In"}
            </Text>
            <Text style={styles.desc}>
              {isWeb
                ? "Paste an admin bearer token to load real DocuGuard analytics and management data. Device-bound login will be wired next."
                : enrollmentMode
                  ? "Register this device's hardware-backed key using your provisioning token."
                  : requiresTwoFactor
                    ? "Enter the code from your authenticator app."
                    : "Authenticate with your Admin ID and device-bound cryptographic key."}
            </Text>

            {isWeb ? (
              <>
                <View style={styles.field}>
                  <Text style={styles.label}>Admin ID</Text>
                  <View style={styles.tokenBox}>
                    <TextInput
                      style={styles.adminIdInput}
                      value={adminId}
                      onChangeText={setAdminId}
                      placeholder="Enter Admin ID"
                      placeholderTextColor={AdminColors.textMuted}
                      autoCapitalize="none"
                      autoCorrect={false}
                      secureTextEntry={!showAdminId}
                      editable={!loading}
                    />
                    <Pressable onPress={() => setShowAdminId((v) => !v)} style={styles.eyeBtn}>
                      <Ionicons name={showAdminId ? "eye-off-outline" : "eye-outline"} size={18} color={AdminColors.textSecondary} />
                    </Pressable>
                  </View>
                </View>
                <View style={styles.field}>
                  <Text style={styles.label}>Password</Text>
                  <View style={styles.tokenBox}>
                    <TextInput
                      style={styles.adminIdInput}
                      value={password}
                      onChangeText={setPassword}
                      placeholder="Enter password"
                      placeholderTextColor={AdminColors.textMuted}
                      autoCapitalize="none"
                      autoCorrect={false}
                      secureTextEntry={!showPassword}
                      editable={!loading}
                    />
                    <Pressable onPress={() => setShowPassword((v) => !v)} style={styles.eyeBtn}>
                      <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={18} color={AdminColors.textSecondary} />
                    </Pressable>
                  </View>
                </View>
                <View style={styles.field}>
                  <Text style={styles.label}>JWT / Bearer Token</Text>
                  <View style={styles.tokenBox}>
                    <TextInput
                      style={styles.tokenInputArea}
                      value={devToken}
                      onChangeText={setDevToken}
                      placeholder="Paste admin JWT/session token"
                      placeholderTextColor={AdminColors.textMuted}
                      autoCapitalize="none"
                      autoCorrect={false}
                      multiline
                      secureTextEntry={!showJwtToken}
                      editable={!loading}
                    />
                    <Pressable onPress={() => setShowJwtToken((v) => !v)} style={styles.eyeBtn}>
                      <Ionicons name={showJwtToken ? "eye-off-outline" : "eye-outline"} size={18} color={AdminColors.textSecondary} />
                    </Pressable>
                  </View>
                </View>
                <Pressable style={({ pressed }) => [styles.primaryBtn, pressed && !loading && { opacity: 0.9 }, loading && { opacity: 0.6 }]} onPress={handleSignIn} disabled={loading}>
                  {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Open Dashboard</Text>}
                </Pressable>
                <View style={styles.infoBox}>
                  <Ionicons name="information-circle-outline" size={16} color={AdminColors.primary} />
                  <Text style={styles.infoText}>Enter your Admin ID, password, and JWT token to access live DocuGuard admin data. Credentials are stored locally for this session.</Text>
                </View>
              </>
            ) : enrollmentMode ? (
              <>
                <View style={styles.field}>
                  <Text style={styles.label}>One-time enrollment token</Text>
                  <TextInput style={styles.input} value={enrollmentToken} onChangeText={setEnrollmentToken} placeholder="Enter enrollment token" placeholderTextColor={AdminColors.textMuted} autoCapitalize="none" secureTextEntry editable={!loading} />
                </View>
                <Pressable style={({ pressed }) => [styles.primaryBtn, pressed && !loading && { opacity: 0.9 }, loading && { opacity: 0.6 }]} onPress={handleEnrollDevice} disabled={loading}>
                  {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Generate & Register Key</Text>}
                </Pressable>
                <Pressable style={styles.linkBtn} onPress={() => { setEnrollmentMode(false); setEnrollmentToken(""); }} disabled={loading}><Text style={styles.linkText}>Back to sign in</Text></Pressable>
              </>
            ) : (
              <>
                <View style={styles.field}>
                  <Text style={styles.label}>Admin ID</Text>
                  <View style={styles.tokenBox}>
                    <TextInput
                      style={styles.adminIdInput}
                      value={adminId}
                      onChangeText={setAdminId}
                      placeholder="Enter Admin ID"
                      placeholderTextColor={AdminColors.textMuted}
                      autoCapitalize="none"
                      autoCorrect={false}
                      secureTextEntry={!showAdminId}
                      editable={!loading}
                    />
                    <Pressable onPress={() => setShowAdminId((v) => !v)} style={styles.eyeBtn}>
                      <Ionicons name={showAdminId ? "eye-off-outline" : "eye-outline"} size={18} color={AdminColors.textSecondary} />
                    </Pressable>
                  </View>
                </View>
                <View style={styles.field}>
                  <Text style={styles.label}>Password</Text>
                  <View style={styles.tokenBox}>
                    <TextInput
                      style={styles.adminIdInput}
                      value={password}
                      onChangeText={setPassword}
                      placeholder="Enter password"
                      placeholderTextColor={AdminColors.textMuted}
                      autoCapitalize="none"
                      autoCorrect={false}
                      secureTextEntry={!showPassword}
                      editable={!loading}
                    />
                    <Pressable onPress={() => setShowPassword((v) => !v)} style={styles.eyeBtn}>
                      <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={18} color={AdminColors.textSecondary} />
                    </Pressable>
                  </View>
                </View>
                {requiresTwoFactor && (
                  <View style={styles.field}>
                    <Text style={styles.label}>Authenticator code</Text>
                    <TextInput style={styles.input} value={totpCode} onChangeText={(v) => setTotpCode(v.replace(/\s/g, ""))} placeholder="Enter code" placeholderTextColor={AdminColors.textMuted} keyboardType="number-pad" maxLength={8} editable={!loading} onSubmitEditing={handleSignIn} />
                  </View>
                )}
                <Pressable style={({ pressed }) => [styles.primaryBtn, pressed && !loading && { opacity: 0.9 }, loading && { opacity: 0.6 }]} onPress={handleSignIn} disabled={loading}>
                  {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{requiresTwoFactor ? "Verify & Continue" : "Authenticate"}</Text>}
                </Pressable>
                {requiresTwoFactor && <Pressable style={styles.linkBtn} onPress={() => { setRequiresTwoFactor(false); setTotpCode(""); }} disabled={loading}><Text style={styles.linkText}>Back</Text></Pressable>}
                <Pressable style={styles.linkBtn} onPress={() => setEnrollmentMode(true)} disabled={loading}><Text style={styles.linkText}>Enroll new device key</Text></Pressable>
              </>
            )}
          </View>

          <Text style={styles.footer}>DocuGuard · Secure Admin Access</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: AdminColors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { flexGrow: 1, padding: 20, justifyContent: "center" },
  hero: { alignItems: "center", marginBottom: 24 },
  logoWrap: { width: 56, height: 56, borderRadius: 18, backgroundColor: AdminColors.primary, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  brand: { fontSize: 26, fontWeight: "800", color: AdminColors.text, letterSpacing: -0.5 },
  tagline: { fontSize: 13, color: AdminColors.textSecondary, marginTop: 4 },
  card: { backgroundColor: AdminColors.surface, borderRadius: 24, borderWidth: 1, borderColor: AdminColors.border, padding: 20 },
  title: { fontSize: 22, fontWeight: "800", color: AdminColors.text },
  desc: { fontSize: 14, color: AdminColors.textSecondary, lineHeight: 21, marginTop: 8, marginBottom: 20 },
  field: { marginBottom: 16 },
  label: { fontSize: 13, fontWeight: "700", color: AdminColors.text, marginBottom: 8 },
  input: { height: 50, borderRadius: 14, borderWidth: 1, borderColor: AdminColors.border, backgroundColor: AdminColors.surfaceAlt, paddingHorizontal: 14, color: AdminColors.text, fontSize: 14 },
  tokenBox: { flexDirection: "row", borderRadius: 14, borderWidth: 1, borderColor: AdminColors.border, backgroundColor: AdminColors.surfaceAlt, overflow: "hidden" },
  adminIdInput: { flex: 1, height: 50, paddingHorizontal: 14, color: AdminColors.text, fontSize: 14 },
  tokenInputArea: { flex: 1, minHeight: 110, paddingHorizontal: 14, paddingVertical: 12, color: AdminColors.text, fontSize: 13, textAlignVertical: "top" },
  eyeBtn: { padding: 12, alignSelf: "flex-start" },
  primaryBtn: { height: 50, borderRadius: 14, backgroundColor: AdminColors.primary, alignItems: "center", justifyContent: "center", marginTop: 4 },
  primaryText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  linkBtn: { alignItems: "center", paddingTop: 14 },
  linkText: { color: AdminColors.primary, fontWeight: "700", fontSize: 14 },
  infoBox: { flexDirection: "row", gap: 8, marginTop: 16, padding: 12, borderRadius: 12, backgroundColor: AdminColors.primarySoft },
  infoText: { flex: 1, fontSize: 12, color: AdminColors.primaryDark, lineHeight: 17 },
  footer: { textAlign: "center", color: AdminColors.textMuted, fontSize: 12, marginTop: 20 },
});
