import { API_BASE_URL } from "../services/api";
import { COLORS } from "../constants";
import { Toast } from "../components/ui/Toast";
import type { ToastType } from "../components/ui/Toast";
import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  Alert,
  ActivityIndicator,
  PanResponder,
  Animated as RNAnimated,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import Animated, {
  FadeIn,
  Easing,
} from "react-native-reanimated";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as LocalAuthentication from "expo-local-authentication";

const DG = {
  navy: "#0F172A",
  emerald: "#059669",
  slate: "#64748B",
  bg: "#F8FAFC",
  white: "#FFFFFF",
};

export default function DocuGuardCheckout() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    visible: boolean;
    message: string;
    type: ToastType;
  }>({ visible: false, message: "", type: "success" });

  const [sliderUnlocked, setSliderUnlocked] = useState(false);
  const slideAnim = useRef(new RNAnimated.Value(0)).current;
  const slideTextAnim = useRef(new RNAnimated.Value(0)).current;

  const formData = useRef({
    name: "",
    serial: "",
    card: "",
    expiry: "",
  });

  useEffect(() => {
    if (!sliderUnlocked) {
      RNAnimated.loop(
        RNAnimated.sequence([
          RNAnimated.timing(slideTextAnim, {
            toValue: 8,
            duration: 1200,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          RNAnimated.timing(slideTextAnim, {
            toValue: 0,
            duration: 1200,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ]),
      ).start();
    }
    return () => slideTextAnim.stopAnimation();
  }, [sliderUnlocked]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !sliderUnlocked,
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dx >= 0 && gestureState.dx <= 200) {
          slideAnim.setValue(gestureState.dx);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dx > 120) {
          RNAnimated.sequence([
            RNAnimated.timing(slideAnim, {
              toValue: 200,
              duration: 250,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: false,
            }),
            RNAnimated.delay(100),
            RNAnimated.timing(slideAnim, {
              toValue: 0,
              duration: 0,
              useNativeDriver: false,
            }),
          ]).start(() => {
            setSliderUnlocked(true);
            slideAnim.setValue(0);
          });
        } else {
          RNAnimated.spring(slideAnim, {
            toValue: 0,
            friction: 6,
            tension: 80,
            useNativeDriver: false,
          }).start();
        }
      },
    }),
  ).current;

  const validateStep = (s: number): boolean => {
    if (s === 1) {
      const d = formData.current;
      if (!d.name.trim() || d.name.trim().length < 2) {
        Alert.alert("Error", "Please enter your full legal name (min 2 characters).");
        return false;
      }
      if (!d.serial.trim() || !/^[A-Z0-9]+$/i.test(d.serial.trim())) {
        Alert.alert("Error", "Please enter a valid Document Serial Number.");
        return false;
      }
      return true;
    }
    if (s === 2) {
      const d = formData.current;
      if (!d.card.trim() || d.card.trim().replace(/\s/g, "").length < 13) {
        Alert.alert("Error", "Please enter a valid card number.");
        return false;
      }
      if (!d.expiry.trim() || !/^\d{2}\/\d{2}$/.test(d.expiry.trim())) {
        Alert.alert("Error", "Expiry must be in MM/YY format.");
        return false;
      }
      const [mm, yy] = d.expiry.trim().split("/");
      const month = parseInt(mm, 10);
      if (month < 1 || month > 12) {
        Alert.alert("Error", "Invalid expiry month.");
        return false;
      }
      return true;
    }
    return true;
  };

  const handleBiometricVerification = useCallback(async () => {
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();

      if (!hasHardware || !isEnrolled) {
        Alert.alert(
          "Biometrics Unavailable",
          "Your device doesn't support biometric security or no fingerprints are enrolled.",
        );
        return;
      }

      const auth = await LocalAuthentication.authenticateAsync({
        promptMessage: "Verify your identity to complete payment",
        fallbackLabel: "Use Passcode",
        disableDeviceFallback: false,
      });

      if (auth.success) {
        await handleFinish();
      } else {
        Alert.alert(
          "Authentication Failed",
          "Fingerprint verification was cancelled or didn't match.",
        );
      }
    } catch (err: any) {
      console.error("Biometric error:", err);
      Alert.alert("Error", "Could not process biometric scan.");
    }
  }, []);

  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleFinish = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const token = await AsyncStorage.getItem("userToken");
      if (!token) {
        throw new Error("Session expired. Please sign in again.");
      }
      const res = await fetch(`${API_BASE_URL}/subscription`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(formData.current),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Payment processing failed.");
      }

      setToast({
        visible: true,
        message: "Payment successful! Welcome aboard.",
        type: "success",
      });
      if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current);
      redirectTimerRef.current = setTimeout(
        () => router.replace("/(tabs)/home" as any),
        1600,
      );
    } catch (err: any) {
      console.error("Checkout error:", err.message);
      setErrorMessage(err.message || "Payment failed. Please try again.");
      setToast({
        visible: true,
        message: err.message || "Payment failed. Please try again.",
        type: "error",
      });
      if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleNext = useCallback(() => {
    if (!validateStep(step)) return;
    setStep(step + 1);
    setErrorMessage(null);
  }, [step]);

  return (
    <View style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 20}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <Text style={styles.brand}>DocuGuard</Text>
            <TouchableOpacity onPress={() => router.back()}>
              <Ionicons name="close" size={24} color={DG.navy} />
            </TouchableOpacity>
          </View>

          <View style={styles.content}>
            <Text style={styles.stepTitle}>
              {step === 1
                ? "Verify Identity"
                : step === 2
                  ? "Payment Details"
                  : "Secure Gate"}
            </Text>

            {errorMessage && (
              <View style={styles.errorBanner}>
                <Ionicons name="alert-circle" size={16} color={COLORS.danger} />
                <Text style={styles.errorText}>{errorMessage}</Text>
              </View>
            )}

            {step === 1 && (
              <View style={styles.form}>
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Legal Full Name</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Enter your full legal name"
                    placeholderTextColor="#94A3B8"
                    value={formData.current.name}
                    onChangeText={(v) =>
                      (formData.current.name = v.replace(/[^a-zA-Z\s]/g, ""))
                    }
                    autoCapitalize="words"
                    autoCorrect={false}
                    autoComplete="name"
                    textContentType="name"
                  />
                </View>
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Document Serial Number</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Enter document serial"
                    placeholderTextColor="#94A3B8"
                    keyboardType="numeric"
                    value={formData.current.serial}
                    onChangeText={(v) =>
                      (formData.current.serial = v.replace(/[^A-Z0-9]/gi, "").toUpperCase())
                    }
                    autoCapitalize="characters"
                    autoCorrect={false}
                    autoComplete="off"
                  />
                </View>
              </View>
            )}

            {step === 2 && (
              <View style={styles.form}>
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Card Number</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="0000 0000 0000 0000"
                    placeholderTextColor="#94A3B8"
                    keyboardType="number-pad"
                    value={formData.current.card}
                    onChangeText={(v) => {
                      const cleaned = v.replace(/\D/g, "").slice(0, 16);
                      const parts = [];
                      for (let i = 0; i < cleaned.length; i += 4) {
                        parts.push(cleaned.slice(i, i + 4));
                      }
                      formData.current.card = parts.join(" ");
                    }}
                    autoCorrect={false}
                    autoComplete="cc-number"
                    textContentType="creditCardNumber"
                  />
                </View>
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Expiry Date (MM/YY)</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="MM / YY"
                    placeholderTextColor="#94A3B8"
                    value={formData.current.expiry}
                    onChangeText={(v) => {
                      let cleaned = v.replace(/\D/g, "").slice(0, 4);
                      if (cleaned.length >= 3) {
                        cleaned = cleaned.slice(0, 2) + "/" + cleaned.slice(2);
                      }
                      formData.current.expiry = cleaned;
                    }}
                    keyboardType="number-pad"
                    autoCorrect={false}
                    autoComplete="cc-exp"
                    textContentType="creditCardExpiration"
                  />
                </View>
              </View>
            )}

            {step === 3 && (
              <View style={styles.gate}>
                {!sliderUnlocked ? (
                  <View style={styles.sliderContainer}>
                    <Text style={styles.gateText}>Layer 1: Slide to Continue</Text>
                    <View style={styles.sliderTrack}>
                      <RNAnimated.View
                        style={[
                          styles.sliderThumb,
                          { transform: [{ translateX: slideAnim }] },
                        ]}
                        {...panResponder.panHandlers}
                      >
                        <Ionicons name="chevron-forward" size={20} color="#fff" />
                      </RNAnimated.View>
                      <RNAnimated.Text
                        style={[styles.sliderText, { transform: [{ translateX: slideTextAnim }] }]}
                      >
                        Slide right → to unlock
                      </RNAnimated.Text>
                    </View>
                  </View>
                ) : (
                  <Animated.View entering={FadeIn.duration(300)} style={styles.biometricContainer}>
                    <Ionicons name="finger-print" size={80} color={DG.emerald} />
                    <Text style={styles.gateText}>
                      Layer 2: Biometric Verification Required
                    </Text>
                    <TouchableOpacity
                      style={styles.confirmBtn}
                      onPress={handleBiometricVerification}
                      disabled={loading}
                    >
                      {loading ? (
                        <ActivityIndicator color="#fff" />
                      ) : (
                        <Text style={styles.btnText}>SCAN FINGERPRINT</Text>
                      )}
                    </TouchableOpacity>
                  </Animated.View>
                )}
              </View>
            )}
          </View>

          <View style={styles.footer}>
            {step > 1 && (
              <TouchableOpacity
                onPress={() => {
                  setStep(step - 1);
                  setErrorMessage(null);
                }}
                style={styles.backBtn}
              >
                <Text style={styles.backText}>BACK</Text>
              </TouchableOpacity>
            )}
            {step < 3 && (
              <TouchableOpacity
                onPress={handleNext}
                style={styles.nextBtn}
                disabled={loading}
              >
                <Text style={styles.btnText}>
                  {loading ? "..." : "CONTINUE"}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <Toast
        visible={toast.visible}
        message={toast.message}
        type={toast.type}
        onDismiss={() => setToast((t) => ({ ...t, visible: false }))}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: DG.bg },
  flex: { flex: 1 },
  scrollContent: { padding: 25, paddingBottom: 40 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 30,
  },
  brand: { fontSize: 20, fontWeight: "800", color: DG.navy },
  content: { marginBottom: 30 },
  stepTitle: {
    fontSize: 28,
    fontWeight: "900",
    color: DG.navy,
    marginBottom: 20,
  },
  form: { gap: 15 },
  fieldGroup: { marginBottom: 8 },
  fieldLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#64748B",
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: DG.white,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    color: DG.navy,
    fontSize: 16,
  },
  gate: { alignItems: "center", marginTop: 20 },
  sliderContainer: { width: "100%", alignItems: "center", marginTop: 30 },
  sliderTrack: {
    width: 260,
    height: 55,
    backgroundColor: "#E2E8F0",
    borderRadius: 30,
    justifyContent: "center",
    padding: 5,
    marginTop: 20,
    overflow: "hidden",
  },
  sliderThumb: {
    width: 45,
    height: 45,
    backgroundColor: DG.navy,
    borderRadius: 25,
    justifyContent: "center",
    alignItems: "center",
    position: "absolute",
    zIndex: 2,
    left: 5,
    shadowColor: DG.navy,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 5,
  },
  sliderText: {
    position: "absolute",
    alignSelf: "center",
    color: DG.slate,
    fontWeight: "700",
    fontSize: 13,
  },
  biometricContainer: { alignItems: "center", width: "100%", marginTop: 20 },
  gateText: {
    marginTop: 15,
    color: DG.slate,
    fontWeight: "600",
    textAlign: "center",
  },
  confirmBtn: {
    marginTop: 30,
    backgroundColor: DG.emerald,
    padding: 20,
    borderRadius: 50,
    width: "100%",
    alignItems: "center",
  },
  footer: { flexDirection: "row", gap: 10, marginTop: 10 },
  backBtn: {
    flex: 1,
    padding: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  backText: { color: DG.slate, fontWeight: "700" },
  nextBtn: {
    flex: 2,
    backgroundColor: DG.navy,
    padding: 20,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  btnText: { color: "white", fontWeight: "800" },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FEE2E2",
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    gap: 8,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    color: "#991B1B",
  },
});
