import React from "react";
import { View, Text, StyleSheet, Image, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "../../constants/colors";

interface DocumentPreviewProps {
  fileUrl?: string;
  fileType?: string;
  onPress?: () => void;
}

export const DocumentPreview: React.FC<DocumentPreviewProps> = ({
  fileUrl,
  fileType,
  onPress,
}) => {
  const isImage =
    fileUrl &&
    (fileUrl.endsWith(".jpg") ||
      fileUrl.endsWith(".png") ||
      fileUrl.endsWith(".jpeg") ||
      fileType?.includes("image"));
  const isPdf =
    fileUrl && (fileUrl.endsWith(".pdf") || fileType?.includes("pdf"));

  return (
    <TouchableOpacity
      onPress={onPress}
      style={styles.container}
      activeOpacity={0.8}
    >
      {isImage ? (
        <Image
          source={{ uri: fileUrl }}
          style={styles.previewImage}
          resizeMode="cover"
        />
      ) : isPdf ? (
        <View style={styles.placeholderContainer}>
          <Ionicons name="document-text" size={48} color={COLORS.primary} />
          <Text style={styles.fileText}>PDF Document Preview</Text>
        </View>
      ) : (
        <View style={styles.placeholderContainer}>
          <Ionicons name="folder-open" size={48} color={COLORS.textSecondary} />
          <Text style={styles.fileText}>No Preview Available</Text>
        </View>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    width: "100%",
    height: 200,
    borderRadius: 12,
    backgroundColor: "#F3F4F6",
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center",
    marginVertical: 10,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  previewImage: {
    width: "100%",
    height: "100%",
  },
  placeholderContainer: {
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  fileText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    fontWeight: "500",
  },
});
