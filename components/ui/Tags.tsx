import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Modal,
  FlatList,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Spacing as SPACING } from "@/constants";
import { TAG_SUGGESTIONS } from "@/constants/tagSuggestions";
import { useColors } from "@/context/ThemeContext";
import {
  getAllTags,
  addDocumentTags,
  removeDocumentTag,
  getDocumentTags,
} from "@/services/localDatabase";
import { useFeedback } from "@/hooks/useFeedback";

export interface TagsInputProps {
  documentId?: number;
  initialTags?: string[];
  onTagsChange?: (tags: string[]) => void;
  placeholder?: string;
  maxTags?: number;
  disabled?: boolean;
}

export function TagsInput({
  documentId,
  initialTags = [],
  onTagsChange,
  placeholder = "Search or add custom tag",
  maxTags = 10,
  disabled = false,
}: TagsInputProps) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [tags, setTags] = useState<string[]>(initialTags);
  const [inputValue, setInputValue] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const { trigger } = useFeedback();

  useEffect(() => {
    setTags((prev) => {
      const same =
        prev.length === initialTags.length &&
        prev.every((t, i) => t === initialTags[i]);
      return same ? prev : initialTags;
    });
  }, [initialTags]);

  useEffect(() => {
    if (documentId && initialTags.length === 0) {
      loadDocumentTags();
    }
    loadAllTags();
  }, [documentId]);

  const loadDocumentTags = async () => {
    if (!documentId) return;
    const docTags = await getDocumentTags(documentId);
    setTags(docTags);
    onTagsChange?.(docTags);
  };

  const loadAllTags = async () => {
    try {
      const allTags = await getAllTags();
      setSuggestions(Array.from(new Set([...TAG_SUGGESTIONS, ...allTags])));
    } catch (_err) {
      setSuggestions([...TAG_SUGGESTIONS]);
    }
  };

  const addTag = useCallback(
    (tag: string) => {
      const trimmed = tag.trim().toLowerCase();
      if (!trimmed || tags.includes(trimmed)) return false;
      if (tags.length >= maxTags) return false;
      const newTags = [...tags, trimmed];
      setTags(newTags);
      setInputValue("");
      onTagsChange?.(newTags);
      trigger("selection", { sound: false, haptic: true });
      if (documentId) {
        addDocumentTags(documentId, [trimmed]).catch(console.error);
      }
      // include custom tag in suggestions for this session
      setSuggestions((prev) => (prev.includes(trimmed) ? prev : [trimmed, ...prev]));
      return true;
    },
    [tags, documentId, onTagsChange, trigger, maxTags],
  );

  const removeTag = useCallback(
    (tagToRemove: string) => {
      const newTags = tags.filter((t) => t !== tagToRemove);
      setTags(newTags);
      onTagsChange?.(newTags);
      trigger("light", { sound: false, haptic: true });
      if (documentId) {
        removeDocumentTag(documentId, tagToRemove).catch(console.error);
      }
    },
    [tags, documentId, onTagsChange, trigger],
  );

  const handleInputChange = (text: string) => {
    setInputValue(text);
    if (text.includes(",")) {
      const parts = text.split(",").map((p) => p.trim()).filter(Boolean);
      parts.forEach((part) => addTag(part));
    }
  };

  const handleAddCustom = () => {
    if (inputValue.trim()) addTag(inputValue);
  };

  const handleKeyPress = ({ nativeEvent }: any) => {
    if (nativeEvent.key === "Enter" && inputValue.trim()) {
      addTag(inputValue);
    }
  };

  const filteredSuggestions = useMemo(() => {
    const q = inputValue.trim().toLowerCase();
    return suggestions
      .filter((s) => !tags.includes(s))
      .filter((s) => {
        if (!q) return true;
        const tag = s.toLowerCase();
        return tag.startsWith(q) || tag.includes(q);
      })
      .sort((a, b) => {
        if (!q) return a.localeCompare(b);
        const aTag = a.toLowerCase();
        const bTag = b.toLowerCase();
        const aStarts = aTag.startsWith(q) ? 0 : 1;
        const bStarts = bTag.startsWith(q) ? 0 : 1;
        if (aStarts !== bStarts) return aStarts - bStarts;
        return aTag.localeCompare(bTag);
      });
  }, [suggestions, tags, inputValue]);

  const openModal = () => {
    if (disabled) return;
    setInputValue("");
    loadAllTags();
    setModalVisible(true);
  };

  return (
    <View style={styles.container}>
      <View style={styles.tagsRow}>
        {tags.map((tag) => (
          <View key={tag} style={styles.tag}>
            <Text style={styles.tagText}>{tag}</Text>
            <TouchableOpacity
              style={styles.tagRemove}
              onPress={() => removeTag(tag)}
              disabled={disabled}
              activeOpacity={0.6}
              accessibilityRole="button"
              accessibilityLabel={`Remove tag ${tag}`}
            >
              <Ionicons name="close" size={12} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
        ))}

        {tags.length < maxTags && (
          <TouchableOpacity
            style={styles.addButton}
            onPress={openModal}
            disabled={disabled}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Add tags"
          >
            <Ionicons name="add" size={16} color={colors.primary} />
            <Text style={styles.addButtonText}>Add Tags</Text>
          </TouchableOpacity>
        )}
      </View>

      {tags.length === 0 && (
        <Text style={styles.hintText}>No tags added yet.</Text>
      )}
      {tags.length >= maxTags && (
        <Text style={styles.maxTagsText}>Maximum {maxTags} tags reached</Text>
      )}

      <Modal
        visible={modalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Tags</Text>
              <TouchableOpacity
                onPress={() => setModalVisible(false)}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.searchRow}>
              <Ionicons
                name="search"
                size={18}
                color={colors.textSecondary}
                style={{ marginRight: 8 }}
              />
              <TextInput
                style={styles.searchInput}
                value={inputValue}
                onChangeText={handleInputChange}
                onKeyPress={handleKeyPress}
                placeholder={placeholder}
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={30}
                returnKeyType="done"
                onSubmitEditing={handleAddCustom}
              />
              {!!inputValue.trim() && (
                <TouchableOpacity
                  style={styles.addCustomButton}
                  onPress={handleAddCustom}
                  accessibilityRole="button"
                  accessibilityLabel="Add custom tag"
                >
                  <Text style={styles.addCustomButtonText}>Add</Text>
                </TouchableOpacity>
              )}
            </View>

            {tags.length > 0 && (
              <View style={styles.selectedSection}>
                <Text style={styles.sectionLabel}>Selected</Text>
                <View style={styles.selectedTagsWrap}>
                  {tags.map((tag) => (
                    <TouchableOpacity
                      key={tag}
                      style={styles.selectedChip}
                      onPress={() => removeTag(tag)}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove tag ${tag}`}
                    >
                      <Text style={styles.selectedChipText}>{tag}</Text>
                      <Ionicons name="close" size={12} color={colors.primary} />
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

            <Text style={styles.sectionLabel}>Suggestions</Text>
            <FlatList
              data={filteredSuggestions}
              keyExtractor={(item) => item}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.listContent}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.suggestionItem}
                  onPress={() => addTag(item)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                >
                  <Ionicons
                    name="pricetag-outline"
                    size={16}
                    color={colors.primary}
                    style={{ marginRight: 10 }}
                  />
                  <Text style={styles.suggestionText}>{item}</Text>
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <Text style={styles.emptyText}>
                  {inputValue.trim()
                    ? "No matching tags. Tap Add to create a custom tag."
                    : "No more tag suggestions available."}
                </Text>
              }
            />

            <TouchableOpacity
              style={styles.doneButton}
              onPress={() => setModalVisible(false)}
              accessibilityRole="button"
            >
              <Text style={styles.doneButtonText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

export interface TagFilterProps {
  selectedTags: string[];
  onTagToggle: (tag: string) => void;
  allTags?: string[];
}

export function TagFilter({ selectedTags, onTagToggle, allTags = [] }: TagFilterProps) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { trigger } = useFeedback();

  return (
    <View style={styles.filterContainer}>
      <Text style={styles.filterLabel}>Filter by tags</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
        {allTags.map((tag) => {
          const isSelected = selectedTags.includes(tag);
          return (
            <TouchableOpacity
              key={tag}
              style={[styles.filterChip, isSelected && styles.filterChipActive]}
              onPress={() => {
                trigger("selection", { sound: false, haptic: true });
                onTagToggle(tag);
              }}
              activeOpacity={0.7}
            >
              <Text style={[styles.filterChipText, isSelected && styles.filterChipTextActive]}>
                {tag}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const createStyles = (colors: any) =>
  StyleSheet.create({
    container: { marginVertical: SPACING.sm },
    tagsRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
    tag: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.primaryLight,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 16,
      gap: 4,
    },
    tagText: { fontSize: 13, color: colors.primary, fontWeight: "500" },
    tagRemove: { padding: 2 },
    addButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      borderWidth: 1,
      borderColor: colors.primary,
      borderStyle: "dashed",
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 16,
      backgroundColor: colors.surface,
    },
    addButtonText: { fontSize: 13, color: colors.primary, fontWeight: "600" },
    hintText: { fontSize: 12, color: colors.textSecondary, marginTop: 6 },
    maxTagsText: { fontSize: 12, color: colors.textSecondary, marginTop: 4 },
    modalOverlay: {
      flex: 1,
      backgroundColor: colors.modalOverlay ?? "rgba(0,0,0,0.5)",
      justifyContent: "flex-end",
    },
    modalContainer: {
      maxHeight: "85%",
      backgroundColor: colors.surface,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.border,
    },
    modalHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 12,
    },
    modalTitle: { fontSize: 18, fontWeight: "700", color: colors.text },
    searchRow: {
      flexDirection: "row",
      alignItems: "center",
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      paddingHorizontal: 12,
      backgroundColor: colors.inputBackground ?? colors.background,
      marginBottom: 12,
      minHeight: 44,
    },
    searchInput: { flex: 1, color: colors.text, paddingVertical: 10, fontSize: 14 },
    addCustomButton: {
      backgroundColor: colors.primary,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 8,
      marginLeft: 8,
    },
    addCustomButtonText: { color: colors.buttonPrimaryText ?? "#fff", fontWeight: "600", fontSize: 13 },
    selectedSection: { marginBottom: 8 },
    sectionLabel: {
      fontSize: 13,
      fontWeight: "600",
      color: colors.textSecondary,
      marginBottom: 8,
      marginTop: 4,
    },
    selectedTagsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    selectedChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      backgroundColor: colors.primaryLight,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 16,
    },
    selectedChipText: { fontSize: 13, color: colors.primary, fontWeight: "500" },
    listContent: { paddingBottom: 12 },
    suggestionItem: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 12,
      paddingHorizontal: 8,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    suggestionText: { fontSize: 14, color: colors.text, flex: 1 },
    emptyText: {
      fontSize: 13,
      color: colors.textSecondary,
      textAlign: "center",
      paddingVertical: 20,
    },
    doneButton: {
      marginTop: 8,
      backgroundColor: colors.primary,
      borderRadius: 10,
      paddingVertical: 12,
      alignItems: "center",
    },
    doneButtonText: { color: colors.buttonPrimaryText ?? "#fff", fontWeight: "600", fontSize: 15 },
    filterContainer: { marginVertical: SPACING.md },
    filterLabel: { fontSize: 14, fontWeight: "600", color: colors.text, marginBottom: 8 },
    filterScroll: { gap: 8 },
    filterChip: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 20,
      backgroundColor: colors.surfaceSecondary,
      borderWidth: 1,
      borderColor: colors.border,
    },
    filterChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    filterChipText: { fontSize: 13, color: colors.textSecondary },
    filterChipTextActive: { color: colors.buttonPrimaryText, fontWeight: "600" },
  });

export function DocumentTags({ tags = [] }: { tags?: string[] }) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  if (!tags.length) return null;
  return (
    <View style={styles.tagsRow}>
      {tags.map((tag) => (
        <View key={tag} style={styles.tag}>
          <Text style={styles.tagText}>{tag}</Text>
        </View>
      ))}
    </View>
  );
}

