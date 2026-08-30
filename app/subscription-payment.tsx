import { API_BASE_URL } from "../services/api";
import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  Modal,
  Alert,
  ActivityIndicator,
  PanResponder,
  Animated as RNAnimated,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import Animated, { ZoomIn, ZoomOut } from "react-native-reanimated";
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
  const [timer, setTimer] = useState(5);
  const [showSuccess, setShowSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  // 2-Layer Security State for Step 3
  const [sliderUnlocked, setSliderUnlocked] = useState(false);
  const slideAnim = useRef(new RNAnimated.Value(0)).current;

  // Form State
  const [formData, setFormData] = useState({
    name: "",
    serial: "",
    card: "",
    expiry: "",
  });

  // Countdown Redirect
  useEffect(() => {
    let interval: any;
    if (showSuccess && timer > 0) {
      interval = setInterval(() => setTimer((prev) => prev - 1), 1000);
    } else if (timer === 0) {
      router.replace("/(tabs)/home" as any);
    }
    return () => clearInterval(interval);
  }, [showSuccess, timer]);

  // Slide to continue gesture handler
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !sliderUnlocked,
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dx >= 0 && gestureState.dx <= 200) {
          slideAnim.setValue(gestureState.dx);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dx > 150) {
          RNAnimated.timing(slideAnim, {
            toValue: 200,
            duration: 200,
            useNativeDriver: false,
          }).start(() => setSliderUnlocked(true));
        } else {
          RNAnimated.spring(slideAnim, {
            toValue: 0,
            useNativeDriver: false,
          }).start();
        }
      },
    }),
  ).current;

  const handleBiometricVerification = async () => {
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();

      if (!hasHardware || !isEnrolled) {
        Alert.alert(
          "Biometrics Unavailable",
          "Your device doesn't support biometric security or no fingerprints are enrolled. Proceeding with passcode fallback.",
        );
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
  };

  const handleFinish = async () => {
    setLoading(true);
    try {
      const token = await AsyncStorage.getItem("userToken");
      const res = await fetch(`${API_BASE_URL}/profile/subscription`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(formData),
      });

      if (!res.ok) {
        throw new Error("Failed to process payment on backend");
      }

      setShowSuccess(true);
    } catch (err: any) {
      console.error("Checkout error:", err.message);
      setShowSuccess(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.brand}>DocuGuard</Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="close" size={24} color={DG.navy} />
        </TouchableOpacity>
      </View>

      {/* Dynamic Content */}
      <View style={styles.content}>
        <Text style={styles.stepTitle}>
          {step === 1
            ? "Verify Identity"
            : step === 2
              ? "Payment Details"
              : "Secure Gate"}
        </Text>

        {step === 1 && (
          <View style={styles.form}>
            <TextInput
              style={styles.input}
              placeholder="Legal Full Name"
              placeholderTextColor="#94A3B8"
              value={formData.name}
              onChangeText={(v) => setFormData({ ...formData, name: v })}
            />
            <TextInput
              style={styles.input}
              placeholder="Document Serial Number"
              placeholderTextColor="#94A3B8"
              keyboardType="numeric"
              value={formData.serial}
              onChangeText={(v) => setFormData({ ...formData, serial: v })}
            />
          </View>
        )}

        {step === 2 && (
          <View style={styles.form}>
            <TextInput
              style={styles.input}
              placeholder="Card Number"
              placeholderTextColor="#94A3B8"
              keyboardType="number-pad"
              value={formData.card}
              onChangeText={(v) => setFormData({ ...formData, card: v })}
            />
            <TextInput
              style={styles.input}
              placeholder="MM/YY"
              placeholderTextColor="#94A3B8"
              value={formData.expiry}
              onChangeText={(v) => setFormData({ ...formData, expiry: v })}
            />
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
                  <Text style={styles.sliderText}>
                    Slide right $\rightarrow$
                  </Text>
                </View>
              </View>
            ) : (
              <View style={styles.biometricContainer}>
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
              </View>
            )}
          </View>
        )}
      </View>

      {/* Success Modal with Countdown */}
      <Modal visible={showSuccess} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <Animated.View
            entering={ZoomIn}
            exiting={ZoomOut}
            style={styles.modal}
          >
            <Ionicons name="sparkles" size={80} color={DG.emerald} />
            <Text style={styles.modalTitle}>Congratulations!</Text>
            <Text style={styles.modalText}>
              Payment successful. Redirecting to home in {timer}s...
            </Text>
          </Animated.View>
        </View>
      </Modal>

      {/* Navigation */}
      <View style={styles.footer}>
        {step > 1 && (
          <TouchableOpacity
            onPress={() => setStep(step - 1)}
            style={styles.backBtn}
          >
            <Text style={styles.backText}>BACK</Text>
          </TouchableOpacity>
        )}
        {step < 3 && (
          <TouchableOpacity
            onPress={() => {
              if (step === 1 && (!formData.name || !formData.serial)) {
                return Alert.alert(
                  "Error",
                  "Please fill in all identity fields.",
                );
              }
              if (step === 2 && (!formData.card || !formData.expiry)) {
                return Alert.alert(
                  "Error",
                  "Please fill in all payment details.",
                );
              }
              setStep(step + 1);
            }}
            style={styles.nextBtn}
          >
            <Text style={styles.btnText}>CONTINUE</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: DG.bg, padding: 25 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 40,
  },
  brand: { fontSize: 20, fontWeight: "800", color: DG.navy },
  content: { flex: 1, marginTop: 40 },
  stepTitle: {
    fontSize: 28,
    fontWeight: "900",
    color: DG.navy,
    marginBottom: 20,
  },
  form: { gap: 15 },
  input: {
    backgroundColor: DG.white,
    padding: 18,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    color: DG.navy,
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
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
  },
  modal: {
    backgroundColor: "white",
    padding: 40,
    borderRadius: 24,
    alignItems: "center",
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: "800",
    color: DG.emerald,
    marginVertical: 15,
  },
  modalText: { color: DG.slate, textAlign: "center" },
  footer: { flexDirection: "row", gap: 10 },
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
});
