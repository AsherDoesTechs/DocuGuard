import { useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Animated,
  PanResponder,
  useWindowDimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";

export const ONBOARDING_STORAGE_KEY = "docuguard_onboarding_completed_v1";

type OnboardingScreenProps = {
  onComplete: () => void;
};

const COLORS = {
  background: "#F8FAFD",
  white: "#FFFFFF",
  navy: "#17365D",
  blue: "#3478F6",
  lightBlue: "#EAF2FF",
  muted: "#7B8BA1",
  successGreen: "#16A34A",
};

const slides = [
  {
    icon: "shield-checkmark-outline" as const,
    eyebrow: "WELCOME TO DOCUGUARD",
    title: "Your documents,\nprotected.",
    description:
      "Keep your important documents organized in one convenient place, with privacy and security in mind.",
  },
  {
    icon: "calendar-clear-outline" as const,
    eyebrow: "STAY ORGANIZED",
    title: "Never miss an\nimportant date.",
    description:
      "Track document expiration dates, review what needs attention, and use reminders to stay prepared.",
  },
  {
    icon: "lock-closed-outline" as const,
    eyebrow: "PRIVACY FIRST",
    title: "Your documents.\nYour control.",
    description:
      "Use available privacy and app-lock features to help protect access to your documents. Let's get you started.",
  },
];

export default function OnboardingScreen({
  onComplete,
}: OnboardingScreenProps) {
  const { width } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFinishing, setIsFinishing] = useState(false);

  const isLastSlide = currentIndex === slides.length - 1;

  // Slider animation setup for the "Slide to Get Started" interaction
  const sliderWidth = width - 48; // Account for container padding (24 * 2)
  const thumbSize = 52;
  const maxTranslateX = sliderWidth - thumbSize - 8; // 4px padding on each side
  const panX = useRef(new Animated.Value(0)).current;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !isFinishing,
      onPanResponderMove: (_, gestureState) => {
        if (isFinishing) return;
        if (gestureState.dx >= 0 && gestureState.dx <= maxTranslateX) {
          panX.setValue(gestureState.dx);
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (isFinishing) return;
        if (gestureState.dx >= maxTranslateX * 0.75) {
          // Trigger completion if dragged 75% or more
          Animated.timing(panX, {
            toValue: maxTranslateX,
            duration: 150,
            useNativeDriver: false,
          }).start(() => {
            void finishOnboarding();
          });
        } else {
          // Snap back if released too early
          Animated.spring(panX, {
            toValue: 0,
            bounciness: 4,
            useNativeDriver: false,
          }).start();
        }
      },
    }),
  ).current;

  const handleScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.round(event.nativeEvent.contentOffset.x / width);
    setCurrentIndex(Math.max(0, Math.min(index, slides.length - 1)));
  };

  const finishOnboarding = async () => {
    if (isFinishing) return;

    setIsFinishing(true);

    try {
      await AsyncStorage.setItem(ONBOARDING_STORAGE_KEY, "true");
    } catch (error) {
      console.warn("Could not save onboarding completion:", error);
    } finally {
      onComplete();
    }
  };

  const handleNext = () => {
    if (isFinishing || isLastSlide) return;

    const nextIndex = currentIndex + 1;

    scrollRef.current?.scrollTo({
      x: nextIndex * width,
      animated: true,
    });

    setCurrentIndex(nextIndex);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.brand}>
            <View style={styles.brandIcon}>
              <Ionicons name="shield-checkmark" size={19} color={COLORS.blue} />
            </View>
            <Text style={styles.brandName}>DocuGuard</Text>
          </View>
          {/* Skip button removed completely as requested */}
        </View>

        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={handleScrollEnd}
          scrollEventThrottle={16}
          style={styles.carousel}
          accessibilityLabel="Onboarding slides"
        >
          {slides.map((slide, index) => (
            <View
              key={slide.eyebrow}
              style={[styles.slide, { width }]}
              accessible
              accessibilityLabel={
                `Page ${index + 1} of ${slides.length}. ` +
                `${slide.title.replace("\n", " ")} ` +
                slide.description
              }
            >
              <View style={styles.illustrationArea}>
                <View style={styles.outerCircle}>
                  <View style={styles.innerCircle}>
                    <Ionicons name={slide.icon} size={76} color={COLORS.blue} />
                  </View>
                </View>

                <View style={styles.decorativeDotTop} />
                <View style={styles.decorativeDotBottom} />
              </View>

              <View style={styles.textArea}>
                <Text style={styles.eyebrow}>{slide.eyebrow}</Text>
                <Text style={styles.title}>{slide.title}</Text>
                <Text style={styles.description}>{slide.description}</Text>
              </View>
            </View>
          ))}
        </ScrollView>

        <View style={styles.footer}>
          <View
            style={styles.pagination}
            accessibilityLabel={`Page ${currentIndex + 1} of ${slides.length}`}
          >
            {slides.map((slide, index) => (
              <View
                key={slide.eyebrow}
                style={[
                  styles.paginationDot,
                  currentIndex === index && styles.paginationDotActive,
                ]}
              />
            ))}
          </View>

          {isLastSlide ? (
            /* Interactive Slide-to-Get-Started Track */
            <View style={[styles.sliderTrack, { width: sliderWidth }]}>
              <Text style={styles.sliderText}>
                {isFinishing ? "Loading..." : "Slide to Get Started"}
              </Text>
              <Animated.View
                style={[
                  styles.sliderThumb,
                  {
                    transform: [{ translateX: panX }],
                  },
                ]}
                {...panResponder.panHandlers}
              >
                <Ionicons name="arrow-forward" size={22} color={COLORS.white} />
              </Animated.View>
            </View>
          ) : (
            /* Standard Continue Button for earlier slides */
            <Pressable
              onPress={handleNext}
              disabled={isFinishing}
              accessibilityRole="button"
              accessibilityLabel="Continue"
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && styles.primaryButtonPressed,
              ]}
            >
              <Text style={styles.primaryButtonText}>Continue</Text>
              <Ionicons name="chevron-forward" size={20} color={COLORS.white} />
            </Pressable>
          )}

          <Text style={styles.footerNote}>PRIVATE. SECURE. ORGANIZED.</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  container: {
    flex: 1,
  },
  header: {
    minHeight: 60,
    paddingHorizontal: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  brandIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: COLORS.lightBlue,
    alignItems: "center",
    justifyContent: "center",
  },
  brandName: {
    color: COLORS.navy,
    fontSize: 17,
    fontWeight: "700",
    letterSpacing: -0.4,
  },
  carousel: {
    flex: 1,
  },
  slide: {
    flex: 1,
    paddingHorizontal: 32,
    justifyContent: "center",
    alignItems: "center",
  },
  illustrationArea: {
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 42,
    position: "relative",
  },
  outerCircle: {
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: "#EEF4FF",
    alignItems: "center",
    justifyContent: "center",
  },
  innerCircle: {
    width: 164,
    height: 164,
    borderRadius: 82,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: "#DFE9FF",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: COLORS.navy,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 18,
    elevation: 3,
  },
  decorativeDotTop: {
    position: "absolute",
    top: 18,
    right: "17%",
    width: 13,
    height: 13,
    borderRadius: 7,
    backgroundColor: "#A8C7FF",
  },
  decorativeDotBottom: {
    position: "absolute",
    bottom: 20,
    left: "16%",
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: "#C3D9FF",
  },
  textArea: {
    width: "100%",
    alignItems: "center",
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.7,
    color: COLORS.blue,
    textAlign: "center",
    marginBottom: 17,
  },
  title: {
    fontSize: 34,
    lineHeight: 41,
    fontWeight: "800",
    letterSpacing: -1.1,
    color: COLORS.navy,
    textAlign: "center",
    marginBottom: 16,
  },
  description: {
    maxWidth: 330,
    fontSize: 15,
    lineHeight: 24,
    fontWeight: "400",
    color: COLORS.muted,
    textAlign: "center",
  },
  footer: {
    paddingHorizontal: 24,
    paddingTop: 14,
    paddingBottom: 12,
  },
  pagination: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    marginBottom: 25,
  },
  paginationDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#D5DFED",
  },
  paginationDotActive: {
    width: 24,
    backgroundColor: COLORS.blue,
  },
  primaryButton: {
    minHeight: 56,
    borderRadius: 16,
    backgroundColor: COLORS.blue,
    paddingHorizontal: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  primaryButtonPressed: {
    opacity: 0.88,
  },
  primaryButtonText: {
    color: COLORS.white,
    fontSize: 16,
    fontWeight: "700",
  },
  sliderTrack: {
    height: 56,
    borderRadius: 16,
    backgroundColor: COLORS.lightBlue,
    justifyContent: "center",
    alignItems: "center",
    position: "relative",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#D3E3FD",
  },
  sliderText: {
    color: COLORS.blue,
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  sliderThumb: {
    position: "absolute",
    left: 4,
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: COLORS.blue,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: COLORS.navy,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 2,
  },
  footerNote: {
    marginTop: 19,
    textAlign: "center",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 2,
    color: "#9AA8BA",
  },
});
