import React, { useEffect } from "react";
import {
  View,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Alert,
  Image,
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
  const handleManualScan = async () => {
    if (!ScannerPlugin || !ScannerPlugin.default) {
      Alert.alert(
        "Scanner Unavailable",
        "Native module not linked. Build a development client.",
      );
      return;
    }

    try {
      // Triggers the OS-level scanner UI
      const { scannedImages } = await ScannerPlugin.default.scanDocument();

      if (scannedImages && scannedImages.length > 0) {
        const imageUri = scannedImages[0];

        // Zero-work metadata extraction
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
        onClose(); // Close if user canceled the scan
      }
    } catch (error) {
      console.error("Scanning error:", error);
      onClose();
    }
  };

  // Auto-trigger the scan when the modal becomes visible
  useEffect(() => {
    if (visible) {
      // Small timeout to allow the modal animation to settle before launching camera
      const timer = setTimeout(handleManualScan, 500);
      return () => clearTimeout(timer);
    }
  }, [visible]);

  return (
    <Modal
      visible={visible}
      animationType="fade"
      presentationStyle="fullScreen"
    >
      <View style={styles.container}>
        {/* Placeholder UI while the native scanner camera is active */}
        <TouchableOpacity style={styles.closeButton} onPress={onClose}>
          <Ionicons name="close" size={32} color="#fff" />
        </TouchableOpacity>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  closeButton: { position: "absolute", top: 50, left: 20, padding: 10 },
});
