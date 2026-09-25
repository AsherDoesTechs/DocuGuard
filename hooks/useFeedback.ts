import * as Haptics from "expo-haptics";
import { Audio, InterruptionModeIOS, InterruptionModeAndroid } from "expo-av";
import { useEffect, useRef, useState } from "react";

export type FeedbackType =
  | "success"
  | "error"
  | "warning"
  | "info"
  | "light"
  | "medium"
  | "heavy"
  | "selection";

/**
 * Static sound imports.
 *
 * File:
 * DocuGuard/hooks/useFeedback.ts
 *
 * Sounds:
 * DocuGuard/assets/sounds/*.mp3
 *
 * Because this file is inside /hooks,
 * ../assets is required.
 */
const SOUND_FILES: Record<FeedbackType, any> = {
  success: require("../assets/sounds/success.mp3"),
  error: require("../assets/sounds/error.mp3"),
  warning: require("../assets/sounds/warning.mp3"),
  info: require("../assets/sounds/info.mp3"),
  light: require("../assets/sounds/light.mp3"),
  medium: require("../assets/sounds/medium.mp3"),
  heavy: require("../assets/sounds/heavy.mp3"),
  selection: require("../assets/sounds/selection.mp3"),
};

class FeedbackManager {
  private sounds: Map<FeedbackType, Audio.Sound> = new Map();

  private loaded = false;

  /**
   * Shared loading promise.
   *
   * Prevents multiple components from loading
   * the sounds simultaneously.
   */
  private loadPromise: Promise<void> | null = null;

  /**
   * Global feedback settings.
   */
  private soundEnabled = true;
  private hapticEnabled = true;

  /**
   * UI sound volume.
   *
   * 0.3 keeps sounds subtle and modern.
   */
  private readonly soundVolume = 0.4;

  /**
   * Load all feedback sounds.
   */
  async loadSounds(): Promise<void> {
    // Already loaded.
    if (this.loaded) {
      return;
    }

    // Already loading.
    // Wait for the existing operation.
    if (this.loadPromise) {
      return this.loadPromise;
    }

    this.loadPromise = this.initializeSounds();

    try {
      await this.loadPromise;
    } finally {
      this.loadPromise = null;
    }
  }

