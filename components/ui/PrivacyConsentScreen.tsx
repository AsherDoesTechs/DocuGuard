import AsyncStorage from "@react-native-async-storage/async-storage";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/context/ThemeContext";

export const PRIVACY_CONSENT_STORAGE_KEY = "docuguard_privacy_consent_v1";
export const PRIVACY_NOTICE_VERSION = "1.2.0";

type Props = {
  onComplete: () => void | Promise<void>;
};

export default function PrivacyConsentScreen({ onComplete }: Props) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [noticeAcknowledged, setNoticeAcknowledged] = useState(false);
  const [processingAgreed, setProcessingAgreed] = useState(false);
  const [scopeAcknowledged, setScopeAcknowledged] = useState(false);

  const [showPrivacyDetails, setShowPrivacyDetails] = useState(false);
  const [showScopeDetails, setShowScopeDetails] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  const canContinue =
    noticeAcknowledged && processingAgreed && scopeAcknowledged;

  const handleContinue = async () => {
    if (!canContinue || isSaving) return;
    setIsSaving(true);
    setError("");
    try {
      const consentRecord = JSON.stringify({
        noticeVersion: PRIVACY_NOTICE_VERSION,
        noticeAcknowledged: true,
        processingAgreed: true,
        scopeAcknowledged: true,
        acceptedAt: new Date().toISOString(),
      });
      await AsyncStorage.setItem(PRIVACY_CONSENT_STORAGE_KEY, consentRecord);
      const saved = await AsyncStorage.getItem(PRIVACY_CONSENT_STORAGE_KEY);
      if (saved !== consentRecord) {
        throw new Error("Consent could not be verified after saving.");
      }
      await onComplete();
    } catch (saveError) {
      console.error("Failed to save privacy acknowledgment:", saveError);
      setError("Unable to save your consent decision. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const openOfficialLaw = async () => {
    const url = "https://privacy.gov.ph/data-privacy-act/";
    try {
      await Linking.openURL(url);
    } catch {
      setError("Unable to open the National Privacy Commission website.");
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.brand}>
          <View style={styles.brandIcon}>
            <Ionicons
              name="shield-checkmark"
              size={24}
              color={colors.primary}
            />
          </View>
          <Text style={styles.brandName}>DocuGuard</Text>
        </View>

        <View style={styles.heroIcon}>
          <Ionicons name="lock-closed" size={38} color={colors.primary} />
        </View>

        <Text style={styles.eyebrow}>PRIVACY & TERMS OF USE</Text>
        <Text style={styles.title}>Your data. Your rights.</Text>
        <Text style={styles.subtitle}>
          Review how DocuGuard processes your personal data under the Philippine
          Data Privacy Act of 2012 (Republic Act No. 10173) and the operational
          scope of our digital vault service.
        </Text>

        {/* CARD 1: DATA PRIVACY */}
        <View style={styles.noticeCard}>
          <Text style={styles.sectionTitle}>Data Privacy & Processing</Text>

          <InfoRow
            icon="documents-outline"
            title="What we collect"
            description="Account credentials, uploaded digital document copies (PDF, JPEG, PNG), document metadata (titles, numbers, issuers), and expiration dates."
            styles={styles}
            colors={colors}
          />
          <InfoRow
            icon="notifications-outline"
            title="Why we process it"
            description="To store and organize your digital records, track expiration schedules, send push and email renewal alerts, and log vault activity for security."
            styles={styles}
            colors={colors}
          />
          <InfoRow
            icon="cloud-outline"
            title="Storage & security"
            description="Records are stored locally on your device and synced to encrypted cloud storage. Data is protected via access controls and retained only while your account is active or until you delete the record."
            styles={styles}
            colors={colors}
          />

          <Pressable
            onPress={() => setShowPrivacyDetails((value) => !value)}
            accessibilityRole="button"
            accessibilityState={{ expanded: showPrivacyDetails }}
            style={styles.noticeLink}
          >
            <Text style={styles.linkText}>
              {showPrivacyDetails
                ? "Hide Data Privacy Act rights"
                : "Read your rights under RA 10173"}
            </Text>
            <Ionicons
              name={showPrivacyDetails ? "chevron-up" : "chevron-down"}
              size={18}
              color={colors.primary}
            />
          </Pressable>

          {showPrivacyDetails && (
            <View style={styles.expandedNotice}>
              <Text style={styles.expandedTitle}>Your Statutory Rights</Text>
              <Text style={styles.bodyText}>
                Under Republic Act No. 10173, you have the right to be informed
                of how your data is processed, access your stored records,
                rectify inaccurate metadata, object to or withdraw consent for
                processing, and request the erasure or blocking of your personal
                data from our servers.
              </Text>

              <Text style={styles.expandedTitle}>Data Control & Deletion</Text>
              <Text style={styles.bodyText}>
                You maintain full control over your uploaded files. Deleting a
                document or closing your account removes the record and its
                associated metadata from active storage, subject only to
                mandatory security audit logs.
              </Text>

              <Pressable onPress={openOfficialLaw} style={styles.externalLink}>
                <Text style={styles.linkText}>
                  Read RA 10173 on the NPC website
                </Text>
                <Ionicons
                  name="open-outline"
                  size={16}
                  color={colors.primary}
                />
              </Pressable>
            </View>
          )}
        </View>

        {/* CARD 2: SERVICE SCOPE & LIMITATIONS */}
        <View style={styles.noticeCard}>
          <Text style={styles.sectionTitle}>Service Scope & Limitations</Text>

          <InfoRow
            icon="copy-outline"
            title="Digital copies only"
            description="DocuGuard manages digital copies only. It does not store, handle, print, or replace physical IDs, licenses, certificates, or academic records."
            styles={styles}
            colors={colors}
          />
          <InfoRow
            icon="camera-outline"
            title="User digitization & physical safekeeping"
            description="You are responsible for scanning or uploading clear files (PDF, JPEG, PNG), safeguarding original documents, and completing official renewals."
            styles={styles}
            colors={colors}
          />
          <InfoRow
            icon="alert-circle-outline"
            title="No verification or legal substitution"
            description="DocuGuard does not verify document authenticity with issuing agencies. Digital copies stored here are not legal substitutes for original physical documents."
            styles={styles}
            colors={colors}
          />

          <Pressable
            onPress={() => setShowScopeDetails((value) => !value)}
            accessibilityRole="button"
            accessibilityState={{ expanded: showScopeDetails }}
            style={styles.noticeLink}
          >
            <Text style={styles.linkText}>
              {showScopeDetails
                ? "Hide full scope & limitations"
                : "Read full scope & limitations"}
            </Text>
            <Ionicons
              name={showScopeDetails ? "chevron-up" : "chevron-down"}
              size={18}
              color={colors.primary}
            />
          </Pressable>

          {showScopeDetails && (
            <View style={styles.expandedNotice}>
              <Text style={styles.expandedTitle}>
                1. Physical Safekeeping & Renewals
              </Text>
              <Text style={styles.bodyText}>
                DocuGuard does not prevent the loss, damage, expiration, or
                physical deterioration of original documents. The system
                provides digital document management and expiration monitoring
                only. While it sends push and email reminders for upcoming
                deadlines, the safekeeping of physical documents and completion
                of actual renewal processes remain strictly your responsibility.
              </Text>

              <Text style={styles.expandedTitle}>
                2. Digital Copy Management Only
              </Text>
              <Text style={styles.bodyText}>
                DocuGuard is designed solely to manage digital copies uploaded
                or captured through the app. The system does not physically
                store, handle, print, or replace original documents such as
                identification cards, licenses, certificates, or academic
                records. Its role is limited to organizing and monitoring
                digital representations alongside their metadata and expiration
                dates.
              </Text>

              <Text style={styles.expandedTitle}>
                3. Digitization & File Quality
              </Text>
              <Text style={styles.bodyText}>
                Digitizing physical documents is your responsibility. You must
                scan, photograph, or upload documents in supported formats (PDF,
                JPEG, and PNG) before the system can manage them. Record
                completeness and legibility depend entirely on the files you
                provide.
              </Text>

              <Text style={styles.expandedTitle}>
                4. No Verification or Legal Substitution
              </Text>
              <Text style={styles.bodyText}>
                DocuGuard does not verify or guarantee the authenticity,
                legality, or validity of uploaded documents, nor does it connect
                to issuing agencies or government databases to check if a file
                is genuine or unaltered. Digital copies stored in DocuGuard do
                not serve as legal substitutes for originals—you must still
                present original physical documents in government, academic,
                employment, or official transactions when required.
              </Text>
            </View>
          )}
        </View>

        <Text style={styles.sectionHeading}>Required Acknowledgments</Text>

        <ConsentRow
          checked={noticeAcknowledged}
          onPress={() => setNoticeAcknowledged((value) => !value)}
          title="Privacy Notice Acknowledgment"
          description="I have read and understood how DocuGuard collects, stores, and protects my personal information."
          styles={styles}
          colors={colors}
        />

        <ConsentRow
          checked={processingAgreed}
          onPress={() => setProcessingAgreed((value) => !value)}
          title="Personal Data Processing Consent"
          description="I consent to the processing of my account details, uploaded digital documents, and expiration dates to provide DocuGuard's vault and reminder services."
          styles={styles}
          colors={colors}
        />

        <ConsentRow
          checked={scopeAcknowledged}
          onPress={() => setScopeAcknowledged((value) => !value)}
          title="Service Scope & Limitations Acknowledgment"
          description="I understand that DocuGuard manages digital copies only, does not verify document authenticity, and does not replace original physical documents."
          styles={styles}
          colors={colors}
        />

        <Text style={styles.disclaimer}>
          You must accept all three terms above to use DocuGuard. You may
          withdraw consent at any time by deleting your account in Profile
          settings.
        </Text>

        {!!error && (
          <Text accessibilityRole="alert" style={styles.errorText}>
            {error}
          </Text>
        )}

        <Pressable
          onPress={() => void handleContinue()}
          disabled={!canContinue || isSaving}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canContinue || isSaving }}
          style={({ pressed }) => [
            styles.primaryButton,
            (!canContinue || isSaving) && styles.buttonDisabled,
            pressed && canContinue && styles.buttonPressed,
          ]}
        >
          {isSaving ? (
            <ActivityIndicator color={colors.buttonPrimaryText} />
          ) : (
            <>
              <Text style={styles.primaryButtonText}>Agree and Continue</Text>
              <Ionicons
                name="arrow-forward"
                size={20}
                color={colors.buttonPrimaryText}
              />
            </>
          )}
        </Pressable>

        <Text style={styles.footerNote}>DOCUGUARD · PRIVACY BY DESIGN</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function InfoRow({
  icon,
  title,
  description,
  styles,
  colors,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  title: string;
  description: string;
  styles: any;
  colors: any;
}) {
  return (
    <View style={styles.infoRow}>
      <View style={styles.infoIcon}>
        <Ionicons name={icon} size={20} color={colors.primary} />
      </View>
      <View style={styles.infoContent}>
        <Text style={styles.infoTitle}>{title}</Text>
        <Text style={styles.bodyText}>{description}</Text>
      </View>
    </View>
  );
}

function ConsentRow({
  checked,
  onPress,
  title,
  description,
  styles,
  colors,
}: {
  checked: boolean;
  onPress: () => void;
  title: string;
  description: string;
  styles: any;
  colors: any;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      style={styles.consentRow}
    >
      <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
        {checked && (
          <Ionicons
            name="checkmark"
            size={17}
            color={colors.buttonPrimaryText}
          />
        )}
      </View>
      <View style={styles.consentContent}>
        <Text style={styles.consentTitle}>{title}</Text>
        <Text style={styles.bodyText}>{description}</Text>
      </View>
    </Pressable>
  );
}

const createStyles = (colors: any) =>
  StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: colors.background },
    scrollContent: { paddingHorizontal: 24, paddingTop: 18, paddingBottom: 32 },
    brand: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginBottom: 26,
    },
    brandIcon: {
      width: 42,
      height: 42,
      borderRadius: 13,
      backgroundColor: colors.primaryLight,
      alignItems: "center",
      justifyContent: "center",
    },
    brandName: { color: colors.text, fontSize: 18, fontWeight: "800" },
    heroIcon: {
      width: 76,
      height: 76,
      borderRadius: 24,
      backgroundColor: colors.primaryLight,
      alignItems: "center",
      justifyContent: "center",
      alignSelf: "center",
      marginBottom: 18,
    },
    eyebrow: {
      color: colors.primary,
      fontSize: 11,
      fontWeight: "800",
      letterSpacing: 1.8,
      textAlign: "center",
      marginBottom: 10,
    },
    title: {
      color: colors.text,
      fontSize: 30,
      fontWeight: "800",
      letterSpacing: -0.7,
      textAlign: "center",
      marginBottom: 12,
    },
    subtitle: {
      color: colors.textSecondary,
      fontSize: 14,
      lineHeight: 22,
      textAlign: "center",
      marginBottom: 24,
    },
    noticeCard: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 20,
      padding: 18,
      marginBottom: 20,
    },
    sectionTitle: {
      color: colors.text,
      fontSize: 17,
      fontWeight: "800",
      marginBottom: 18,
    },
    infoRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 12,
      marginBottom: 18,
    },
    infoIcon: {
      width: 38,
      height: 38,
      borderRadius: 12,
      backgroundColor: colors.primaryLight,
      alignItems: "center",
      justifyContent: "center",
    },
    infoContent: { flex: 1, paddingTop: 1 },
    infoTitle: {
      color: colors.text,
      fontSize: 14,
      fontWeight: "700",
      marginBottom: 5,
    },
    bodyText: { color: colors.textSecondary, fontSize: 13, lineHeight: 20 },
    noticeLink: {
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingTop: 15,
      marginTop: 1,
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    linkText: { color: colors.primary, fontSize: 13, fontWeight: "700" },
    expandedNotice: {
      borderTopWidth: 1,
      borderTopColor: colors.border,
      marginTop: 14,
      paddingTop: 14,
      gap: 8,
    },
    expandedTitle: {
      color: colors.text,
      fontSize: 14,
      fontWeight: "800",
      marginTop: 7,
    },
    externalLink: {
      flexDirection: "row",
      alignItems: "center",
      gap: 7,
      marginTop: 7,
      alignSelf: "flex-start",
    },
    sectionHeading: {
      color: colors.text,
      fontSize: 17,
      fontWeight: "800",
      marginTop: 4,
      marginBottom: 13,
    },
    consentRow: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 16,
      padding: 15,
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 12,
      marginBottom: 12,
    },
    checkbox: {
      width: 24,
      height: 24,
      borderRadius: 7,
      borderWidth: 1.5,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 1,
    },
    checkboxChecked: {
      backgroundColor: colors.buttonPrimary,
      borderColor: colors.buttonPrimary,
    },
    consentContent: { flex: 1, gap: 5 },
    consentTitle: { color: colors.text, fontSize: 14, fontWeight: "800" },
    disclaimer: {
      color: colors.textSecondary,
      fontSize: 12,
      lineHeight: 18,
      marginTop: 3,
      marginBottom: 17,
    },
    errorText: { color: colors.error, fontSize: 13, marginBottom: 12 },
    primaryButton: {
      minHeight: 56,
      borderRadius: 16,
      backgroundColor: colors.buttonPrimary,
      paddingHorizontal: 20,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
    },
    buttonDisabled: { opacity: 0.45 },
    buttonPressed: { opacity: 0.85 },
    primaryButtonText: {
      color: colors.buttonPrimaryText,
      fontSize: 15,
      fontWeight: "800",
    },
    footerNote: {
      textAlign: "center",
      marginTop: 20,
      color: colors.textMuted,
      fontSize: 10,
      fontWeight: "800",
      letterSpacing: 1.7,
    },
  });
