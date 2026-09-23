import React, { useEffect, useRef, useState } from "react";
import {
  View,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Alert,
  Image,
  PanResponder,
  Animated,
  Text,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "@/constants";

let ScannerPlugin: any = null;
try {
  ScannerPlugin = require("react-native-document-scanner-plugin");
} catch (e) {
  console.log("Scanner native module not found");
}

interface DocumentScannerProps {
  visible: boolean;
  onClose: () => void;
  onScanSuccess: (data: { uri: string; width: number; height: number }) => void;
}

const STABILIZATION_SECONDS = 5;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function filterValidImageUris(scannedImages: unknown): string[] {
  if (!Array.isArray(scannedImages)) return [];
  return scannedImages.filter(isNonEmptyString);
}

type ScannerPhase = "stabilizing" | "capturing" | "success";

export const DocumentScannerComponent = ({
  visible,
  onClose,
  onScanSuccess,
}: DocumentScannerProps) => {
  const [visibleState, setVisibleState] = useState(false);
  const slideAnim = useRef(new Animated.Value(0)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;

  const [phase, setPhase] = useState<ScannerPhase>("stabilizing");
  const [countdown, setCountdown] = useState(STABILIZATION_SECONDS);
  const [scanning, setScanning] = useState(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closedRef = useRef(false);

  const clearTimers = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      closedRef.current = true;
    };
  }, []);

  const open = () => {
    setVisibleState(true);
    setScanning(false);
    setPhase("stabilizing");
    setCountdown(STABILIZATION_SECONDS);
    closedRef.current = false;
    slideAnim.setValue(0);
    Animated.timing(slideAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  };

  const beginStabilization = () => {
    if (closedRef.current) return;
    setPhase("stabilizing");
    setCountdown(STABILIZATION_SECONDS);
    let remaining = STABILIZATION_SECONDS;

    Animated.timing(progressAnim, {
      toValue: 1,
      duration: STABILIZATION_SECONDS * 1000,
      useNativeDriver: false,
    }).start();

    intervalRef.current = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearTimers();
        setCountdown(0);
        if (!closedRef.current) {
          captureDocument();
        }
      } else {
        setCountdown(remaining);
      }
    }, 1000);
  };

  const captureDocument = async () => {
    setPhase("capturing");
    setScanning(true);

    if (!ScannerPlugin || !ScannerPlugin.default) {
      setScanning(false);
      Alert.alert(
        "Scanner Unavailable",
        "Native module not linked. Build a development client.",
        [{ text: "OK", onPress: onClose }],
      );
      return;
    }

    try {
      const result =
        await ScannerPlugin.default.scanDocument().catch(() => null);

      const { scannedImages } = result || {};
      const validImages = filterValidImageUris(scannedImages);

      if (validImages.length === 0) {
        setScanning(false);
        Alert.alert(
          "Scan Failed",
          "No valid image was captured. Please try again.",
          [{ text: "OK", onPress: onClose }],
        );
        return;
      }

      const imageUri = validImages[0];

      setPhase("success");

      const finish = (width: number, height: number) => {
        timeoutRef.current = setTimeout(() => {
          setScanning(false);
          setPhase("stabilizing");
          if (!closedRef.current) {
            onScanSuccess({ uri: imageUri, width, height });
          }
        }, 1400);
      };

      Image.getSize(
        imageUri,
        (width, height) => finish(width, height),
        () => finish(0, 0),
      );
    } catch (error) {
      setScanning(false);
      Alert.alert(
        "Scanning Error",
        "Something went wrong while capturing the document.",
        [{ text: "OK", onPress: onClose }],
      );
    }
  };

  useEffect(() => {
    if (visible) {
      open();
      timeoutRef.current = setTimeout(() => beginStabilization(), 600);
      return () => {
        closedRef.current = true;
        clearTimers();
      };
    } else {
      closedRef.current = true;
      clearTimers();
      setVisibleState(false);
      setScanning(false);
      setPhase("stabilizing");
    }
  }, [visible]);

  const handleClose = () => {
    closedRef.current = true;
    clearTimers();
    setVisibleState(false);
    setScanning(false);
    setPhase("stabilizing");
    onClose();
  };

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: () => !scanning,
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dy > 0 && !scanning) {
          slideAnim.setValue(gestureState.dy);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dy > 100 && !scanning) {
          handleClose();
        } else if (!scanning) {
          Animated.spring(slideAnim, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        }
      },
    }),
  ).current;

  if (!visibleState) return null;

  return (
    <Modal
      visible={true}
      animationType="none"
      transparent
      presentationStyle="overFullScreen"
    >
      <Animated.View
        style={[
          styles.modalOverlay,
          { transform: [{ translateY: slideAnim }] },
        ]}
        {...panResponder.panHandlers}
      >
        <View style={styles.stabilizationContent}>
          {phase === "stabilizing" && (
            <View style={styles.instructionBox}>
              <Ionicons name="scan-circle-outline" size={36} color="#fff" />
              <Text style={styles.instructionTitle}>Please stop moving</Text>

              <Text style={styles.instructionSubtitle}>
                Capturing the information in {countdown > 0 ? countdown : "…"}
              </Text>

              <View style={styles.progressTrack}>
                <Animated.View
                  style={[
                    styles.progressFill,
                    {
                      width: progressAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: ["0%", "100%"],
                      }),
                    },
                  ]}
                />
              </View>
            </View>
          )}

          {phase === "capturing" && (
            <View style={styles.instructionBox}>
              <Ionicons name="scan-outline" size={36} color="#fff" />
              <Text style={styles.instructionTitle}>Capturing document…</Text>
              <ActivityIndicator color="#fff" style={styles.activityIndicator} />
            </View>
          )}

          {phase === "success" && (
            <View style={styles.instructionBox}>
              <Ionicons name="checkmark-circle" size={56} color={COLORS.success} />
              <Text style={styles.instructionTitle}>Scan Successful</Text>
              <Text style={styles.instructionSubtitle}>
                Document captured successfully
              </Text>
            </View>
          )}
        </View>

        <TouchableOpacity
          style={styles.closeButton}
          onPress={handleClose}
          hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
          accessibilityLabel="Close scanner"
        >
          <View style={styles.closeButtonInner}>
            <Ionicons name="close" size={28} color="#fff" />
            <Text style={styles.closeLabel}>Close</Text>
          </View>
        </TouchableOpacity>
      </Animated.View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    justifyContent: "flex-end",
  },
  stabilizationContent: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  instructionBox: {
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.4)",
    borderRadius: 20,
    paddingHorizontal: 28,
    paddingVertical: 28,
    marginHorizontal: 24,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.2)",
  },
  instructionTitle: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "700",
    marginTop: 12,
    textAlign: "center",
  },
  instructionSubtitle: {
    color: "#E5E7EB",
    fontSize: 16,
    fontWeight: "600",
    marginTop: 8,
    textAlign: "center",
  },
  activityIndicator: {
    marginTop: 16,
  },
  progressTrack: {
    marginTop: 16,
    width: 160,
    height: 5,
    backgroundColor: "rgba(255, 255, 255, 0.25)",
    borderRadius: 4,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: COLORS.success,
    borderRadius: 4,
  },
  closeButton: {
    alignSelf: "center",
    marginBottom: 40,
    padding: 10,
  },
  closeButtonInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 30,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.3)",
  },
  closeLabel: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