  /**
   * Initialize the audio system
   * and load all UI feedback sounds.
   *
   * IMPORTANT:
   *
   * playsInSilentModeIOS: false
   *
   * This allows iOS Silent Mode to suppress
   * normal UI sounds while haptics can still work.
   */
  private async initializeSounds(): Promise<void> {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        staysActiveInBackground: false,

        // Respect the iPhone silent switch.
        playsInSilentModeIOS: false,

        interruptionModeIOS: InterruptionModeIOS.DuckOthers,

        shouldDuckAndroid: true,

        interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
      });

      const soundTypes: FeedbackType[] = [
        "success",
        "error",
        "warning",
        "info",
        "light",
        "medium",
        "heavy",
        "selection",
      ];

      for (const type of soundTypes) {
        try {
          const { sound } = await Audio.Sound.createAsync(SOUND_FILES[type], {
            shouldPlay: false,
            volume: this.soundVolume,
          });

          this.sounds.set(type, sound);
        } catch (error) {
          // If one sound fails, continue loading the others.
          console.warn(`[Feedback] Failed to load ${type} sound:`, error);
        }
      }

      this.loaded = true;
    } catch (error) {
      console.warn("[Feedback] Failed to initialize audio:", error);

      /**
       * Haptics can still work even if audio
       * initialization fails.
       */
      this.loaded = true;
    }
  }

  /**
   * Play a feedback sound.
   */
  async playSound(type: FeedbackType): Promise<void> {
    if (!this.soundEnabled) {
      return;
    }

    try {
      if (!this.loaded) {
        await this.loadSounds();
      }

      const sound = this.sounds.get(type);

      if (!sound) {
        console.warn(`[Feedback] No sound available for "${type}".`);
        return;
      }

      await sound.replayAsync();
    } catch (error) {
      console.warn(`[Feedback] Failed to play ${type} sound:`, error);
    }
  }

  /**
   * Trigger haptic feedback.
   */
  async playHaptic(type: FeedbackType): Promise<void> {
    if (!this.hapticEnabled) {
      return;
    }

    try {
      switch (type) {
        case "success":
          await Haptics.notificationAsync(
            Haptics.NotificationFeedbackType.Success,
          );
          break;

        case "error":
          await Haptics.notificationAsync(
            Haptics.NotificationFeedbackType.Error,
          );
          break;

        case "warning":
          await Haptics.notificationAsync(
            Haptics.NotificationFeedbackType.Warning,
          );
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
          break;
      }
    } catch (error) {
      // Haptic feedback should never crash the app.
      console.warn(`[Feedback] Haptic feedback failed for ${type}:`, error);
    }
  }

  /**
   * Trigger sound and/or haptic feedback.
   */
  async trigger(
    type: FeedbackType,
    options?: {
      sound?: boolean;
      haptic?: boolean;
    },
  ): Promise<void> {
    const { sound = true, haptic = true } = options ?? {};

    const tasks: Promise<void>[] = [];

    if (sound) {
      tasks.push(this.playSound(type));
    }

    if (haptic) {
      tasks.push(this.playHaptic(type));
    }

    await Promise.all(tasks);
  }

  /**
   * Enable or disable sounds.
   */
  setSoundEnabled(enabled: boolean): void {
    this.soundEnabled = enabled;
  }

  /**
   * Enable or disable haptics.
   */
  setHapticEnabled(enabled: boolean): void {
    this.hapticEnabled = enabled;
  }

  /**
   * Check whether sounds are enabled.
   */
  isSoundEnabled(): boolean {
    return this.soundEnabled;
  }

  /**
   * Check whether haptics are enabled.
   */
  isHapticEnabled(): boolean {
    return this.hapticEnabled;
  }

  /**
   * Unload all sounds.
   */
  async unload(): Promise<void> {
    for (const sound of this.sounds.values()) {
      try {
        await sound.unloadAsync();
      } catch {
        // Ignore unload errors.
      }
    }

    this.sounds.clear();

    this.loaded = false;
    this.loadPromise = null;
  }
}

/**
 * Global FeedbackManager instance.
 */
export const feedbackManager = new FeedbackManager();

/**
 * React hook for feedback.
 */
export function useFeedback() {
  const [ready, setReady] = useState(false);

  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) {
      return;
    }

    initialized.current = true;

    let mounted = true;

    feedbackManager
      .loadSounds()
      .then(() => {
        if (mounted) {
          setReady(true);
        }
      })
      .catch((error) => {
        console.warn("[Feedback] Failed to initialize:", error);

        if (mounted) {
          setReady(true);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  const trigger = async (
    type: FeedbackType,
    options?: {
      sound?: boolean;
      haptic?: boolean;
    },
  ): Promise<void> => {
    await feedbackManager.trigger(type, options);
  };

  return {
    trigger,
    ready,
  };
}

/**
 * Wrap a function with feedback.
 *
 * Feedback is triggered after the function
 * successfully completes.
 */
export function withFeedback<T extends (...args: any[]) => any>(
  fn: T,
  type: FeedbackType = "light",
  options?: {
    sound?: boolean;
    haptic?: boolean;
  },
): T {
  return (async (...args: Parameters<T>) => {
    const result = await fn(...args);

    await feedbackManager.trigger(type, options);

    return result;
  }) as T;
}

/**
 * Button wrapper with haptic-only feedback.
 *
 * Sound is disabled for normal button presses.
 */
export function createFeedbackButton(
  onPress: () => void,
  type: FeedbackType = "selection",
) {
  return () => {
    void feedbackManager.trigger(type, {
      sound: false,
      haptic: true,
    });

    onPress();
  };
}
