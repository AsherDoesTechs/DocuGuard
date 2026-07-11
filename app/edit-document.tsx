import { StyleSheet, Text, View } from "react-native";
import React from "react";

export default function EditDocumentScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Edit Document</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", alignItems: "center" },
  title: { fontSize: 20, fontWeight: "bold" },
});
