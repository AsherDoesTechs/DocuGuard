import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  Modal,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import Animated, {
  FadeIn,
  ZoomIn,
  ZoomOut,
  useSharedValue,
  withSequence,
  withTiming,
} from "react-native-reanimated";

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
      router.replace("/(tabs)/home");
    }
    return () => clearInterval(interval);
  }, [showSuccess, timer]);

  const handleFinish = () => setShowSuccess(true);

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
              onChangeText={(v) => setFormData({ ...formData, name: v })}
            />
            <TextInput
              style={styles.input}
              placeholder="Document Serial Number"
              keyboardType="numeric"
              onChangeText={(v) => setFormData({ ...formData, serial: v })}
            />
          </View>
        )}

        {step === 2 && (
          <View style={styles.form}>
            <TextInput
              style={styles.input}
              placeholder="Card Number"
              keyboardType="number-pad"
              onChangeText={(v) => setFormData({ ...formData, card: v })}
            />
            <TextInput
              style={styles.input}
              placeholder="MM/YY"
              onChangeText={(v) => setFormData({ ...formData, expiry: v })}
            />
          </View>
        )}

        {step === 3 && (
          <View style={styles.gate}>
            <Ionicons name="finger-print" size={100} color={DG.navy} />
            <Text style={styles.gateText}>Biometric Verification Required</Text>
            <TouchableOpacity style={styles.confirmBtn} onPress={handleFinish}>
              <Text style={styles.btnText}>CONFIRM PAYMENT</Text>
            </TouchableOpacity>
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
            <Ionicons name="confetti" size={80} color={DG.emerald} />
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
            onPress={() => setStep(step + 1)}
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
  },
  gate: { alignItems: "center", marginTop: 40 },
  gateText: { marginTop: 20, color: DG.slate, fontWeight: "600" },
  confirmBtn: {
    marginTop: 20,
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
  backBtn: { flex: 1, padding: 20, alignItems: "center" },
  backText: { color: DG.slate, fontWeight: "700" },
  nextBtn: {
    flex: 2,
    backgroundColor: DG.navy,
    padding: 20,
    borderRadius: 12,
    alignItems: "center",
  },
  btnText: { color: "white", fontWeight: "800" },
});
