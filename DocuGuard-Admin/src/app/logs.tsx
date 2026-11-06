
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { getAdminToken } from "../services/adminSession";

// Define Audit Log item type
type AuditLogEntry = {
  id: string | number;
  action: string;
  actor: string;
  severity: "info" | "warning" | "critical";
  ipAddress?: string;
  timestamp: string;
  details?: string;
};

export default function AdminLogsScreen() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  const fetchLogs = useCallback(async () => {
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

      const response = await fetch(`${API_BASE_URL}/admin/logs`, {
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
          "Failed to load security audit logs from the server.",
        );
      }

      const data = await response.json();
      const logList = data.logs || data || [];

      setLogs(logList);
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
  // Initial API request; fetchLogs manages loading and data state.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  void fetchLogs();
}, [fetchLogs]);

  // Derive filtered logs instead of maintaining duplicate state.
  const filteredLogs = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    if (!query) {
      return logs;
    }

    return logs.filter(
      (log) =>
        log.action.toLowerCase().includes(query) ||
        log.actor.toLowerCase().includes(query) ||
        (log.details && log.details.toLowerCase().includes(query)),
    );
  }, [logs, searchQuery]);

  const handleInspectLog = (log: AuditLogEntry) => {
    Alert.alert(
      "Audit Log Details",
      `Action: ${log.action}\nActor: ${log.actor}\nSeverity: ${log.severity.toUpperCase()}\nTime: ${new Date(log.timestamp).toLocaleString()}\nIP: ${log.ipAddress || "N/A"}\nDetails: ${log.details || "No additional payload"}`,
      [{ text: "Close" }],
    );
  };

  const renderItem = ({ item }: { item: AuditLogEntry }) => {
    const isCritical = item.severity === "critical";
    const isWarning = item.severity === "warning";

    return (
      <View style={styles.logCard}>
        <View style={styles.logInfo}>
          <View
            style={[
              styles.iconBox,
              isCritical
                ? styles.iconCritical
                : isWarning
                  ? styles.iconWarning
                  : styles.iconInfo,
            ]}
          >
            <Ionicons
              name={
                isCritical
                  ? "alert-circle"
                  : isWarning
                    ? "warning"
                    : "checkmark-circle"
              }
              size={20}
              color={
                isCritical
                  ? "#9B1C1C"
                  : isWarning
                    ? "#92400E"
                    : "#204D91"
              }
            />
          </View>

          <View style={styles.logDetails}>
            <View style={styles.actionRow}>
              <Text style={styles.actionTitle}>{item.action}</Text>

              <View
                style={[
                  styles.badge,
                  isCritical
                    ? styles.badgeCritical
                    : isWarning
                      ? styles.badgeWarning
                      : styles.badgeInfo,
                ]}
              >
                <Text
                  style={[
                    styles.badgeText,
                    isCritical
                      ? styles.badgeTextCritical
                      : isWarning
                        ? styles.badgeTextWarning
                        : styles.badgeTextInfo,
                  ]}
                >
                  {item.severity.toUpperCase()}
                </Text>
              </View>
            </View>

            <Text style={styles.logActor}>
              Actor: {item.actor}
            </Text>

            <Text style={styles.logTimestamp}>
              {new Date(item.timestamp).toLocaleString()}{" "}
              {item.ipAddress ? `· IP: ${item.ipAddress}` : ""}
            </Text>
          </View>
        </View>

        <Pressable
          style={styles.inspectButton}
          onPress={() => handleInspectLog(item)}
        >
          <Ionicons
            name="chevron-forward"
            size={18}
            color="#68778D"
          />
        </Pressable>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header & Search */}
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.title}>Security & Audit Logs</Text>
          <Text style={styles.subtitle}>
            Track admin device challenges, sign-ins, and security events
          </Text>
        </View>

        <Pressable
          style={styles.refreshButton}
          onPress={() => void fetchLogs()}
        >
          <Ionicons
            name="refresh-outline"
            size={18}
            color="#204D91"
          />
          <Text style={styles.refreshText}>Refresh</Text>
        </Pressable>
      </View>

      <View style={styles.searchContainer}>
        <Ionicons
          name="search-outline"
          size={20}
          color="#8A96A8"
          style={styles.searchIcon}
        />

        <TextInput
          style={styles.searchInput}
          placeholder="Search by action, actor, or details..."
          placeholderTextColor="#8A96A8"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />

        {searchQuery.length > 0 && (
          <Pressable onPress={() => setSearchQuery("")}>
            <Ionicons
              name="close-circle"
              size={18}
              color="#8A96A8"
            />
          </Pressable>
        )}
      </View>

      {/* Content Body */}
      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#204D91" />
          <Text style={styles.centerText}>
            Loading audit logs...
          </Text>
        </View>
      ) : errorMessage ? (
        <View style={styles.errorContainer}>
          <Ionicons
            name="alert-circle-outline"
            size={32}
            color="#9B2C2C"
          />

          <Text style={styles.errorTitle}>
            Could not load audit logs
          </Text>

          <Text style={styles.errorText}>
            {errorMessage}
          </Text>

          <Pressable
            style={styles.retryButton}
            onPress={() => void fetchLogs()}
          >
            <Text style={styles.retryButtonText}>
              Try again
            </Text>
          </Pressable>
        </View>
      ) : filteredLogs.length === 0 ? (
        <View style={styles.centerContainer}>
          <Ionicons
            name="shield-checkmark-outline"
            size={48}
            color="#A0AEC0"
          />

          <Text style={styles.centerText}>
            No security logs found.
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredLogs}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          contentContainerStyle={styles.listContainer}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    backgroundColor: "#F3F6FB",
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
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
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#DCE4EF",
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 48,
    marginBottom: 20,
  },
  searchIcon: {
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: "#172B4D",
  },
  listContainer: {
    gap: 12,
  },
  logCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: "#E4EAF3",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  logInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    flex: 1,
  },
  iconBox: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  iconInfo: {
    backgroundColor: "#EAF1FF",
  },
  iconWarning: {
    backgroundColor: "#FEF3C7",
  },
  iconCritical: {
    backgroundColor: "#FDE8E8",
  },
  logDetails: {
    flex: 1,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  actionTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#172B4D",
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeInfo: {
    backgroundColor: "#EAF1FF",
  },
  badgeWarning: {
    backgroundColor: "#FEF3C7",
  },
  badgeCritical: {
    backgroundColor: "#FDE8E8",
  },
  badgeText: {
    fontSize: 9,
    fontWeight: "700",
  },
  badgeTextInfo: {
    color: "#204D91",
  },
  badgeTextWarning: {
    color: "#92400E",
  },
  badgeTextCritical: {
    color: "#9B1C1C",
  },
  logActor: {
    fontSize: 13,
    color: "#68778D",
    marginTop: 3,
  },
  logTimestamp: {
    fontSize: 11,
    color: "#8A96A8",
    marginTop: 2,
  },
  inspectButton: {
    padding: 8,
  },
  centerContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 50,
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
