import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { getAdminToken } from "../services/adminSession";

type SystemHealthData = {
  status: "healthy" | "degraded" | "critical";
  uptime: string;
  database: {
    status: "connected" | "disconnected";
    latencyMs: number;
  };
  supabaseStorage: {
    status: "operational" | "degraded" | "down";
    bucketUsageBytes: number;
    totalFiles: number;
  };
  azureOcr: {
    status: "operational" | "degraded" | "down";
    pendingQueueCount: number;
    successRate24h: number; // percentage e.g. 99.4
  };
  lastChecked: string;
};

export default function AdminHealthScreen() {
  const [health, setHealth] = useState<SystemHealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  const fetchHealthMetrics = useCallback(async () => {
    setLoading(true);
    setErrorMessage("");

    try {
      const token = await getAdminToken();
      if (!token) {
        router.replace("/");
        return;
      }

      const API_BASE_URL =
        process.env.EXPO_PUBLIC_API_BASE_URL ??
        "https://docuguard-api-onoj.onrender.com";
      const response = await fetch(`${API_BASE_URL}/admin/health`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      });

      if (response.status === 401) {
        router.replace("/");
        throw new Error("Session expired. Please sign in again.");
      }

      if (!response.ok) {
        throw new Error(
          "Failed to retrieve system health metrics from the server.",
        );
      }

      const data = await response.json();
      setHealth(data.health || data);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "An unexpected error occurred.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchHealthMetrics();
  }, [fetchHealthMetrics]);

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return "0 MB";
    const mb = bytes / (1024 * 1024);
    if (mb > 1024) {
      return (mb / 1024).toFixed(2) + " GB";
    }
    return mb.toFixed(2) + " MB";
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {/* Header */}
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.title}>System Health & Storage</Text>
          <Text style={styles.subtitle}>
            Monitor database, Supabase storage, and Azure OCR pipeline status
          </Text>
        </View>
        <Pressable
          style={styles.refreshButton}
          onPress={() => void fetchHealthMetrics()}
        >
          <Ionicons name="refresh-outline" size={18} color="#204D91" />
          <Text style={styles.refreshText}>Refresh</Text>
        </Pressable>
      </View>

      {/* Content Body */}
      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#204D91" />
          <Text style={styles.centerText}>
            Running system health diagnostics...
          </Text>
        </View>
      ) : errorMessage ? (
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle-outline" size={32} color="#9B2C2C" />
          <Text style={styles.errorTitle}>Diagnostics Failed</Text>
          <Text style={styles.errorText}>{errorMessage}</Text>
          <Pressable
            style={styles.retryButton}
            onPress={() => void fetchHealthMetrics()}
          >
            <Text style={styles.retryButtonText}>Try again</Text>
          </Pressable>
        </View>
      ) : health ? (
        <View style={styles.gridContainer}>
          {/* Overall Status Card */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Overall System Status</Text>
              <View
                style={[
                  styles.badge,
                  health.status === "healthy"
                    ? styles.badgeGreen
                    : styles.badgeRed,
                ]}
              >
                <Text
                  style={[
                    styles.badgeText,
                    health.status === "healthy"
                      ? styles.badgeTextGreen
                      : styles.badgeTextRed,
                  ]}
                >
                  {health.status.toUpperCase()}
                </Text>
              </View>
            </View>
            <Text style={styles.cardSubtitle}>
              Server Uptime: {health.uptime}
            </Text>
            <Text style={styles.timestampText}>
              Last checked: {new Date(health.lastChecked).toLocaleTimeString()}
            </Text>
          </View>

          {/* Database Card */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.cardTitleRow}>
                <Ionicons name="server-outline" size={20} color="#204D91" />
                <Text style={styles.cardTitle}>Database Connection</Text>
              </View>
              <View
                style={[
                  styles.badge,
                  health.database.status === "connected"
                    ? styles.badgeGreen
                    : styles.badgeRed,
                ]}
              >
                <Text
                  style={[
                    styles.badgeText,
                    health.database.status === "connected"
                      ? styles.badgeTextGreen
                      : styles.badgeTextRed,
                  ]}
                >
                  {health.database.status.toUpperCase()}
                </Text>
              </View>
            </View>
            <Text style={styles.metricDetail}>
              Query Latency:{" "}
              <Text style={styles.metricHighlight}>
                {health.database.latencyMs} ms
              </Text>
            </Text>
          </View>

          {/* Supabase Storage Card */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.cardTitleRow}>
                <Ionicons name="cloud-outline" size={20} color="#204D91" />
                <Text style={styles.cardTitle}>Supabase Storage Vault</Text>
              </View>
              <View
                style={[
                  styles.badge,
                  health.supabaseStorage.status === "operational"
                    ? styles.badgeGreen
                    : styles.badgeYellow,
                ]}
              >
                <Text
                  style={[
                    styles.badgeText,
                    health.supabaseStorage.status === "operational"
                      ? styles.badgeTextGreen
                      : styles.badgeTextYellow,
                  ]}
                >
                  {health.supabaseStorage.status.toUpperCase()}
                </Text>
              </View>
            </View>
            <View style={styles.metricRow}>
              <Text style={styles.metricDetail}>
                Total Vault Files:{" "}
                <Text style={styles.metricHighlight}>
                  {health.supabaseStorage.totalFiles}
                </Text>
              </Text>
              <Text style={styles.metricDetail}>
                Storage Footprint:{" "}
                <Text style={styles.metricHighlight}>
                  {formatBytes(health.supabaseStorage.bucketUsageBytes)}
                </Text>
              </Text>
            </View>
          </View>

          {/* Azure OCR Pipeline Card */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.cardTitleRow}>
                <Ionicons
                  name="document-text-outline"
                  size={20}
                  color="#204D91"
                />
                <Text style={styles.cardTitle}>
                  Azure Document Intelligence OCR
                </Text>
              </View>
              <View
                style={[
                  styles.badge,
                  health.azureOcr.status === "operational"
                    ? styles.badgeGreen
                    : styles.badgeYellow,
                ]}
              >
                <Text
                  style={[
                    styles.badgeText,
                    health.azureOcr.status === "operational"
                      ? styles.badgeTextGreen
                      : styles.badgeTextYellow,
                  ]}
                >
                  {health.azureOcr.status.toUpperCase()}
                </Text>
              </View>
            </View>
            <View style={styles.metricRow}>
              <Text style={styles.metricDetail}>
                Pending OCR Queue:{" "}
                <Text style={styles.metricHighlight}>
                  {health.azureOcr.pendingQueueCount}
                </Text>
              </Text>
              <Text style={styles.metricDetail}>
                24h Success Rate:{" "}
                <Text style={styles.metricHighlight}>
                  {health.azureOcr.successRate24h}%
                </Text>
              </Text>
            </View>
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: 24,
    backgroundColor: "#F3F6FB",
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: "800",
    color: "#172B4D",
  },
  subtitle: {
    fontSize: 13,
    color: "#68778D",
    marginTop: 2,
  },
  refreshButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#DCE4EF",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  refreshText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#204D91",
  },
  gridContainer: {
    gap: 16,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: "#E4EAF3",
    shadowColor: "#15366B",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.03,
    shadowRadius: 10,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  cardTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#172B4D",
  },
  cardSubtitle: {
    fontSize: 13,
    color: "#68778D",
    marginBottom: 4,
  },
  timestampText: {
    fontSize: 11,
    color: "#8A96A8",
    marginTop: 2,
  },
  metricRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 6,
  },
  metricDetail: {
    fontSize: 13,
    color: "#68778D",
  },
  metricHighlight: {
    fontWeight: "700",
    color: "#172B4D",
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeGreen: {
    backgroundColor: "#DEF7EC",
  },
  badgeYellow: {
    backgroundColor: "#FEF3C7",
  },
  badgeRed: {
    backgroundColor: "#FDE8E8",
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "700",
  },
  badgeTextGreen: {
    color: "#03543F",
  },
  badgeTextYellow: {
    color: "#92400E",
  },
  badgeTextRed: {
    color: "#9B1C1C",
  },
  centerContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 80,
  },
  centerText: {
    color: "#68778D",
    marginTop: 10,
    fontSize: 14,
  },
  errorContainer: {
    padding: 24,
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E4EAF3",
    marginTop: 20,
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#9B2C2C",
    marginTop: 10,
  },
  errorText: {
    fontSize: 13,
    color: "#68778D",
    textAlign: "center",
    marginTop: 4,
    marginBottom: 16,
  },
  retryButton: {
    backgroundColor: "#204D91",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryButtonText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 13,
  },
});
