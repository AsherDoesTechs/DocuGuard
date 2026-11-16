import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AdminColors, AdminRadii } from "../theme/adminTheme";
import { adminLogin } from "../services/adminApi";
import { getAdminId, getAdminToken } from "../services/adminSession";
import {
  registerSensitiveAuthHandler,
  type SensitiveAuthOptions,
} from "../services/adminSensitiveAuth";

type PendingRequest = {
  opts?: SensitiveAuthOptions;
  resolve: (ok: boolean) => void;
};

export function AdminSensitiveAuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [pending, setPending] = useState<PendingRequest | null>(null);
  const [password, setPassword] = useState("");
  const [jwtToken, setJwtToken] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showJwt, setShowJwt] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const close = useCallback(
    (ok: boolean) => {
      if (pending) pending.resolve(ok);
      setPending(null);
      setPassword("");
      setJwtToken("");
      setShowPassword(false);
      setShowJwt(false);
      setError(null);
      setLoading(false);
    },
    [pending],
  );

  useEffect(() => {
    if (Platform.OS !== "web") return;
    registerSensitiveAuthHandler(
      (opts?: SensitiveAuthOptions) =>
        new Promise<boolean>((resolve) => {
          setPending({ opts, resolve });
          setPassword("");
          setJwtToken("");
          setError(null);
          setLoading(false);
        }),
    );
    return () => registerSensitiveAuthHandler(null);
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!pending) return;
    setError(null);
    const pw = password.trim();
    const jwt = jwtToken.trim();
    if (!pw) {
      setError("Password is required.");
      return;
    }
    if (!jwt) {
      setError("JWT token is required.");
      return;
    }
    setLoading(true);
    try {
      const sessionToken = (await getAdminToken())?.trim() || "";
      if (jwt !== sessionToken) {
        setError("JWT token does not match your active session.");
        setLoading(false);
        return;
      }
      const storedId =
        pending.opts?.adminIdHint?.trim() || (await getAdminId())?.trim() || "";
      if (storedId) {
        try {
          await adminLogin(storedId, pw);
        } catch (e: any) {
          const msg =
            e?.response?.data?.error ||
            e?.response?.data?.message ||
            e?.message ||
            "Password verification failed.";
          setError(String(msg));
          setLoading(false);
          return;
        }
      }
      close(true);
    } catch (e: any) {
      setError(e?.message || "Verification failed. Please try again.");
      setLoading(false);
    }
  }, [close, jwtToken, password, pending]);

  const visible = Platform.OS === "web" && !!pending;

  return (
    <>
      {children}
      {visible ? (
        <Modal transparent visible animationType="fade" onRequestClose={() => close(false)}>
          <View style={styles.overlay}>
            <Pressable style={styles.backdrop} onPress={() => close(false)} />
            <View style={styles.card}>
              <Text style={styles.title}>Confirm identity</Text>
              <Text style={styles.message}>
                Enter your password and JWT token to continue this sensitive action.
              </Text>

              <Text style={styles.label}>Password</Text>
              <View style={styles.inputWrap}>
                <TextInput
                  style={styles.input}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Enter password"
                  placeholderTextColor={AdminColors.textMuted}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!loading}
                />
                <Pressable onPress={() => setShowPassword((v) => !v)} style={styles.eyeBtn}>
                  <Ionicons
                    name={showPassword ? "eye-off-outline" : "eye-outline"}
                    size={18}
                    color={AdminColors.textSecondary}
                  />
                </Pressable>
              </View>

              <Text style={styles.label}>JWT / Bearer Token</Text>
              <View style={styles.inputWrap}>
                <TextInput
                  style={styles.input}
                  value={jwtToken}
                  onChangeText={setJwtToken}
                  placeholder="Enter JWT token"
                  placeholderTextColor={AdminColors.textMuted}
                  secureTextEntry={!showJwt}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!loading}
                />
                <Pressable onPress={() => setShowJwt((v) => !v)} style={styles.eyeBtn}>
                  <Ionicons
                    name={showJwt ? "eye-off-outline" : "eye-outline"}
                    size={18}
                    color={AdminColors.textSecondary}
                  />
                </Pressable>
              </View>

              {error ? <Text style={styles.error}>{error}</Text> : null}

              <View style={styles.actions}>
                <Pressable
                  style={[styles.btn, styles.btnCancel]}
                  onPress={() => close(false)}
                  disabled={loading}
                >
                  <Text style={styles.btnCancelText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[styles.btn, styles.btnPrimary, loading && { opacity: 0.6 }]}
                  onPress={handleConfirm}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.btnPrimaryText}>Confirm</Text>
                  )}
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(15, 23, 42, 0.45)",
  },
  card: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: AdminColors.surface,
    borderRadius: AdminRadii.lg,
    borderWidth: 1,
    borderColor: AdminColors.border,
    padding: 20,
  },
  title: { fontSize: 18, fontWeight: "700", color: AdminColors.text },
  message: {
    fontSize: 14,
    color: AdminColors.textSecondary,
    lineHeight: 21,
    marginTop: 8,
    marginBottom: 14,
  },
  label: {
    fontSize: 13,
    fontWeight: "700",
    color: AdminColors.text,
    marginBottom: 6,
    marginTop: 8,
  },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: AdminColors.border,
    backgroundColor: AdminColors.surfaceAlt,
    overflow: "hidden",
  },
  input: {
    flex: 1,
    height: 46,
    paddingHorizontal: 14,
    color: AdminColors.text,
    fontSize: 14,
  },
  eyeBtn: { padding: 12 },
  error: {
    marginTop: 10,
    fontSize: 13,
    color: "#B91C1C",
  },
  actions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 20,
  },
  btn: {
    minHeight: 44,
    paddingHorizontal: 18,
    borderRadius: AdminRadii.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  btnCancel: { backgroundColor: AdminColors.surfaceAlt },
  btnCancelText: { fontSize: 15, fontWeight: "600", color: AdminColors.text },
  btnPrimary: { backgroundColor: AdminColors.primary, minWidth: 96 },
  btnPrimaryText: { fontSize: 15, fontWeight: "600", color: "#fff" },
});
