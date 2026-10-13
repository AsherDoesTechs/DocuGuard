import React, { type ReactNode, useMemo } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useColors } from "@/context/ThemeContext";
import { Spacing } from "@/constants";

interface AuthScreenProps {
  title: string;
  subtitle: string | ReactNode;
  icon?: keyof typeof Ionicons.glyphMap;
  children: ReactNode;
}

export function AuthScreen({
  title,
  subtitle,
  icon = "shield-checkmark-outline",
  children,
}: AuthScreenProps) {
  const colors = useColors();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        safeArea: { flex: 1, backgroundColor: colors.background },
        keyboard: { flex: 1 },
        scroll: { flex: 1 },
        content: {
          flexGrow: 1,
          width: "100%",
          maxWidth: 560,
          alignSelf: "center",
          paddingHorizontal: 20,
          paddingTop: Spacing.lg,
          paddingBottom: 36,
        },
        header: {
          alignItems: "center",
          marginBottom: 24,
        },
        iconContainer: {
          width: 58,
          height: 58,
          borderRadius: 18,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.primaryLight,
          borderWidth: 1,
          borderColor: colors.borderLight,
          marginBottom: 16,
        },
        title: {
          color: colors.text,
          fontSize: 28,
          lineHeight: 34,
          fontWeight: "700",
          letterSpacing: -0.4,
          textAlign: "center",
        },
        subtitle: {
          color: colors.textSecondary,
          fontSize: 15,
          lineHeight: 22,
          textAlign: "center",
          marginTop: 8,
          maxWidth: 360,
        },
      }),
    [colors],
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={styles.keyboard}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <View style={styles.iconContainer}>
              <Ionicons name={icon} size={30} color={colors.primary} />
            </View>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.subtitle}>{subtitle}</Text>
          </View>
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
