import { createAudioPlayer, setAudioModeAsync } from "expo-audio";
import type { AudioPlayer, AudioStatus } from "expo-audio";
import type { EventSubscription } from "expo-modules-core";
import * as Haptics from "expo-haptics";
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

type FeedbackOptions = {
  sound?: boolean;
  haptic?: boolean;
};

const SOUND_SOURCES: Record<FeedbackType, number> = {
  success: require("../assets/sounds/success.mp3"),
  error: require("../assets/sounds/error.mp3"),
  warning: require("../assets/sounds/warning.mp3"),
  info: require("../assets/sounds/info.mp3"),
  light: require("../assets/sounds/light.mp3"),
  medium: require("../assets/sounds/medium.mp3"),
  heavy: require("../assets/sounds/heavy.mp3"),
  selection: require("../assets/sounds/selection.mp3"),
};

/**
 * expo-av was removed from the SDK and its native module no longer
 * exists, so importing it threw at module-evaluation time and took
 * down the entire route graph. expo-audio is the supported
 * replacement and ships the ExpoAudio native module in SDK 57.
 */
class FeedbackManager {
  private soundEnabled = true;
  private hapticEnabled = true;
  private initialized = false;
  private loadPromise: Promise<void> | null = null;

  /**
   * Initialize expo-audio.
   * Safe to call multiple times.
   */
  async loadSounds(): Promise<void> {
    if (this.initialized) {
      return;
    }
    if (this.loadPromise) {
      return this.loadPromise;
    }

    this.loadPromise = setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      interruptionMode: "duckOthers",
    })
      .then(() => {
        this.initialized = true;
      })
      .finally(() => {
        this.loadPromise = null;
      });

    return this.loadPromise;
  }

  /**
   * Play a feedback sound.
   */
  async playSound(type: FeedbackType): Promise<void> {
    if (!this.soundEnabled) {
      return;
    }

    let player: AudioPlayer | null = null;
    let subscription: EventSubscription | null = null;

    try {
      // Make sure the audio system is initialized.
      await this.loadSounds();
      const source = SOUND_SOURCES[type];

      player = createAudioPlayer(source, { updateInterval: 100 });
      player.volume = 1.0;

      // Clean up when playback finishes so short feedback clips
      // do not accumulate players in memory.
      subscription = player.addListener(
        "playbackStatusUpdate",
        (status: AudioStatus) => {
          if (status.didJustFinish) {
            subscription?.remove();
            subscription = null;
            player?.remove();
            player = null;
          }
        },
      );

      player.play();
    } catch (error) {
      console.warn(`[Feedback] Sound playback failed for ${type}:`, error);

      // Clean up if something failed.
      subscription?.remove();
      subscription = null;
      if (player) {
        try {
          player.remove();
        } catch (cleanupError) {
          console.warn("[Feedback] Failed to clean up sound:", cleanupError);
        }
        player = null;
      }
    }
  }

  /**
   * Play haptic feedback.
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
        case "info":
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
      }
    } catch (error) {
      console.warn(`[Feedback] Haptic feedback failed for ${type}:`, error);
    }
  }

  /**
   * Trigger sound and/or haptic feedback.
   */
  async trigger(type: FeedbackType, options?: FeedbackOptions): Promise<void> {
    const soundEnabled = options?.sound !== false;
    const hapticEnabled = options?.haptic !== false;

    const tasks: Promise<void>[] = [];

    if (soundEnabled) {
      tasks.push(this.playSound(type));
    }
    if (hapticEnabled) {
      tasks.push(this.playHaptic(type));
    }

    await Promise.all(tasks);
  }

  /**
   * Enable or disable sounds globally.
   */
  setSoundEnabled(enabled: boolean): void {
    this.soundEnabled = enabled;
  }

  /**
   * Enable or disable haptics globally.
   */
  setHapticEnabled(enabled: boolean): void {
    this.hapticEnabled = enabled;
  }

  /**
   * Check whether sound is enabled.
   */
  isSoundEnabled(): boolean {
    return this.soundEnabled;
  }

  /**
   * Check whether haptic feedback is enabled.
   */
  isHapticEnabled(): boolean {
    return this.hapticEnabled;
  }

  /**
   * Reset the audio initialization state.
   */
  reset(): void {
    this.initialized = false;
    this.loadPromise = null;
  }
}

export const feedbackManager = new FeedbackManager();

/**
 * React hook for using feedback.
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
    options?: FeedbackOptions,
  ): Promise<void> => {
    await feedbackManager.trigger(type, options);
  };

  return {
    trigger,
    ready,
  };
}

/**
 * Wrap a function and trigger feedback after it succeeds.
 */
export function withFeedback<T extends (...args: unknown[]) => unknown>(
  fn: T,
  type: FeedbackType = "light",
  options?: FeedbackOptions,
): (...args: Parameters<T>) => Promise<Awaited<ReturnType<T>>> {
  return async (...args: Parameters<T>): Promise<Awaited<ReturnType<T>>> => {
    const result = await fn(...args);
    await feedbackManager.trigger(type, options);
    return result as Awaited<ReturnType<T>>;
  };
}

/**
 * Create a button handler with haptic feedback.
 */
export function createFeedbackButton(
  onPress: () => void | Promise<void>,
  type: FeedbackType = "selection",
): () => Promise<void> {
  return async (): Promise<void> => {
    await feedbackManager.trigger(type, {
      sound: false,
      haptic: true,
    });
    await onPress();
  };
}