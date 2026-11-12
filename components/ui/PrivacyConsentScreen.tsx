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
export const PRIVACY_NOTICE_VERSION = "1.0.0";

type Props = {
  onComplete: () => void | Promise<void>;
};

export default function PrivacyConsentScreen({ onComplete }: Props) {
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [noticeAcknowledged, setNoticeAcknowledged] = useState(false);
  const [processingAgreed, setProcessingAgreed] = useState(false);
  const [showNotice, setShowNotice] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  const canContinue = noticeAcknowledged && processingAgreed;

  const handleContinue = async () => {
    if (!canContinue || isSaving) return;
    setIsSaving(true);
    setError("");
    try {
      const consentRecord = JSON.stringify({
        noticeVersion: PRIVACY_NOTICE_VERSION,
        noticeAcknowledged: true,
        processingAgreed: true,
        acceptedAt: new Date().toISOString(),
      });
      await AsyncStorage.setItem(PRIVACY_CONSENT_STORAGE_KEY, consentRecord);
      const saved = await AsyncStorage.getItem(PRIVACY_CONSENT_STORAGE_KEY);
      if (saved !== consentRecord) {
        throw new Error("Privacy consent could not be verified after saving.");
      }
      await onComplete();
    } catch (saveError) {
      console.error("Failed to save privacy acknowledgment:", saveError);
      setError("We couldn't save your privacy decision. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const openOfficialLaw = async () => {
    const url = "https://privacy.gov.ph/data-privacy-act/";
    try {
      await Linking.openURL(url);
    } catch {
      setError("Unable to open the official Data Privacy Act reference.");
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
            <Ionicons name="shield-checkmark" size={24} color={colors.primary} />
          </View>
          <Text style={styles.brandName}>DocuGuard</Text>
        </View>

        <View style={styles.heroIcon}>
          <Ionicons name="lock-closed" size={38} color={colors.primary} />
        </View>

        <Text style={styles.eyebrow}>YOUR PRIVACY MATTERS</Text>
        <Text style={styles.title}>Your data. Your rights.</Text>
        <Text style={styles.subtitle}>
          Before proceeding, please review how DocuGuard handles your personal
          information under the Philippine Data Privacy Act of 2012 (Republic
          Act No. 10173).
        </Text>

        <View style={styles.noticeCard}>
          <Text style={styles.sectionTitle}>How DocuGuard uses information</Text>

          <InfoRow
            icon="documents-outline"
            title="Documents and account details"
            description="Information you provide may be used to manage your account, organize documents, and track expiration dates."
            styles={styles}
            colors={colors}
          />
          <InfoRow
            icon="notifications-outline"
            title="Reminders and notifications"
            description="Relevant document dates and notification settings may be processed to provide reminders you enable."
            styles={styles}
            colors={colors}
          />
          <InfoRow
            icon="cloud-outline"
            title="Storage and service providers"
            description="Depending on the features you use, information may be stored locally and processed by cloud, email, or notification providers."
            styles={styles}
            colors={colors}
          />
          <InfoRow
            icon="shield-checkmark-outline"
            title="Security and retention"
            description="DocuGuard uses safeguards intended to protect information. Data should be retained only as long as justified by its stated purpose or applicable obligations."
            styles={styles}
            colors={colors}
          />

          <Pressable
            onPress={() => setShowNotice((value) => !value)}
            accessibilityRole="button"
            accessibilityState={{ expanded: showNotice }}
            style={styles.noticeLink}
          >
            <Text style={styles.linkText}>
              {showNotice ? "Hide privacy details" : "Read privacy details"}
            </Text>
            <Ionicons
              name={showNotice ? "chevron-up" : "chevron-down"}
              size={18}
              color={colors.primary}
            />
          </Pressable>

          {showNotice && (
            <View style={styles.expandedNotice}>
              <Text style={styles.expandedTitle}>Your privacy rights</Text>
              <Text style={styles.bodyText}>
                Subject to applicable law, you may have the right to be
                informed, access your personal data, request correction, object
                to or withdraw consent where applicable, and seek blocking,
                erasure, or other remedies when legally available.
              </Text>

              <Text style={styles.expandedTitle}>Who handles your data?</Text>
              <Text style={styles.bodyText}>
                Before release, DocuGuard's responsible personal information
                controller, privacy contact, actual recipients, processing
                purposes, lawful bases, and specific retention periods must be
                identified here. These details have not yet been verified in
                this draft.
              </Text>

              <Text style={styles.expandedTitle}>Questions or requests</Text>
              <Text style={styles.bodyText}>
                Contact details for privacy inquiries and requests must be
                published by the DocuGuard operator before this notice is used
                in production.
              </Text>

              <Pressable onPress={openOfficialLaw} style={styles.externalLink}>
                <Text style={styles.linkText}>
                  Read RA 10173 on the NPC website
                </Text>
                <Ionicons name="open-outline" size={16} color={colors.primary} />
              </Pressable>
            </View>
          )}
        </View>

        <Text style={styles.sectionHeading}>Before you continue</Text>

        <ConsentRow
          checked={noticeAcknowledged}
          onPress={() => setNoticeAcknowledged((value) => !value)}
          title="Privacy Notice acknowledgment"
          description="I have reviewed and understood the privacy information presented above."
          styles={styles}
          colors={colors}
        />

        <ConsentRow
          checked={processingAgreed}
          onPress={() => setProcessingAgreed((value) => !value)}
          title="Core-service processing consent"
          description="I consent to the personal-data processing described in the final Privacy Notice for the core DocuGuard features, where consent is the applicable lawful basis."
          styles={styles}
          colors={colors}
        />

        <Text style={styles.disclaimer}>
          Optional features and processing that require separate consent should
          be presented separately. You may decline to continue if you do not
          agree.
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
              <Ionicons name="arrow-forward" size={20} color={colors.buttonPrimaryText} />
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
          <Ionicons name="checkmark" size={17} color={colors.buttonPrimaryText} />
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
    brand: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 26 },
    brandIcon: {
      width: 42, height: 42, borderRadius: 13,
      backgroundColor: colors.primaryLight, alignItems: "center", justifyContent: "center",
    },
    brandName: { color: colors.text, fontSize: 18, fontWeight: "800" },
    heroIcon: {
      width: 76, height: 76, borderRadius: 24,
      backgroundColor: colors.primaryLight, alignItems: "center", justifyContent: "center",
      alignSelf: "center", marginBottom: 18,
    },
    eyebrow: {
      color: colors.primary, fontSize: 11, fontWeight: "800",
      letterSpacing: 1.8, textAlign: "center", marginBottom: 10,
    },
    title: {
      color: colors.text, fontSize: 30, fontWeight: "800",
      letterSpacing: -0.7, textAlign: "center", marginBottom: 12,
    },
    subtitle: {
      color: colors.textSecondary, fontSize: 14, lineHeight: 22,
      textAlign: "center", marginBottom: 24,
    },
    noticeCard: {
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
      borderRadius: 20, padding: 18, marginBottom: 24,
    },
    sectionTitle: { color: colors.text, fontSize: 17, fontWeight: "800", marginBottom: 18 },
    infoRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: 18 },
    infoIcon: {
      width: 38, height: 38, borderRadius: 12,
      backgroundColor: colors.primaryLight, alignItems: "center", justifyContent: "center",
    },
    infoContent: { flex: 1, paddingTop: 1 },
    infoTitle: { color: colors.text, fontSize: 14, fontWeight: "700", marginBottom: 5 },
    bodyText: { color: colors.textSecondary, fontSize: 13, lineHeight: 20 },
    noticeLink: {
      borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 15, marginTop: 1,
      flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    },
    linkText: { color: colors.primary, fontSize: 13, fontWeight: "700" },
    expandedNotice: { borderTopWidth: 1, borderTopColor: colors.border, marginTop: 14, paddingTop: 14, gap: 8 },
    expandedTitle: { color: colors.text, fontSize: 14, fontWeight: "800", marginTop: 7 },
    externalLink: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 7, alignSelf: "flex-start" },
    sectionHeading: { color: colors.text, fontSize: 17, fontWeight: "800", marginBottom: 13 },
    consentRow: {
      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
      borderRadius: 16, padding: 15, flexDirection: "row", alignItems: "flex-start",
      gap: 12, marginBottom: 12,
    },
    checkbox: {
      width: 24, height: 24, borderRadius: 7, borderWidth: 1.5,
      borderColor: colors.border, backgroundColor: colors.surface,
      alignItems: "center", justifyContent: "center", marginTop: 1,
    },
    checkboxChecked: { backgroundColor: colors.buttonPrimary, borderColor: colors.buttonPrimary },
    consentContent: { flex: 1, gap: 5 },
    consentTitle: { color: colors.text, fontSize: 14, fontWeight: "800" },
    disclaimer: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 3, marginBottom: 17 },
    errorText: { color: colors.error, fontSize: 13, marginBottom: 12 },
    primaryButton: {
      minHeight: 56, borderRadius: 16, backgroundColor: colors.buttonPrimary,
      paddingHorizontal: 20, flexDirection: "row", alignItems: "center",
      justifyContent: "center", gap: 10,
    },
    buttonDisabled: { opacity: 0.45 },
    buttonPressed: { opacity: 0.85 },
    primaryButtonText: { color: colors.buttonPrimaryText, fontSize: 15, fontWeight: "800" },
    footerNote: {
      textAlign: "center", marginTop: 20, color: colors.textMuted,
      fontSize: 10, fontWeight: "800", letterSpacing: 1.7,
    },
  });
