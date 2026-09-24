import React, { useEffect, useRef, useState } from "react";
import {
  View,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Image,
  PanResponder,
  Animated,
  Text,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "@/constants";
import { useAlert } from "./AlertService";

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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function filterValidImageUris(scannedImages: unknown): string[] {
  if (!Array.isArray(scannedImages)) return [];

  return scannedImages.filter(isNonEmptyString);
}

type ScannerPhase = "capturing" | "success";

export const DocumentScannerComponent = ({
  visible,
  onClose,
  onScanSuccess,
}: DocumentScannerProps) => {
  const [visibleState, setVisibleState] = useState(false);
  const [phase, setPhase] = useState<ScannerPhase>("capturing");
  const [scanning, setScanning] = useState(false);

  const slideAnim = useRef(new Animated.Value(100)).current;

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closedRef = useRef(false);
  const mountedRef = useRef(true);

  const { alert } = useAlert();

  /**
   * Clear any pending timeout.
   */
  const clearTimers = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  /**
   * Component cleanup.
   */
  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      closedRef.current = true;
      clearTimers();
    };
  }, []);

  /**
   * Open scanner UI.
   */
  const open = () => {
    if (!mountedRef.current) return;

    closedRef.current = false;

    setVisibleState(true);
    setScanning(false);
    setPhase("capturing");

    slideAnim.setValue(100);

    Animated.timing(slideAnim, {
      toValue: 0,
      duration: 300,
      useNativeDriver: true,
    }).start();
  };

  /**
   * Capture a document using the native scanner.
   */
  const captureDocument = async () => {
    if (closedRef.current || !mountedRef.current) {
      return;
    }

    setPhase("capturing");
    setScanning(true);

    const scanner = ScannerPlugin?.default;

    if (!scanner?.scanDocument) {
      if (mountedRef.current) {
        setScanning(false);
      }

      alert(
        "Scanner Unavailable",
        "Native module not linked. Build a development client.",
        {
          type: "error",
          buttons: [
            {
              text: "OK",
              onPress: onClose,
            },
          ],
        },
      );

      return;
    }

    try {
      const result = await scanner.scanDocument();

      /**
       * The native scanner can finish after the user
       * has already closed the modal.
       */
      if (closedRef.current || !mountedRef.current) {
        return;
      }

      const validImages = filterValidImageUris(result?.scannedImages);

      if (validImages.length === 0) {
        setScanning(false);

        alert("Scan Failed", "No valid image was captured. Please try again.", {
          type: "error",
          buttons: [
            {
              text: "OK",
              onPress: onClose,
            },
          ],
        });

        return;
      }

      const imageUri = validImages[0];

      setPhase("success");

      const finish = (width: number, height: number) => {
        clearTimers();

        timeoutRef.current = setTimeout(() => {
          /**
           * Do not update state or call the parent
           * if the scanner has already been closed.
           */
          if (closedRef.current || !mountedRef.current) {
            return;
          }

          setScanning(false);
          setPhase("capturing");

          onScanSuccess({
            uri: imageUri,
            width,
            height,
          });
        }, 1400);
      };

      Image.getSize(
        imageUri,
        (width, height) => {
          finish(width, height);
        },
        () => {
          finish(0, 0);
        },
      );
    } catch (error) {
      if (closedRef.current || !mountedRef.current) {
        return;
      }

      console.error("Document scanner error:", error);

      setScanning(false);

      alert(
        "Scanning Error",
        "Something went wrong while capturing the document.",
        {
          type: "error",
          buttons: [
            {
              text: "OK",
              onPress: onClose,
            },
          ],
        },
      );
    }
  };

  /**
   * Open/close lifecycle.
   */
  useEffect(() => {
    if (visible) {
      open();

      clearTimers();

      timeoutRef.current = setTimeout(() => {
        if (!closedRef.current && mountedRef.current) {
          captureDocument();
        }
      }, 600);

      return () => {
        closedRef.current = true;
        clearTimers();
      };
    }

    closedRef.current = true;
    clearTimers();

    if (mountedRef.current) {
      setVisibleState(false);
      setScanning(false);
      setPhase("capturing");

      slideAnim.stopAnimation();
      slideAnim.setValue(100);
    }
  }, [visible]);

  /**
   * Close scanner.
   */
  const handleClose = () => {
    closedRef.current = true;
    clearTimers();

    if (mountedRef.current) {
      setScanning(false);
      setPhase("capturing");

      Animated.timing(slideAnim, {
        toValue: 100,
        duration: 220,
        useNativeDriver: true,
      }).start(() => {
        if (!mountedRef.current) return;

        setVisibleState(false);
        onClose();
      });
    } else {
      onClose();
    }
  };

  /**
   * Swipe-down-to-close gesture.
   */
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => {
        if (scanning) return false;

        return (
          Math.abs(gestureState.dy) > Math.abs(gestureState.dx) &&
          gestureState.dy > 10
        );
      },

      onPanResponderMove: (_, gestureState) => {
        if (scanning) return;

        const nextY = Math.max(0, gestureState.dy);

        slideAnim.setValue(nextY);
      },

      onPanResponderRelease: (_, gestureState) => {
        if (scanning) return;

        if (gestureState.dy > 100) {
          handleClose();
          return;
        }

        Animated.spring(slideAnim, {
          toValue: 0,
          useNativeDriver: true,
        }).start();
      },

      onPanResponderTerminate: () => {
        if (scanning) return;

        Animated.spring(slideAnim, {
          toValue: 0,
          useNativeDriver: true,
        }).start();
      },
    }),
  ).current;

  if (!visibleState) {
    return null;
  }

  return (
    <Modal
      visible={true}
      animationType="none"
      transparent
      presentationStyle="overFullScreen"
      onRequestClose={handleClose}
    >
      <Animated.View
        style={[
          styles.modalOverlay,
          {
            transform: [{ translateY: slideAnim }],
          },
        ]}
        {...panResponder.panHandlers}
      >
        <View style={styles.stabilizationContent}>
          {phase === "capturing" && (
            <View style={styles.instructionBox}>
              <Ionicons name="scan-outline" size={36} color="#fff" />

              <Text style={styles.instructionTitle}>Capturing document…</Text>

              <ActivityIndicator
                color="#fff"
                style={styles.activityIndicator}
              />
            </View>
          )}

          {phase === "success" && (
            <View style={styles.instructionBox}>
              <Ionicons
                name="checkmark-circle"
                size={56}
                color={COLORS.success}
              />

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
          disabled={false}
          hitSlop={{
            top: 20,
            bottom: 20,
            left: 20,
            right: 20,
          }}
          accessibilityRole="button"
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
