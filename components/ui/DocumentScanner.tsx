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
import { Camera } from "expo-camera";
import { COLORS } from "@/constants";
import { useAlert } from "./AlertService";

let ScannerPlugin: any = null;

try {
  ScannerPlugin = require("react-native-document-scanner-plugin");
} catch (e) {
  console.log("Scanner native module not found");
}

const MAX_PAGES = 10;
const MIN_WIDTH = 800;
const MIN_HEIGHT = 600;

export interface ScannedImageItem {
  uri: string;
  width: number;
  height: number;
}

interface DocumentScannerProps {
  visible: boolean;
  onClose: () => void;
  onScanSuccess: (data: { images: ScannedImageItem[] }) => void;
}

function isValidImageUri(uri: unknown): uri is string {
  if (typeof uri !== "string") return false;
  const value = uri.trim();
  return (
    value.startsWith("file://") ||
    value.startsWith("content://") ||
    value.startsWith("data:image/")
  );
}

function filterValidImageUris(scannedImages: unknown): string[] {
  if (!Array.isArray(scannedImages)) return [];
  return scannedImages.filter(isValidImageUri);
}

type ScannerPhase =
  | "preparing"
  | "capturing"
  | "processing"
  | "success"
  | "error";

export const DocumentScannerComponent = ({
  visible,
  onClose,
  onScanSuccess,
}: DocumentScannerProps) => {
  const [visibleState, setVisibleState] = useState(false);
  const [phase, setPhase] = useState<ScannerPhase>("preparing");
  const [scanning, setScanning] = useState(false);

  const slideAnim = useRef(new Animated.Value(100)).current;

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closedRef = useRef(false);
  const mountedRef = useRef(true);

  const { alert } = useAlert();

  const clearTimers = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      closedRef.current = true;
      clearTimers();
    };
  }, []);

  const open = () => {
    if (!mountedRef.current) return;

    closedRef.current = false;
    setVisibleState(true);
    setScanning(false);
    setPhase("preparing");

    slideAnim.setValue(100);

    Animated.timing(slideAnim, {
      toValue: 0,
      duration: 300,
      useNativeDriver: true,
    }).start();
  };

  const captureDocument = async () => {
    if (scanning || closedRef.current || !mountedRef.current) {
      return;
    }

    setPhase("preparing");
    setScanning(true);

    try {
      // 1. Check/Request Camera Permissions Explicitly
      const { status } = await Camera.requestCameraPermissionsAsync();
      if (status !== "granted") {
        if (!mountedRef.current) return;
        setScanning(false);
        alert(
          "Camera Permission Required",
          "Camera access is required to scan documents. Please enable it in your device settings.",
          {
            type: "warning",
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

      if (closedRef.current || !mountedRef.current) return;

      setPhase("capturing");
      const scanner = ScannerPlugin?.default;

      if (!scanner?.scanDocument) {
        setScanning(false);
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

      const result = await scanner.scanDocument();

      if (closedRef.current || !mountedRef.current) {
        return;
      }

      const validImages = filterValidImageUris(result?.scannedImages).slice(
        0,
        MAX_PAGES,
      );

      if (validImages.length === 0) {
        setScanning(false);
        alert(
          "Scan Cancelled",
          "The document scan was cancelled or no valid image was captured.",
          {
            type: "warning",
            buttons: [
              {
                text: "Cancel",
                style: "cancel",
                onPress: onClose,
              },
              {
                text: "Try Again",
                onPress: () => {
                  captureDocument();
                },
              },
            ],
          },
        );
        return;
      }

      setPhase("processing");

      // Process and validate dimensions for all scanned pages
      const processedImages: ScannedImageItem[] = [];

      for (const imageUri of validImages) {
        await new Promise<void>((resolve) => {
          Image.getSize(
            imageUri,
            (width, height) => {
              if (width >= MIN_WIDTH && height >= MIN_HEIGHT) {
                processedImages.push({ uri: imageUri, width, height });
              }
              resolve();
            },
            () => {
              resolve();
            },
          );
        });
      }

      if (processedImages.length === 0) {
        if (!mountedRef.current || closedRef.current) return;
        setScanning(false);
        setPhase("error");
        alert(
          "Invalid Scan Resolution",
          "The captured document does not meet the minimum resolution quality requirements. Please try again.",
          {
            type: "error",
            buttons: [
              {
                text: "Cancel",
                onPress: onClose,
              },
              {
                text: "Try Again",
                onPress: () => captureDocument(),
              },
            ],
          },
        );
        return;
      }

      setPhase("success");

      clearTimers();
      timeoutRef.current = setTimeout(() => {
        if (closedRef.current || !mountedRef.current) {
          return;
        }

        setScanning(false);
        setPhase("preparing");

        onScanSuccess({
          images: processedImages,
        });
      }, 1200);
    } catch (error: any) {
      if (closedRef.current || !mountedRef.current) {
        return;
      }

      console.error("Document scanner error:", error);
      setScanning(false);
      setPhase("error");

      alert(
        "Scanning Error",
        "Something went wrong while capturing the document.",
        {
          type: "error",
          buttons: [
            {
              text: "Cancel",
              onPress: onClose,
            },
            {
              text: "Try Again",
              onPress: () => captureDocument(),
            },
          ],
        },
      );
    }
  };

  useEffect(() => {
    if (visible) {
      open();
      clearTimers();

      timeoutRef.current = setTimeout(() => {
        if (!closedRef.current && mountedRef.current) {
          captureDocument();
        }
      }, 500);

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
      setPhase("preparing");

      slideAnim.stopAnimation();
      slideAnim.setValue(100);
    }
  }, [visible]);

  const handleClose = () => {
    closedRef.current = true;
    clearTimers();

    if (mountedRef.current) {
      setScanning(false);
      setPhase("preparing");

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
          {phase === "preparing" && (
            <View
              style={styles.instructionBox}
              accessible
              accessibilityRole="text"
              accessibilityLabel="Preparing scanner"
            >
              <Ionicons name="scan-outline" size={36} color="#fff" />
              <Text style={styles.instructionTitle}>Preparing scanner...</Text>
              <ActivityIndicator
                color="#fff"
                style={styles.activityIndicator}
              />
            </View>
          )}

          {phase === "capturing" && (
            <View
              style={styles.instructionBox}
              accessible
              accessibilityRole="text"
              accessibilityLabel="Scanning document"
            >
              <Ionicons name="camera-outline" size={36} color="#fff" />
              <Text style={styles.instructionTitle}>Scanning document...</Text>
              <ActivityIndicator
                color="#fff"
                style={styles.activityIndicator}
              />
            </View>
          )}

          {phase === "processing" && (
            <View
              style={styles.instructionBox}
              accessible
              accessibilityRole="text"
              accessibilityLabel="Processing scan"
            >
              <Ionicons name="sync-outline" size={36} color="#fff" />
              <Text style={styles.instructionTitle}>Processing scan...</Text>
              <ActivityIndicator
                color="#fff"
                style={styles.activityIndicator}
              />
            </View>
          )}

          {phase === "success" && (
            <View
              style={styles.instructionBox}
              accessible
              accessibilityRole="text"
              accessibilityLabel="Scan successful"
            >
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
          hitSlop={{ top: 20, bottom: 20, left: 20, right: 20 }}
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
