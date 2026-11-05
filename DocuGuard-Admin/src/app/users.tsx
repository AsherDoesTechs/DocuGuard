import React, { useCallback, useEffect, useState } from "react";
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

// Define User type based on DocuGuard user schema
type UserAccount = {
  id: string | number;
  email: string;
  name?: string;
  role: "admin" | "user" | "moderator";
  status: "active" | "suspended" | "pending";
  createdAt: string;
};

export default function AdminUsersScreen() {
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [filteredUsers, setFilteredUsers] = useState<UserAccount[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setErrorMessage("");

    try {
      const token = await getAdminToken();
      if (!token) {
        router.replace("/");
        return;
      }

      // TODO: Replace with your actual backend endpoint e.g., authedRequest('/admin/users')
      const API_BASE_URL =
        process.env.EXPO_PUBLIC_API_BASE_URL ??
        "https://docuguard-api-onoj.onrender.com";
      const response = await fetch(`${API_BASE_URL}/admin/users`, {
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
        throw new Error("Failed to load user accounts from the server.");
      }

      const data = await response.json();
      // Expecting data.users or data directly as array
      const userList = data.users || data || [];
      setUsers(userList);
      setFilteredUsers(userList);
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
    void fetchUsers();
  }, [fetchUsers]);

  // Handle live searching
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredUsers(users);
    } else {
      const query = searchQuery.toLowerCase();
      setFilteredUsers(
        users.filter(
          (u) =>
            u.email.toLowerCase().includes(query) ||
            (u.name && u.name.toLowerCase().includes(query)),
        ),
      );
    }
  }, [searchQuery, users]);

  const handleToggleStatus = (
    userId: string | number,
    currentStatus: string,
  ) => {
    const action = currentStatus === "active" ? "suspend" : "activate";
    Alert.alert(
      `Confirm ${action}`,
      `Are you sure you want to ${action} this user account?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Confirm",
          style: currentStatus === "active" ? "destructive" : "default",
          onPress: async () => {
            // Implement your backend toggle call here
            Alert.alert("Success", `User has been ${action}d successfully.`);
            // Refresh list or update local state
          },
        },
      ],
    );
  };

  const renderItem = ({ item }: { item: UserAccount }) => {
    const isActive = item.status === "active";
    return (
      <View style={styles.userCard}>
        <View style={styles.userInfo}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {(item.name || item.email).charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={styles.userDetails}>
            <Text style={styles.userName}>{item.name || "Unnamed User"}</Text>
            <Text style={styles.userEmail}>{item.email}</Text>
            <View style={styles.badgeRow}>
              <View
                style={[
                  styles.badge,
                  isActive ? styles.badgeActive : styles.badgeSuspended,
                ]}
              >
                <Text
                  style={[
                    styles.badgeText,
                    isActive
                      ? styles.badgeTextActive
                      : styles.badgeTextSuspended,
                  ]}
                >
                  {item.status.toUpperCase()}
                </Text>
              </View>
              <Text style={styles.roleText}>Role: {item.role}</Text>
            </View>
          </View>
        </View>

        <Pressable
          style={[
            styles.actionButton,
            isActive ? styles.suspendButton : styles.activateButton,
          ]}
          onPress={() => handleToggleStatus(item.id, item.status)}
        >
          <Text
            style={[
              styles.actionButtonText,
              isActive ? styles.suspendText : styles.activateText,
            ]}
          >
            {isActive ? "Suspend" : "Activate"}
          </Text>
        </Pressable>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header & Search Bar */}
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.title}>User Management</Text>
          <Text style={styles.subtitle}>
            View and manage registered DocuGuard accounts
          </Text>
        </View>
        <Pressable
          style={styles.refreshButton}
          onPress={() => void fetchUsers()}
        >
          <Ionicons name="refresh-outline" size={18} color="#204D91" />
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
          placeholder="Search by name or email..."
          placeholderTextColor="#8A96A8"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        {searchQuery.length > 0 && (
          <Pressable onPress={() => setSearchQuery("")}>
            <Ionicons name="close-circle" size={18} color="#8A96A8" />
          </Pressable>
        )}
      </View>

      {/* Content Body */}
      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#204D91" />
          <Text style={styles.centerText}>Loading users...</Text>
        </View>
      ) : errorMessage ? (
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle-outline" size={32} color="#9B2C2C" />
          <Text style={styles.errorTitle}>Could not load users</Text>
          <Text style={styles.errorText}>{errorMessage}</Text>
          <Pressable
            style={styles.retryButton}
            onPress={() => void fetchUsers()}
          >
            <Text style={styles.retryButtonText}>Try again</Text>
          </Pressable>
        </View>
      ) : filteredUsers.length === 0 ? (
        <View style={styles.centerContainer}>
          <Ionicons name="people-outline" size={48} color="#A0AEC0" />
          <Text style={styles.centerText}>No users found.</Text>
        </View>
      ) : (
        <FlatList
          data={filteredUsers}
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
  userCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: "#E4EAF3",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  userInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    flex: 1,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#EAF1FF",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#204D91",
  },
  userDetails: {
    flex: 1,
  },
  userName: {
    fontSize: 15,
    fontWeight: "700",
    color: "#172B4D",
  },
  userEmail: {
    fontSize: 13,
    color: "#68778D",
    marginTop: 2,
  },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 6,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  badgeActive: {
    backgroundColor: "#DEF7EC",
  },
  badgeSuspended: {
    backgroundColor: "#FDE8E8",
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "700",
  },
  badgeTextActive: {
    color: "#03543F",
  },
  badgeTextSuspended: {
    color: "#9B1C1C",
  },
  roleText: {
    fontSize: 12,
    color: "#68778D",
    textTransform: "capitalize",
  },
  actionButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  suspendButton: {
    borderColor: "#FBD5D5",
    backgroundColor: "#FDF2F2",
  },
  activateButton: {
    borderColor: "#C6F6D5",
    backgroundColor: "#F0FFF4",
  },
  actionButtonText: {
    fontSize: 12,
    fontWeight: "700",
  },
  suspendText: {
    color: "#9B1C1C",
  },
  activateText: {
    color: "#22543D",
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
