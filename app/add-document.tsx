import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Platform,
  TextInput,
  KeyboardAvoidingView,
} from "react-native";
import DateTimePicker, {
  DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as SecureStore from "expo-secure-store";
import * as DocumentPicker from "expo-document-picker";
import { API_BASE_URL } from "../services/api";
import { Button, Card } from "@/components/ui";
import { useForm } from "@/hooks/useForm";
import { DOCUMENT_CATEGORIES, COLORS } from "@/constants";
import { createDocument, updateDocument, logDocumentAction } from "../services/localDatabase";

type DocumentFormValues = {
  title: string;
  category: string;
  issuer: string;
  documentNumber: string;
  issueDate: string;
  expiryDate: string;
  notes: string;
};

type DateField = "issueDate" | "expiryDate";
type FormErrors = Partial<Record<keyof DocumentFormValues, string>>;

const MAX_TITLE_LENGTH = 100;
const MAX_ISSUER_LENGTH = 150;
const MAX_DOCUMENT_NUMBER_LENGTH = 50;
const MAX_NOTES_LENGTH = 1000;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

async function getStoredToken(): Promise<string | null> {
  return await SecureStore.getItemAsync("userToken");
}

function getToday(): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function getTomorrow(): Date {
  const date = getToday();
  date.setDate(date.getDate() + 1);
  return date;
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDate(value: string): Date | null {
  if (!DATE_REGEX.test(value)) return null;

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);

  if (Number.isNaN(date.getTime())) return null;

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  date.setHours(0, 0, 0, 0);
  return date;
}

function isValidDate(value: string): boolean {
  return parseDate(value) !== null;
}

/* -------------------------------------------------------------------------- */
/* Sanitizers                                                                 */
/* -------------------------------------------------------------------------- */

function sanitizeText(value: string, maxLength: number): string {
  return value.replace(/\s+/g, " ").slice(0, maxLength);
}

function sanitizeDocumentNumber(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9/-]/g, "")
    .slice(0, MAX_DOCUMENT_NUMBER_LENGTH);
}

