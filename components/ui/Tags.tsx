import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, SPACING } from "@/constants";
import { 
  getAllTags, 
  addDocumentTags, 
  removeDocumentTag, 
  replaceDocumentTags,
  getDocumentTags,
} from "@/services/localDatabase";
import { useFeedback } from "@/hooks/useFeedback";

interface TagsInputProps {
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
    const allTags = await getAllTags();
    setSuggestions(allTags);
  };

  const addTag = useCallback((tag: string) => {
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
    return true;
  }, [tags, documentId, onTagsChange, trigger]);

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
    
    // Auto-add tags on comma
    if (text.includes(",")) {
      const parts = text.split(",").filter((p) => p.trim());
      parts.forEach((part) => addTag(part));
    }
  };

  const handleBlur = () => {
    setTimeout(() => setShowSuggestions(false), 200);
    if (inputValue.trim()) {
      addTag(inputValue);
    }
  };

  const handleKeyPress = ({ nativeEvent }: any) => {
    if (nativeEvent.key === "Enter" && inputValue.trim()) {
      addTag(inputValue);
    }
  };

  const filteredSuggestions = suggestions
    .filter((s) => !tags.includes(s) && s.toLowerCase().includes(inputValue.toLowerCase()))
    .slice(0, 5);

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
              <Ionicons name="close" size={12} color={COLORS.textSecondary} />
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
            placeholderTextColor={COLORS.textSecondary}
            disabled={disabled}
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
              <Ionicons name="label-outline" size={16} color={COLORS.primary} style={{ marginRight: 8 }} />
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

interface TagFilterProps {
  selectedTags: string[];
  onTagToggle: (tag: string) => void;
  allTags?: string[];
}

export function TagFilter({
  selectedTags,
  onTagToggle,
  allTags = [],
}: TagFilterProps) {
  const { trigger } = useFeedback();

  return (
    <View style={styles.filterContainer}>
      <Text style={styles.filterLabel}>Filter by tags</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterScroll}
      >
        {allTags.map((tag) => {
          const isSelected = selectedTags.includes(tag);
          return (
            <TouchableOpacity
              key={tag}
              style={[
                styles.filterChip,
                isSelected && styles.filterChipActive,
              ]}
              onPress={() => {
                trigger("selection", { sound: false, haptic: true });
                onTagToggle(tag);
              }}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.filterChipText,
                  isSelected && styles.filterChipTextActive,
                ]}
              >
                {tag}
              </Text>
              {isSelected && (
                <Ionicons name="checkmark" size={12} color="#fff" style={{ marginLeft: 4 }} />
              )}
            </TouchableOpacity>
          );
        })}
        {selectedTags.length > 0 && (
          <TouchableOpacity
            style={[styles.filterChip, styles.clearChip]}
            onPress={() => {
              trigger("light", { sound: false, haptic: true });
              selectedTags.forEach((tag) => onTagToggle(tag));
            }}
            activeOpacity={0.7}
          >
            <Ionicons name="close-circle" size={14} color={COLORS.danger} style={{ marginRight: 4 }} />
            <Text style={styles.filterChipText}>Clear all</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
}

interface DocumentTagsProps {
  tags: string[];
  onTagPress?: (tag: string) => void;
  removable?: boolean;
  onRemoveTag?: (tag: string) => void;
  maxVisible?: number;
}

export function DocumentTags({
  tags,
  onTagPress,
  removable = false,
  onRemoveTag,
  maxVisible = 3,
}: DocumentTagsProps) {
  const { trigger } = useFeedback();
  const visibleTags = tags.slice(0, maxVisible);
  const remaining = tags.length - maxVisible;

  return (
    <View style={styles.documentTags}>
      {visibleTags.map((tag) => (
        <TouchableOpacity
          key={tag}
          style={styles.documentTag}
          onPress={() => {
            trigger("selection", { sound: false, haptic: true });
            onTagPress?.(tag);
          }}
          activeOpacity={0.7}
        >
          <Ionicons name="label-outline" size={12} color={COLORS.primary} style={{ marginRight: 2 }} />
          <Text style={styles.documentTagText}>{tag}</Text>
          {removable && onRemoveTag && (
            <TouchableOpacity
              style={styles.documentTagRemove}
              onPress={(e) => {
                e.stopPropagation();
                trigger("light", { sound: false, haptic: true });
                onRemoveTag(tag);
              }}
              activeOpacity={0.6}
            >
              <Ionicons name="close" size={10} color={COLORS.textSecondary} />
            </TouchableOpacity>
          )}
        </TouchableOpacity>
      ))}
      {remaining > 0 && (
        <View style={styles.documentTagMore}>
          <Text style={styles.documentTagMoreText}>+{remaining}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: SPACING.md,
  },
  tagsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: SPACING.xs,
    marginBottom: SPACING.xs,
    minHeight: 40,
    alignItems: "center",
  },
  tag: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.primary + "15",
    borderRadius: 16,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    gap: 4,
  },
  tagText: {
    fontSize: 12,
    fontWeight: "500",
    color: COLORS.primary,
  },
  tagRemove: {
    padding: 2,
  },
  input: {
    fontSize: 13,
    color: COLORS.text,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  suggestions: {
    marginTop: SPACING.xs,
    borderRadius: 8,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: "hidden",
  },
  suggestionItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  suggestionItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  suggestionText: {
    fontSize: 13,
    color: COLORS.text,
  },
  maxTagsText: {
    fontSize: 11,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  filterContainer: {
    marginBottom: SPACING.md,
  },
  filterLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: COLORS.textSecondary,
    marginBottom: SPACING.xs,
  },
  filterScroll: {
    gap: SPACING.xs,
    paddingBottom: SPACING.xs,
  },
  filterChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 20,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
  },
  filterChipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: "500",
    color: COLORS.text,
  },
  filterChipTextActive: {
    color: "#fff",
  },
  clearChip: {
    borderColor: COLORS.danger,
  },
  documentTags: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: SPACING.xs,
  },
  documentTag: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    gap: 2,
  },
  documentTagText: {
    fontSize: 11,
    fontWeight: "500",
    color: COLORS.text,
  },
  documentTagRemove: {
    padding: 1,
  },
  documentTagMore: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
  },
  documentTagMoreText: {
    fontSize: 11,
    fontWeight: "600",
    color: COLORS.textSecondary,
  },
});