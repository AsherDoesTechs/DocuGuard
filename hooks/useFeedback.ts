import * as Haptics from "expo-haptics";
import { Audio } from "expo-av";
import { useEffect, useRef, useState } from "react";

export type FeedbackType = "success" | "error" | "warning" | "info" | "light" | "medium" | "heavy" | "selection";

class FeedbackManager {
  private sounds: Map<FeedbackType, Audio.Sound> = new Map();
  private loaded = false;
  private loading = false;
  private soundEnabled = true;
  private hapticEnabled = true;

  async loadSounds() {
    if (this.loaded || this.loading) return;
    this.loading = true;

    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        staysActiveInBackground: false,
        interruptionModeIOS: Audio.INTERRUPTION_MODE_IOS_DUCK_OTHERS,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        interruptionModeAndroid: Audio.INTERRUPTION_MODE_ANDROID_DUCK_OTHERS,
      });

      const soundTypes: FeedbackType[] = ["success", "error", "warning", "info", "light", "medium", "heavy", "selection"];
      
      for (const type of soundTypes) {
        try {
          const { sound } = await Audio.Sound.createAsync(require(`./assets/sounds/${type}.mp3`), {
            shouldPlay: false,
            volume: 0.5,
          });
          this.sounds.set(type, sound);
        } catch {
          // Sound file not found, will use system fallback
        }
      }
      this.loaded = true;
    } catch (error) {
      console.warn("Failed to load feedback sounds:", error);
    } finally {
      this.loading = false;
    }
  }

  async playSound(type: FeedbackType) {
    if (!this.loaded) await this.loadSounds();
    if (!this.soundEnabled) return;
    
    const sound = this.sounds.get(type);
    if (sound) {
      try {
        await sound.replayAsync();
        return;
      } catch (error) {
        console.warn(`Failed to play ${type} sound:`, error);
      }
    }
    // Fallback: Use system sounds via AudioServicesPlaySystemSound (iOS) or ToneGenerator (Android)
    // This is a no-op in JS but we log for debugging
    console.log(`[Sound] ${type} (fallback)`);
  }

  async playHaptic(type: FeedbackType) {
    if (!this.hapticEnabled) return;
    
    try {
      switch (type) {
        case "success":
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          break;
        case "error":
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          break;
        case "warning":
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          break;
        case "light":
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          break;
        case "medium":
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          break;
        case "heavy":
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
          break;
        case "selection":
          await Haptics.selectionAsync();
          break;
        case "info":
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          break;
        default:
          await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    } catch (error) {
      console.warn("Haptic feedback failed:", error);
    }
  }

  async trigger(type: FeedbackType, options?: { sound?: boolean; haptic?: boolean }) {
    const { sound = true, haptic = true } = options || {};
    await Promise.all([
      sound ? this.playSound(type) : Promise.resolve(),
      haptic ? this.playHaptic(type) : Promise.resolve(),
    ]);
  }

  setSoundEnabled(enabled: boolean) {
    this.soundEnabled = enabled;
  }

  setHapticEnabled(enabled: boolean) {
    this.hapticEnabled = enabled;
  }

  async unload() {
    for (const sound of this.sounds.values()) {
      try {
        await sound.unloadAsync();
      } catch {}
    }
    this.sounds.clear();
    this.loaded = false;
  }
}

export const feedbackManager = new FeedbackManager();

export function useFeedback() {
  const [ready, setReady] = useState(false);
  const initialized = useRef(false);

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      feedbackManager.loadSounds().then(() => setReady(true));
    }
  }, []);

  const trigger = async (type: FeedbackType, options?: { sound?: boolean; haptic?: boolean }) => {
    await feedbackManager.trigger(type, options);
  };

  return { trigger, ready };
}

export function withFeedback<T extends (...args: any[]) => any>(
  fn: T,
  type: FeedbackType = "light",
  options?: { sound?: boolean; haptic?: boolean }
): T {
  return (async (...args: Parameters<T>) => {
    const result = await fn(...args);
    await feedbackManager.trigger(type, options);
    return result;
  }) as T;
}

// Button wrapper with built-in feedback
export function createFeedbackButton(
  onPress: () => void,
  type: FeedbackType = "selection"
) {
  return () => {
    feedbackManager.trigger(type, { sound: false, haptic: true });
    onPress();
  };
}