function sanitizeNotes(value: string): string {
  return value.slice(0, MAX_NOTES_LENGTH);
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

function validate(values: DocumentFormValues): FormErrors {
  const errors: FormErrors = {};

  const title = values.title.trim();
  const issuer = values.issuer.trim();
  const documentNumber = values.documentNumber.trim();
  const notes = values.notes.trim();

  if (!title) {
    errors.title = "Document title is required.";
  } else if (title.length > MAX_TITLE_LENGTH) {
    errors.title = `Maximum ${MAX_TITLE_LENGTH} characters.`;
  }

  if (!values.category) {
    errors.category = "Please select a category.";
  }

  if (!issuer) {
    errors.issuer = "Issuer / organization is required.";
  } else if (issuer.length > MAX_ISSUER_LENGTH) {
    errors.issuer = `Maximum ${MAX_ISSUER_LENGTH} characters.`;
  }

  if (!documentNumber) {
    errors.documentNumber = "Document number is required.";
  } else if (documentNumber.length > MAX_DOCUMENT_NUMBER_LENGTH) {
    errors.documentNumber = `Maximum ${MAX_DOCUMENT_NUMBER_LENGTH} characters.`;
  } else if (!/^[A-Z0-9/-]+$/.test(documentNumber)) {
    errors.documentNumber = "Use only letters, numbers, - or /.";
  }

  if (!values.issueDate) {
    errors.issueDate = "Issue date is required.";
  } else if (!isValidDate(values.issueDate)) {
    errors.issueDate = "Please select a valid date.";
  } else {
    const issueDate = parseDate(values.issueDate);
    if (issueDate && issueDate > getToday()) {
      errors.issueDate = "Issue date cannot be in the future.";
    }
  }

  if (!values.expiryDate) {
    errors.expiryDate = "Expiry date is required.";
  } else if (!isValidDate(values.expiryDate)) {
    errors.expiryDate = "Please select a valid date.";
  }

  if (isValidDate(values.issueDate) && isValidDate(values.expiryDate)) {
    const issueDate = parseDate(values.issueDate);
    const expiryDate = parseDate(values.expiryDate);

    if (issueDate && expiryDate && expiryDate <= issueDate) {
      errors.expiryDate = "Expiry date must be after issue date.";
    }
  }

  if (notes.length > MAX_NOTES_LENGTH) {
    errors.notes = `Maximum ${MAX_NOTES_LENGTH} characters.`;
  }

  return errors;
}

/* -------------------------------------------------------------------------- */
/* API                                                                        */
/* -------------------------------------------------------------------------- */

async function saveDocument(
  values: DocumentFormValues,
  file: { name: string; uri: string; size: number; mimeType?: string } | null,
) {
  const token = await getStoredToken();

   const payload: Record<string, any> = {
    title: values.title.trim(),
    category: values.category,
    issuer: values.issuer.trim(),
    documentNumber: values.documentNumber.trim().toUpperCase(),
    issueDate: values.issueDate,
    expiryDate: values.expiryDate,
    notes: values.notes.trim(),
    status: "active",
    enableAlerts: true,
    processingStatus: "pending",
    needsSync: !!token,
  };

  let localId: number | null = null;

  if (file) {
    payload.processingStatus = "uploading";
    localId = await createDocument(payload);

    try {
      const uploadUrlRes = await fetch(
        `${API_BASE_URL}/documents/upload-url?fileName=${encodeURIComponent(file.name)}&fileType=${encodeURIComponent(file.mimeType || "application/octet-stream")}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      if (!uploadUrlRes.ok) {
        const errData = await uploadUrlRes.json().catch(() => ({}));
        throw new Error(errData?.error || "Failed to get upload URL.");
      }

      const uploadUrlData = await uploadUrlRes.json();

      const uploadRes = await fetch(uploadUrlData.uploadUrl, {
        method: "PUT",
        body: await (await fetch(file.uri)).blob(),
        headers: {
          "Content-Type": file.mimeType || "application/octet-stream",
        },
      });

      if (!uploadRes.ok) {
        throw new Error("Failed to upload file to S3.");
      }

      payload.fileUrl = uploadUrlData.fileUrl;
      payload.fileType = file.mimeType || "application/octet-stream";
      payload.s3Key = uploadUrlData.s3Key;
      payload.processingStatus = "processing";

      await updateDocument(localId, payload);
      return { id: localId, ...payload };
    } catch (uploadErr: any) {
      if (localId) {
        await updateDocument(localId, {
          processingStatus: "failed",
          notes: `${values.notes}\n\nUpload error: ${uploadErr.message}`,
        });
      }
      throw uploadErr;
    }
  }

  localId = await createDocument(payload);
  await logDocumentAction(localId, "created", payload);
  return { id: localId, ...payload };
}

/* -------------------------------------------------------------------------- */
/* Error Summary Banner Component                                             */
/* -------------------------------------------------------------------------- */

type ErrorBannerProps = {
  errors: Record<string, string>;
  serverError?: string | null;
};

function ErrorBanner({ errors, serverError }: ErrorBannerProps) {
  const errorCount = Object.keys(errors).length;

  if (errorCount === 0 && !serverError) return null;

  return (
    <View style={bannerStyles.container}>
      <Ionicons
        name="alert-circle"
        size={20}
        color={COLORS.danger}
        style={bannerStyles.icon}
      />
      <View style={bannerStyles.content}>
        <Text style={bannerStyles.title}>
          {serverError
            ? "Submission Error"
            : `Please fix ${errorCount} error${errorCount > 1 ? "s" : ""} below:`}
        </Text>
        <Text style={bannerStyles.message}>
          {serverError ||
            "Some required fields are missing or contain invalid formats."}
        </Text>
      </View>
    </View>
  );
}

const bannerStyles = StyleSheet.create({
  container: {
    flexDirection: "row",
    backgroundColor: "#FEE2E2",
    borderWidth: 1,
    borderColor: "#EF4444",
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
    alignItems: "center",
  },
  icon: { marginRight: 10 },
  content: { flex: 1 },
  title: { fontSize: 14, fontWeight: "700", color: "#991B1B", marginBottom: 2 },
  message: { fontSize: 12, color: "#B91C1C" },
});

/* -------------------------------------------------------------------------- */
/* Reusable local field                                                       */
/* -------------------------------------------------------------------------- */

type FieldProps = {
  label: string;
  value: string;
  placeholder?: string;
  error?: string;
  required?: boolean;
  maxLength?: number;
  multiline?: boolean;
  keyboardType?: "default" | "number-pad";
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  autoCorrect?: boolean;
  onChangeText: (value: string) => void;
  onBlur?: () => void;
};

function Field({
  label,
  value,
  placeholder,
  error,
  required = false,
  maxLength,
  multiline = false,
  keyboardType = "default",
  autoCapitalize = "sentences",
  autoCorrect = true,
  onChangeText,
  onBlur,
}: FieldProps) {
  return (
    <View style={styles.fieldContainer}>
      <Text style={styles.fieldLabel}>
        {label}
        {required && <Text style={styles.required}> *</Text>}
      </Text>

      <TextInput
        value={value}
        placeholder={placeholder}
        placeholderTextColor="#999"
        onChangeText={onChangeText}
        onBlur={onBlur}
        maxLength={maxLength}
        multiline={multiline}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCorrect}
        textAlignVertical={multiline ? "top" : "center"}
        style={[
          styles.input,
          multiline && styles.multilineInput,
          error && styles.inputError,
        ]}
      />

      <View style={styles.fieldFooter}>
        {error ? <Text style={styles.errorText}>{error}</Text> : <View />}
        {maxLength ? (
          <Text style={styles.counterText}>
            {value.length}/{maxLength}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

export default function AddDocumentScreen() {
  const router = useRouter();
  const [checkingAuthentication, setCheckingAuthentication] = useState(true);
  const [datePicker, setDatePicker] = useState<DateField | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<{
    name: string;
    uri: string;
    size: number;
    mimeType?: string;
  } | null>(null);
  const [uploading, setUploading] = useState(false);

  const pickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf", "image/*"],
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets?.[0]) {
        const asset = result.assets[0];
        setSelectedFile({
          name: asset.name,
          uri: asset.uri,
          size: asset.size || 0,
          mimeType: asset.mimeType,
        });
      }
    } catch (err) {
      Alert.alert("Error", "Could not select file. Please try again.");
    }
  };

  const removeSelectedFile = () => {
    setSelectedFile(null);
  };

  const form = useForm<DocumentFormValues>({
    initialValues: {
      title: "",
      category: "other",
      issuer: "",
      documentNumber: "",
      issueDate: "",
      expiryDate: "",
      notes: "",
    },
    validate,
    onSubmit: async (values) => {
       setSubmitError(null);
       try {
         await saveDocument(values, selectedFile);

         Alert.alert("Success", "Document added to your vault.", [
           {
             text: "OK",
             onPress: () => router.replace("/(tabs)/documents" as any),
           },
         ]);
       } catch (error: unknown) {
         const message =
           error instanceof Error
             ? error.message
             : "Could not save document.";
         setSubmitError(message);
       }
     },
  });

  useEffect(() => {
    let mounted = true;

    async function checkAuthentication() {
      try {
        const token = await getStoredToken();
        if (!token && mounted) {
          Alert.alert(
            "Authentication Required",
            "Please sign in to add a document.",
            [
              {
                text: "Sign In",
                onPress: () => router.replace("/login" as any),
              },
            ],
          );
        }
      } catch (err) {
        // Handle read failure silently or with standard fallback
      } finally {
        if (mounted) {
          setCheckingAuthentication(false);
        }
      }
    }

    checkAuthentication();

    return () => {
      mounted = false;
    };
  }, [router]);

  function openDatePicker(field: DateField) {
    setDatePicker(field);
  }

  function handleDateChange(event: DateTimePickerEvent, selectedDate?: Date) {
    const currentTargetField = datePicker;

    if (event.type === "dismissed" || !selectedDate || !currentTargetField) {
      setDatePicker(null);
      return;
    }

    const dateString = formatDate(selectedDate);
    setSubmitError(null);
    form.handleChange(currentTargetField)(dateString);

    if (Platform.OS === "android") {
      form.handleBlur(currentTargetField);
      setDatePicker(null);
    }
  }

  function getPickerValue(): Date {
    if (datePicker === "issueDate") {
      return parseDate(form.values.issueDate) || getToday();
    }
    return parseDate(form.values.expiryDate) || getTomorrow();
  }

  if (checkingAuthentication) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Checking authentication...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <TouchableOpacity
              onPress={() => router.back()}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <Ionicons name="chevron-back" size={28} color={COLORS.primary} />
            </TouchableOpacity>

            <Text style={styles.headerTitle}>Add Document</Text>

            <View style={styles.headerSpacer} />
          </View>

          <Card>
            <ErrorBanner errors={form.errors} serverError={submitError} />

            <Field
              label="Document Title"
              required
              placeholder="e.g. US Passport"
              value={form.values.title}
              onChangeText={(value) => {
                setSubmitError(null);
                form.handleChange("title")(
                  sanitizeText(value, MAX_TITLE_LENGTH),
                );
              }}
              onBlur={form.handleBlur("title")}
              maxLength={MAX_TITLE_LENGTH}
              autoCapitalize="words"
              autoCorrect={false}
              error={form.touched.title ? form.errors.title : undefined}
            />

            <View style={styles.fieldContainer}>
              <Text style={styles.fieldLabel}>
                Category
                <Text style={styles.required}> *</Text>
              </Text>

              <View style={styles.categoryContainer}>
                {Object.entries(DOCUMENT_CATEGORIES).map(
                  ([key, categoryData]) => {
                    const selected = form.values.category === key;
                    const labelText =
                      typeof categoryData === "string"
                        ? categoryData
                        : (categoryData as any)?.label || key;

                    return (
                      <TouchableOpacity
                        key={key}
                        onPress={() => {
                          setSubmitError(null);
                          form.handleChange("category")(key);
                        }}
                        style={[
                          styles.categoryOption,
                          selected && styles.categoryOptionActive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.categoryText,
                            selected && styles.categoryTextActive,
                          ]}
                        >
                          {labelText}
                        </Text>
                      </TouchableOpacity>
                    );
                  },
                )}
              </View>
            </View>

            <Field
              label="Issuer / Organization"
              required
              placeholder="e.g. Department of Foreign Affairs"
              value={form.values.issuer}
              onChangeText={(value) => {
                setSubmitError(null);
                form.handleChange("issuer")(
                  sanitizeText(value, MAX_ISSUER_LENGTH),
                );
              }}
              onBlur={form.handleBlur("issuer")}
              maxLength={MAX_ISSUER_LENGTH}
              autoCapitalize="words"
              autoCorrect={false}
              error={form.touched.issuer ? form.errors.issuer : undefined}
            />

            <Field
              label="Document Number"
              required
              placeholder="e.g. N12345678"
              value={form.values.documentNumber}
              onChangeText={(value) => {
                setSubmitError(null);
                form.handleChange("documentNumber")(
                  sanitizeDocumentNumber(value),
                );
              }}
              onBlur={form.handleBlur("documentNumber")}
              maxLength={MAX_DOCUMENT_NUMBER_LENGTH}
              autoCapitalize="characters"
              autoCorrect={false}
              error={
                form.touched.documentNumber
                  ? form.errors.documentNumber
                  : undefined
              }
            />

            <View style={styles.fieldContainer}>
              <Text style={styles.fieldLabel}>
                Issue Date
                <Text style={styles.required}> *</Text>
              </Text>

              <TouchableOpacity
                style={[
                  styles.dateButton,
                  form.touched.issueDate &&
                    form.errors.issueDate &&
                    styles.dateButtonError,
                ]}
                onPress={() => openDatePicker("issueDate")}
              >
                <Ionicons
                  name="calendar-outline"
                  size={22}
                  color={COLORS.primary}
                />

                <View style={styles.dateInfo}>
                  <Text
                    style={
                      form.values.issueDate
                        ? styles.dateText
                        : styles.datePlaceholder
                    }
                  >
                    {form.values.issueDate || "Select issue date"}
                  </Text>
                  <Text style={styles.dateHint}>Tap to choose</Text>
                </View>

                <Ionicons name="chevron-forward" size={18} color="#999" />
              </TouchableOpacity>

              {form.touched.issueDate && form.errors.issueDate && (
                <Text style={styles.errorText}>{form.errors.issueDate}</Text>
              )}
            </View>

            <View style={styles.fieldContainer}>
              <Text style={styles.fieldLabel}>
                Expiry Date
                <Text style={styles.required}> *</Text>
              </Text>

              <TouchableOpacity
                style={[
                  styles.dateButton,
                  form.touched.expiryDate &&
                    form.errors.expiryDate &&
                    styles.dateButtonError,
                ]}
                onPress={() => openDatePicker("expiryDate")}
              >
                <Ionicons
                  name="calendar-outline"
                  size={22}
                  color={COLORS.primary}
                />

                <View style={styles.dateInfo}>
                  <Text
                    style={
                      form.values.expiryDate
                        ? styles.dateText
                        : styles.datePlaceholder
                    }
                  >
                    {form.values.expiryDate || "Select expiry date"}
                  </Text>
                  <Text style={styles.dateHint}>Tap to choose</Text>
                </View>

                <Ionicons name="chevron-forward" size={18} color="#999" />
              </TouchableOpacity>

              {form.touched.expiryDate && form.errors.expiryDate && (
                <Text style={styles.errorText}>{form.errors.expiryDate}</Text>
              )}
            </View>

            <Field
              label="Notes"
              placeholder="Add any additional notes..."
              value={form.values.notes}
              onChangeText={(value) => {
                setSubmitError(null);
                form.handleChange("notes")(sanitizeNotes(value));
              }}
              onBlur={form.handleBlur("notes")}
              maxLength={MAX_NOTES_LENGTH}
              multiline
              error={form.touched.notes ? form.errors.notes : undefined}
            />

            <View style={styles.fieldContainer}>
              <Text style={styles.fieldLabel}>Document File</Text>
              
              {!selectedFile ? (
                <TouchableOpacity
                  style={styles.filePickerButton}
                  onPress={pickDocument}
                >
                  <Ionicons
                    name="document-attach-outline"
                    size={24}
                    color={COLORS.primary}
                  />
                  <Text style={styles.filePickerText}>
                    Tap to attach a file (PDF or image)
                  </Text>
                </TouchableOpacity>
              ) : (
                <View style={styles.selectedFileContainer}>
                  <View style={styles.selectedFileInfo}>
                    <Ionicons
                      name="document"
                      size={24}
                      color={COLORS.primary}
                    />
                    <View style={styles.selectedFileDetails}>
                      <Text style={styles.selectedFileName} numberOfLines={1}>
                        {selectedFile.name}
                      </Text>
                      <Text style={styles.selectedFileSize}>
                        {(selectedFile.size / 1024).toFixed(1)} KB
                      </Text>
                    </View>
                  </View>
                  <TouchableOpacity
                    onPress={removeSelectedFile}
                    style={styles.removeFileButton}
                  >
                    <Ionicons
                      name="close-circle"
                      size={24}
                      color={COLORS.danger}
                    />
                  </TouchableOpacity>
                </View>
              )}
            </View>

            <Button
              title={uploading ? "Uploading..." : "Add Document"}
              onPress={form.handleSubmit}
              loading={form.isSubmitting || uploading}
            />
          </Card>
        </ScrollView>
      </KeyboardAvoidingView>

      {datePicker && (
        <DateTimePicker
          value={getPickerValue()}
          mode="date"
          display={Platform.OS === "ios" ? "spinner" : "default"}
          maximumDate={datePicker === "issueDate" ? getToday() : undefined}
          minimumDate={
            datePicker === "expiryDate"
              ? parseDate(form.values.issueDate) || undefined
              : undefined
          }
          onChange={handleDateChange}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: 16, paddingBottom: 50 },
  loadingContainer: { flex: 1, justifyContent: "center", alignItems: "center" },
  loadingText: { fontSize: 15, color: COLORS.textSecondary || "#777" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  headerTitle: { fontSize: 18, fontWeight: "700", color: COLORS.text },
  headerSpacer: { width: 28 },
  fieldContainer: { marginBottom: 18 },
  fieldLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.text,
    marginBottom: 8,
  },
  required: { color: COLORS.danger },
  input: {
    minHeight: 50,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    backgroundColor: "#fff",
    color: COLORS.text,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  multilineInput: { minHeight: 120, paddingTop: 14 },
  inputError: { borderColor: COLORS.danger },
  fieldFooter: {
    minHeight: 18,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  errorText: { marginTop: 5, fontSize: 12, color: COLORS.danger, flex: 1 },
  counterText: {
    marginTop: 5,
    fontSize: 11,
    color: "#888",
    textAlign: "right",
  },
  categoryContainer: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  categoryOption: {
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 9,
    backgroundColor: "#fff",
  },
  categoryOptionActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  categoryText: { fontSize: 13, fontWeight: "600", color: COLORS.text },
  categoryTextActive: { color: "#fff" },
  dateButton: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    backgroundColor: "#fff",
    paddingHorizontal: 14,
  },
  dateButtonError: { borderColor: COLORS.danger },
  dateInfo: { flex: 1, marginLeft: 12 },
  dateText: { fontSize: 15, fontWeight: "600", color: COLORS.text },
  datePlaceholder: { fontSize: 15, color: "#999" },
  dateHint: { fontSize: 11, color: "#999", marginTop: 3 },
  filePickerButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    backgroundColor: "#fff",
    paddingVertical: 20,
    paddingHorizontal: 14,
  },
  filePickerText: {
    fontSize: 14,
    color: COLORS.primary,
    fontWeight: "600",
  },
  selectedFileContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    backgroundColor: "#fff",
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  selectedFileInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  selectedFileDetails: { flex: 1 },
  selectedFileName: {
    fontSize: 14,
    fontWeight: "600",
    color: COLORS.text,
  },
  selectedFileSize: {
    fontSize: 12,
    color: "#888",
    marginTop: 2,
  },
  removeFileButton: {
    padding: 4,
  },
});
