import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
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
  placeholder = "Add tags (comma separated)",
  maxTags = 10,
  disabled = false,
}: TagsInputProps) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [tags, setTags] = useState<string[]>(initialTags);
  const [inputValue, setInputValue] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const { trigger } = useFeedback();

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

  const addTag = useCallback((tag: string) => {
    const trimmed = tag.trim().toLowerCase();
    if (!trimmed || tags.includes(trimmed)) return false;
    if (tags.length >= maxTags) return false;
    const newTags = [...tags, trimmed];
    setTags(newTags);
    setInputValue("");
    setShowSuggestions(false);
    onTagsChange?.(newTags);
    trigger("selection", { sound: false, haptic: true });
    if (documentId) {
      addDocumentTags(documentId, [trimmed]).catch(console.error);
    }
    return true;
  }, [tags, documentId, onTagsChange, trigger, maxTags]);

  const removeTag = useCallback((tagToRemove: string) => {
    const newTags = tags.filter((t) => t !== tagToRemove);
    setTags(newTags);
    onTagsChange?.(newTags);
    trigger("light", { sound: false, haptic: true });
    if (documentId) {
      removeDocumentTag(documentId, tagToRemove).catch(console.error);
    }
  }, [tags, documentId, onTagsChange, trigger]);

  const handleInputChange = (text: string) => {
    setInputValue(text);
    setShowSuggestions(true);
    if (text.includes(",")) {
      const parts = text.split(",").filter((p) => p.trim());
      parts.forEach((part) => addTag(part));
      setShowSuggestions(true);
    }
  };

  const handleBlur = () => {
    setTimeout(() => setShowSuggestions(false), 200);
  };

  const handleKeyPress = ({ nativeEvent }: any) => {
    if (nativeEvent.key === "Enter" && inputValue.trim()) addTag(inputValue);
  };

  const filteredSuggestions = suggestions
    .filter((s) => {
      if (tags.includes(s)) return false;
      const q = inputValue.trim().toLowerCase();
      if (!q) return false;
      const tag = s.toLowerCase();
      return tag.startsWith(q) || tag.includes(q);
    })
    .sort((a, b) => {
      const q = inputValue.trim().toLowerCase();
      const aTag = a.toLowerCase();
      const bTag = b.toLowerCase();
      const aStarts = aTag.startsWith(q) ? 0 : 1;
      const bStarts = bTag.startsWith(q) ? 0 : 1;
      if (aStarts !== bStarts) return aStarts - bStarts;
      return aTag.localeCompare(bTag);
    })
    .slice(0, 8);

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
            >
              <Ionicons name="close" size={12} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
        ))}
        {tags.length < maxTags && (
          <TextInput
            style={[styles.input, { flex: 1, minWidth: 80 }]}
            value={inputValue}
            onChangeText={handleInputChange}
            onBlur={handleBlur}
            onFocus={() => setShowSuggestions(true)}
            onKeyPress={handleKeyPress}
            placeholder={tags.length === 0 ? placeholder : ""}
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={30}
          />
        )}
      </View>

      {showSuggestions && filteredSuggestions.length > 0 && (
        <View style={styles.suggestions}>
          {filteredSuggestions.map((suggestion) => (
            <TouchableOpacity
              key={suggestion}
              style={styles.suggestionItem}
              onPress={() => addTag(suggestion)}
              activeOpacity={0.6}
            >
              <Ionicons name="pricetag-outline" size={16} color={colors.primary} style={{ marginRight: 8 }} />
              <Text style={styles.suggestionText}>{suggestion}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {tags.length >= maxTags && (
        <Text style={styles.maxTagsText}>Maximum {maxTags} tags reached</Text>
      )}
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
      flexDirection: "row", alignItems: "center", backgroundColor: colors.primaryLight,
      paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, gap: 4,
    },
    tagText: { fontSize: 13, color: colors.primary, fontWeight: "500" },
    tagRemove: { padding: 2 },
    input: {
      fontSize: 14, color: colors.text, paddingVertical: 8, paddingHorizontal: 4,
      minHeight: 36,
    },
    suggestions: {
      marginTop: 8, backgroundColor: colors.surface, borderRadius: 8,
      borderWidth: 1, borderColor: colors.border, overflow: "hidden",
    },
    suggestionItem: {
      flexDirection: "row", alignItems: "center", padding: 12,
      borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    suggestionText: { fontSize: 14, color: colors.text },
    maxTagsText: { fontSize: 12, color: colors.textSecondary, marginTop: 4 },
    filterContainer: { marginVertical: SPACING.md },
    filterLabel: { fontSize: 14, fontWeight: "600", color: colors.text, marginBottom: 8 },
    filterScroll: { gap: 8 },
    filterChip: {
      paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
      backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border,
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
