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

import Animated, { FadeIn, FadeInDown, Easing } from "react-native-reanimated";

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as LocalAuthentication from "expo-local-authentication";

const DG = {
  navy: "#0F172A",
  emerald: "#059669",
  slate: "#64748B",
  bg: "#F8FAFC",
  white: "#FFFFFF",
  border: "#E2E8F0",
  greenBg: "#ECFDF5",
  greenText: "#047857",
  muted: "#94A3B8",
};

const SLIDER_WIDTH = 260;
const THUMB_SIZE = 45;
const SLIDE_DISTANCE = SLIDER_WIDTH - THUMB_SIZE - 10;
const SLIDE_THRESHOLD = SLIDE_DISTANCE * 0.65;

export default function DocuGuardCheckout() {
  const router = useRouter();

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [toast, setToast] = useState<{
    visible: boolean;
    message: string;
    type: ToastType;
  }>({
    visible: false,
    message: "",
    type: "success",
  });

  const [sliderUnlocked, setSliderUnlocked] = useState(false);

  const slideAnim = useRef(new RNAnimated.Value(0)).current;
  const slideTextAnim = useRef(new RNAnimated.Value(0)).current;

  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /*
   * ---------------------------------------------------------
   * SLIDER ANIMATION
   * ---------------------------------------------------------
   */

  useEffect(() => {
    if (sliderUnlocked) {
      slideTextAnim.stopAnimation();
      return;
    }

    const animation = RNAnimated.loop(
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
    );

    animation.start();

    return () => {
      animation.stop();
      slideTextAnim.stopAnimation();
    };
  }, [sliderUnlocked, slideTextAnim]);

  /*
   * ---------------------------------------------------------
   * SLIDER GESTURE
   * ---------------------------------------------------------
   */

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !sliderUnlocked,

      onMoveShouldSetPanResponder: () => !sliderUnlocked,

      onPanResponderMove: (_, gestureState) => {
        if (sliderUnlocked) return;

        const distance = Math.max(0, Math.min(SLIDE_DISTANCE, gestureState.dx));

        slideAnim.setValue(distance);
      },

      onPanResponderRelease: (_, gestureState) => {
        if (sliderUnlocked) return;

        if (gestureState.dx >= SLIDE_THRESHOLD) {
          RNAnimated.timing(slideAnim, {
            toValue: SLIDE_DISTANCE,
            duration: 180,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: false,
          }).start(() => {
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

  /*
   * ---------------------------------------------------------
   * MOVE TO NEXT STEP
   * ---------------------------------------------------------
   */

  const handleNext = useCallback(() => {
    setErrorMessage(null);

    if (step < 3) {
      setStep((currentStep) => currentStep + 1);
    }
  }, [step]);

  /*
   * ---------------------------------------------------------
   * BIOMETRIC VERIFICATION
   * ---------------------------------------------------------
   */

  const handleBiometricVerification = useCallback(async () => {
    if (loading) return;

    try {
      setErrorMessage(null);

      const hasHardware = await LocalAuthentication.hasHardwareAsync();

      const isEnrolled = await LocalAuthentication.isEnrolledAsync();

      if (!hasHardware) {
        Alert.alert(
          "Biometrics Unavailable",
          "This device does not support biometric authentication.",
        );
        return;
      }

      if (!isEnrolled) {
        Alert.alert(
          "Biometrics Not Set Up",
          "Please enroll a fingerprint or other biometric security method on your device first.",
        );
        return;
      }

      const auth = await LocalAuthentication.authenticateAsync({
        promptMessage: "Verify your identity to activate DocuGuard Pro",
        fallbackLabel: "Use Passcode",
        disableDeviceFallback: false,
        cancelLabel: "Cancel",
      });

      if (auth.success) {
        await handleFinish();
      } else {
        setToast({
          visible: true,
          message: "Verification cancelled.",
          type: "error",
        });
      }
    } catch (err) {
      console.error("Biometric error:", err);

      setErrorMessage("Could not complete biometric verification.");

      setToast({
        visible: true,
        message: "Biometric verification failed.",
        type: "error",
      });
    }
  }, [loading]);

  /*
   * ---------------------------------------------------------
   * ACTIVATE PRO SUBSCRIPTION
   * ---------------------------------------------------------
   */

  const handleFinish = useCallback(async () => {
    if (loading) return;

    setLoading(true);
    setErrorMessage(null);

    try {
      const token = await AsyncStorage.getItem("userToken");

      if (!token) {
        throw new Error("Your session has expired. Please sign in again.");
      }

      /*
       * This is intentionally a DEMO payment.
       *
       * No real card information is collected or transmitted.
       * The backend is responsible for activating the Pro plan.
       */

      const res = await fetch(`${API_BASE_URL}/subscription`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          plan: "pro",
          payment_method: "demo",
          billing_cycle: "annual",
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(
          data?.error ||
            data?.message ||
            "Unable to activate your Pro subscription.",
        );
      }

      setToast({
        visible: true,
        message: "DocuGuard Pro activated successfully!",
        type: "success",
      });

      /*
       * Give the user enough time to see the success toast
       * before returning to the dashboard.
       */
      if (redirectTimerRef.current) {
        clearTimeout(redirectTimerRef.current);
      }

      redirectTimerRef.current = setTimeout(() => {
        router.replace("/(tabs)/index" as any);
      }, 1800);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Unable to activate your subscription.";

      console.error("Subscription activation error:", err);

      setErrorMessage(message);

      setToast({
        visible: true,
        message,
        type: "error",
      });
    } finally {
      setLoading(false);
    }
  }, [loading, router]);

  /*
   * ---------------------------------------------------------
   * CLEANUP
   * ---------------------------------------------------------
   */

  useEffect(() => {
    return () => {
      if (redirectTimerRef.current) {
        clearTimeout(redirectTimerRef.current);
      }
    };
  }, []);

  /*
   * ---------------------------------------------------------
   * UI
   * ---------------------------------------------------------
   */

  return (
    <View style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* HEADER */}

          <View style={styles.header}>
            <View>
              <Text style={styles.brand}>DocuGuard</Text>
              <Text style={styles.secureLabel}>SECURE CHECKOUT</Text>
            </View>

            <TouchableOpacity
              onPress={() => router.back()}
              disabled={loading}
              accessibilityLabel="Close checkout"
            >
              <Ionicons name="close" size={25} color={DG.navy} />
            </TouchableOpacity>
          </View>

          {/* PROGRESS */}

          <View style={styles.progressContainer}>
            {[1, 2, 3].map((item) => (
              <View
                key={item}
                style={[
                  styles.progressSegment,
                  item <= step && styles.progressActive,
                ]}
              />
            ))}
          </View>

          {/* CONTENT */}

          <View style={styles.content}>
            <Animated.View entering={FadeIn.duration(250)}>
              <Text style={styles.stepNumber}>STEP {step} OF 3</Text>

              <Text style={styles.stepTitle}>
                {step === 1
                  ? "Review Pro Plan"
                  : step === 2
                    ? "Confirm Payment"
                    : "Secure Activation"}
              </Text>
            </Animated.View>

            {/* ERROR */}

            {errorMessage && (
              <View style={styles.errorBanner}>
                <Ionicons name="alert-circle" size={18} color={COLORS.danger} />

                <Text style={styles.errorText}>{errorMessage}</Text>
              </View>
            )}

            {/* STEP 1 */}

            {step === 1 && (
              <Animated.View entering={FadeInDown.duration(350)}>
                <View style={styles.planCard}>
                  <View style={styles.planHeader}>
                    <View>
                      <Text style={styles.planName}>DocuGuard Pro</Text>

                      <Text style={styles.planDescription}>
                        Expanded document protection
                      </Text>
                    </View>

                    <View style={styles.proBadge}>
                      <Text style={styles.proBadgeText}>PRO</Text>
                    </View>
                  </View>

                  <View style={styles.priceRow}>
                    <Text style={styles.price}>₱299</Text>

                    <Text style={styles.pricePeriod}>/ year</Text>
                  </View>

                  <View style={styles.divider} />

                  <View style={styles.featureList}>
                    <Feature text="50 GB document storage" />
                    <Feature text="Expiration reminders" />
                    <Feature text="Advanced document management" />
                    <Feature text="Expanded account limits" />
                    <Feature text="Future Pro features included" />
                  </View>
                </View>

                <View style={styles.infoBox}>
                  <Ionicons
                    name="shield-checkmark"
                    size={21}
                    color={DG.emerald}
                  />

                  <Text style={styles.infoText}>
                    Your DocuGuard account will be upgraded to Pro after
                    confirmation.
                  </Text>
                </View>
              </Animated.View>
            )}

            {/* STEP 2 */}

            {step === 2 && (
              <Animated.View entering={FadeInDown.duration(350)}>
                <View style={styles.paymentCard}>
                  <View style={styles.paymentIcon}>
                    <Ionicons name="card-outline" size={30} color={DG.navy} />
                  </View>

                  <Text style={styles.paymentTitle}>Capstone Demo Payment</Text>

                  <Text style={styles.paymentDescription}>
                    This checkout is a simulated payment for the DocuGuard
                    capstone demonstration.
                  </Text>

                  <View style={styles.amountBox}>
                    <Text style={styles.amountLabel}>TOTAL</Text>

                    <Text style={styles.amount}>₱299.00</Text>

                    <Text style={styles.amountPeriod}>
                      Annual Pro subscription
                    </Text>
                  </View>

                  <View style={styles.demoNotice}>
                    <Ionicons
                      name="information-circle"
                      size={20}
                      color={DG.greenText}
                    />

                    <Text style={styles.demoNoticeText}>
                      No real card or financial information is collected.
                      Confirming this screen will simulate a successful payment.
                    </Text>
                  </View>
                </View>
              </Animated.View>
            )}

            {/* STEP 3 */}

            {step === 3 && (
              <Animated.View
                entering={FadeInDown.duration(350)}
                style={styles.gate}
              >
                {!sliderUnlocked ? (
                  <View style={styles.sliderContainer}>
                    <View style={styles.securityIcon}>
                      <Ionicons
                        name="shield-checkmark"
                        size={42}
                        color={DG.emerald}
                      />
                    </View>

                    <Text style={styles.gateTitle}>Final Security Check</Text>

                    <Text style={styles.gateText}>
                      Slide the button to confirm that you want to activate your
                      Pro subscription.
                    </Text>

                    <View style={styles.sliderTrack}>
                      <RNAnimated.View
                        style={[
                          styles.sliderThumb,
                          {
                            transform: [
                              {
                                translateX: slideAnim,
                              },
                            ],
                          },
                        ]}
                        {...panResponder.panHandlers}
                      >
                        <Ionicons
                          name="chevron-forward"
                          size={20}
                          color="#FFFFFF"
                        />
                      </RNAnimated.View>

                      <RNAnimated.Text
                        style={[
                          styles.sliderText,
                          {
                            transform: [
                              {
                                translateX: slideTextAnim,
                              },
                            ],
                          },
                        ]}
                      >
                        Slide right to continue
                      </RNAnimated.Text>
                    </View>
                  </View>
                ) : (
                  <Animated.View
                    entering={FadeIn.duration(300)}
                    style={styles.biometricContainer}
                  >
                    <View style={styles.fingerprintCircle}>
                      <Ionicons
                        name="finger-print"
                        size={70}
                        color={DG.emerald}
                      />
                    </View>

                    <Text style={styles.gateTitle}>Verify Your Identity</Text>

                    <Text style={styles.gateText}>
                      Use your device biometric security to confirm the Pro
                      activation.
                    </Text>

                    <TouchableOpacity
                      style={[
                        styles.confirmBtn,
                        loading && styles.confirmBtnDisabled,
                      ]}
                      onPress={handleBiometricVerification}
                      disabled={loading}
                      activeOpacity={0.85}
                    >
                      {loading ? (
                        <>
                          <ActivityIndicator color="#FFFFFF" />

                          <Text style={[styles.btnText, { marginLeft: 10 }]}>
                            ACTIVATING...
                          </Text>
                        </>
                      ) : (
                        <>
                          <Ionicons
                            name="finger-print"
                            size={21}
                            color="#FFFFFF"
                          />

                          <Text style={[styles.btnText, { marginLeft: 8 }]}>
                            VERIFY & ACTIVATE PRO
                          </Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </Animated.View>
                )}
              </Animated.View>
            )}
          </View>

          {/* FOOTER */}

          <View style={styles.footer}>
            {step > 1 && !loading && (
              <TouchableOpacity
                onPress={() => {
                  setStep((currentStep) => currentStep - 1);
                  setErrorMessage(null);

                  if (step === 3) {
                    setSliderUnlocked(false);
                    slideAnim.setValue(0);
                  }
                }}
                style={styles.backBtn}
              >
                <Ionicons name="arrow-back" size={18} color={DG.slate} />

                <Text style={styles.backText}>BACK</Text>
              </TouchableOpacity>
            )}

            {step < 3 && (
              <TouchableOpacity
                onPress={handleNext}
                style={styles.nextBtn}
                disabled={loading}
                activeOpacity={0.85}
              >
                <Text style={styles.btnText}>
                  {step === 1 ? "REVIEW PAYMENT" : "CONTINUE"}
                </Text>

                <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
              </TouchableOpacity>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <Toast
        visible={toast.visible}
        message={toast.message}
        type={toast.type}
        onDismiss={() =>
          setToast((current) => ({
            ...current,
            visible: false,
          }))
        }
      />
    </View>
  );
}

/*
 * ---------------------------------------------------------
 * FEATURE COMPONENT
 * ---------------------------------------------------------
 */

function Feature({ text }: { text: string }) {
  return (
    <View style={styles.featureRow}>
      <View style={styles.checkCircle}>
        <Ionicons name="checkmark" size={14} color={DG.emerald} />
      </View>

      <Text style={styles.featureText}>{text}</Text>
    </View>
  );
}

/*
 * ---------------------------------------------------------
 * STYLES
 * ---------------------------------------------------------
 */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: DG.bg,
  },

  flex: {
    flex: 1,
  },

  scrollContent: {
    padding: 25,
    paddingBottom: 45,
  },

  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },

  brand: {
    fontSize: 21,
    fontWeight: "900",
    color: DG.navy,
  },

  secureLabel: {
    fontSize: 9,
    fontWeight: "800",
    color: DG.emerald,
    letterSpacing: 1.2,
    marginTop: 2,
  },

  progressContainer: {
    flexDirection: "row",
    gap: 6,
    marginBottom: 30,
  },

  progressSegment: {
    flex: 1,
    height: 4,
    borderRadius: 4,
    backgroundColor: DG.border,
  },

  progressActive: {
    backgroundColor: DG.emerald,
  },

  content: {
    marginBottom: 25,
  },

  stepNumber: {
    fontSize: 11,
    fontWeight: "800",
    color: DG.emerald,
    letterSpacing: 1.2,
    marginBottom: 6,
  },

  stepTitle: {
    fontSize: 29,
    fontWeight: "900",
    color: DG.navy,
    marginBottom: 22,
  },

  planCard: {
    backgroundColor: DG.white,
    borderRadius: 18,
    padding: 22,
    borderWidth: 1,
    borderColor: DG.border,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 3,
    },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },

  planHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },

  planName: {
    fontSize: 21,
    fontWeight: "900",
    color: DG.navy,
  },

  planDescription: {
    fontSize: 13,
    color: DG.slate,
    marginTop: 3,
  },

  proBadge: {
    backgroundColor: DG.navy,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 7,
  },

  proBadgeText: {
    color: DG.white,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1,
  },

  priceRow: {
    flexDirection: "row",
    alignItems: "baseline",
    marginTop: 22,
  },

  price: {
    fontSize: 38,
    fontWeight: "900",
    color: DG.navy,
  },

  pricePeriod: {
    fontSize: 14,
    color: DG.slate,
    marginLeft: 5,
    fontWeight: "600",
  },

  divider: {
    height: 1,
    backgroundColor: DG.border,
    marginVertical: 20,
  },

  featureList: {
    gap: 13,
  },

  featureRow: {
    flexDirection: "row",
    alignItems: "center",
  },

  checkCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: DG.greenBg,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 10,
  },

  featureText: {
    fontSize: 14,
    color: DG.navy,
    fontWeight: "600",
    flex: 1,
  },

  infoBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: DG.greenBg,
    borderRadius: 12,
    padding: 13,
    marginTop: 15,
    gap: 9,
  },

  infoText: {
    flex: 1,
    color: DG.greenText,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "600",
  },

  paymentCard: {
    backgroundColor: DG.white,
    borderRadius: 18,
    padding: 22,
    borderWidth: 1,
    borderColor: DG.border,
    alignItems: "center",
  },

  paymentIcon: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: "#F1F5F9",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 18,
  },

  paymentTitle: {
    fontSize: 21,
    fontWeight: "900",
    color: DG.navy,
    textAlign: "center",
  },

  paymentDescription: {
    color: DG.slate,
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
    marginTop: 8,
  },

  amountBox: {
    width: "100%",
    backgroundColor: "#F8FAFC",
    borderRadius: 13,
    padding: 18,
    alignItems: "center",
    marginTop: 22,
  },

  amountLabel: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1,
    color: DG.muted,
  },

  amount: {
    fontSize: 34,
    fontWeight: "900",
    color: DG.navy,
    marginTop: 3,
  },

  amountPeriod: {
    fontSize: 12,
    color: DG.slate,
    marginTop: 2,
  },

  demoNotice: {
    width: "100%",
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: DG.greenBg,
    borderRadius: 12,
    padding: 13,
    marginTop: 15,
    gap: 9,
  },

  demoNoticeText: {
    flex: 1,
    color: DG.greenText,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "600",
  },

  gate: {
    alignItems: "center",
    marginTop: 15,
  },

  sliderContainer: {
    width: "100%",
    alignItems: "center",
    marginTop: 10,
  },

  securityIcon: {
    width: 82,
    height: 82,
    borderRadius: 41,
    backgroundColor: DG.greenBg,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 18,
  },

  gateTitle: {
    fontSize: 21,
    fontWeight: "900",
    color: DG.navy,
    textAlign: "center",
  },

  gateText: {
    marginTop: 8,
    color: DG.slate,
    fontWeight: "500",
    textAlign: "center",
    fontSize: 14,
    lineHeight: 21,
    maxWidth: 330,
  },

  sliderTrack: {
    width: SLIDER_WIDTH,
    height: 55,
    backgroundColor: DG.border,
    borderRadius: 30,
    justifyContent: "center",
    padding: 5,
    marginTop: 24,
    overflow: "hidden",
  },

  sliderThumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    backgroundColor: DG.navy,
    borderRadius: THUMB_SIZE / 2,
    justifyContent: "center",
    alignItems: "center",
    position: "absolute",
    zIndex: 2,
    left: 5,
    shadowColor: DG.navy,
    shadowOffset: {
      width: 0,
      height: 4,
    },
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

  biometricContainer: {
    alignItems: "center",
    width: "100%",
    marginTop: 10,
  },

  fingerprintCircle: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: DG.greenBg,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
  },

  confirmBtn: {
    marginTop: 25,
    backgroundColor: DG.emerald,
    paddingVertical: 18,
    paddingHorizontal: 22,
    borderRadius: 14,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
  },

  confirmBtnDisabled: {
    opacity: 0.7,
  },

  footer: {
    flexDirection: "row",
    gap: 10,
    marginTop: 10,
  },

  backBtn: {
    flex: 1,
    padding: 18,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 7,
  },

  backText: {
    color: DG.slate,
    fontWeight: "800",
    fontSize: 13,
  },

  nextBtn: {
    flex: 2,
    backgroundColor: DG.navy,
    padding: 19,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },

  btnText: {
    color: DG.white,
    fontWeight: "900",
    fontSize: 13,
  },

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
    lineHeight: 18,
  },
});
