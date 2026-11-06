import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";

import {
  getAdminOverview,
  logoutAdmin,
  type AdminMetrics,
} from "../services/adminApi";
import { clearAdminToken, getAdminToken } from "../services/adminSession";

export default function AdminDashboardScreen() {
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setErrorMessage("");

    try {
      const token = await getAdminToken();

      if (!token) {
        router.replace("/");
        return;
      }

      const response = await getAdminOverview(token);
      setMetrics(response.metrics);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to load the administrator overview.";

      setErrorMessage(message);
    } finally {
      setLoading(false);
    }
  }, []);

 useEffect(() => {
  // Initial API request; loadOverview handles loading and data state.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  void loadOverview();
}, [loadOverview]);

  const handleSignOut = async () => {
    try {
      const token = await getAdminToken();
      if (token) {
        await logoutAdmin(token);
      } else {
        await clearAdminToken();
      }
      router.replace("/");
    } catch {
      Alert.alert(
        "Sign-out failed",
        "The local session could not be cleared. Please try again.",
      );
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>DocuGuard</Text>
            <Text style={styles.subtitle}>ADMINISTRATION</Text>
          </View>

          <Pressable
            style={styles.signOutButton}
            onPress={handleSignOut}
            accessibilityRole="button"
          >
            <Text style={styles.signOutText}>Sign out</Text>
          </Pressable>
        </View>

        <Text style={styles.heading}>Overview</Text>
        <Text style={styles.description}>
          Monitor the DocuGuard system at a glance.
        </Text>

        {loading ? (
          <View style={styles.statusContainer}>
            <ActivityIndicator size="large" color="#204D91" />
            <Text style={styles.statusText}>Loading overview…</Text>
          </View>
        ) : errorMessage ? (
          <View style={styles.messageCard}>
            <Text style={styles.errorTitle}>Unable to load overview</Text>
            <Text style={styles.errorText}>{errorMessage}</Text>

            <Pressable
              style={styles.retryButton}
              onPress={() => void loadOverview()}
            >
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </View>
        ) : metrics ? (
          <View style={styles.metrics}>
            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>Registered users</Text>
              <Text style={styles.metricValue}>{metrics.totalUsers}</Text>
            </View>

            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>Active documents</Text>
              <Text style={styles.metricValue}>{metrics.totalDocuments}</Text>
            </View>
          </View>
        ) : null}

        <Text style={styles.note}>
          This is the initial administrator overview. Additional management
          features can be added after authentication and API access are
          verified.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#F3F6FB",
  },
  content: {
    flexGrow: 1,
    padding: 22,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 35,
  },
  brand: {
    color: "#15366B",
    fontSize: 25,
    fontWeight: "800",
  },
  subtitle: {
    color: "#718096",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.7,
    marginTop: 4,
  },
  signOutButton: {
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#DCE4EF",
    backgroundColor: "#FFFFFF",
  },
  signOutText: {
    color: "#204D91",
    fontWeight: "700",
  },
  heading: {
    color: "#172B4D",
    fontSize: 28,
    fontWeight: "800",
  },
  description: {
    color: "#68778D",
    fontSize: 14,
    marginTop: 8,
    marginBottom: 25,
  },
  metrics: {
    gap: 16,
  },
  metricCard: {
    padding: 22,
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E4EAF3",
  },
  metricLabel: {
    color: "#68778D",
    fontSize: 14,
    fontWeight: "600",
  },
  metricValue: {
    color: "#15366B",
    fontSize: 36,
    fontWeight: "800",
    marginTop: 12,
  },
  statusContainer: {
    alignItems: "center",
    padding: 35,
  },
  statusText: {
    color: "#68778D",
    marginTop: 12,
  },
  messageCard: {
    padding: 22,
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E4EAF3",
  },
  errorTitle: {
    color: "#9B2C2C",
    fontSize: 17,
    fontWeight: "700",
  },
  errorText: {
    color: "#68778D",
    fontSize: 14,
    lineHeight: 21,
    marginTop: 10,
  },
  retryButton: {
    alignSelf: "flex-start",
    backgroundColor: "#204D91",
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 11,
    marginTop: 18,
  },
  retryText: {
    color: "#FFFFFF",
    fontWeight: "700",
  },
  note: {
    color: "#7A8799",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 30,
  },
});
