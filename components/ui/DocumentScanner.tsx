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

export const DocumentScannerComponent = ({
  visible,
  onClose,
  onScanSuccess,
}: DocumentScannerProps) => {
  const [visibleState, setVisibleState] = useState(false);
  const slideAnim = useState(new Animated.Value(0))[0];

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (_, gestureState) => {
        if (gestureState.dy > 0) {
          slideAnim.setValue(gestureState.dy);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dy > 100) {
          onClose();
        } else {
          Animated.spring(slideAnim, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        }
      },
    }),
  ).current;

  useEffect(() => {
    if (visible) {
      setVisibleState(true);
      slideAnim.setValue(0);
      Animated.timing(slideAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start();
      const timer = setTimeout(handleManualScan, 500);
      return () => {
        clearTimeout(timer);
        Animated.timing(slideAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }).start();
      };
    } else {
      setVisibleState(false);
    }
  }, [visible]);

  const handleManualScan = async () => {
    if (!ScannerPlugin || !ScannerPlugin.default) {
      Alert.alert(
        "Scanner Unavailable",
        "Native module not linked. Build a development client.",
      );
      return;
    }

    try {
      const { scannedImages } = await ScannerPlugin.default.scanDocument();

      if (scannedImages && scannedImages.length > 0) {
        const imageUri = scannedImages[0];

        Image.getSize(
          imageUri,
          (width, height) => {
            onScanSuccess({ uri: imageUri, width, height });
          },
          (error) => {
            console.error("Dimension error:", error);
            onScanSuccess({ uri: imageUri, width: 0, height: 0 });
          },
        );
      } else {
        onClose();
      }
    } catch (error) {
      console.error("Scanning error:", error);
      onClose();
    }
  };

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
        <TouchableOpacity
          style={styles.closeButton}
          onPress={onClose}
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
