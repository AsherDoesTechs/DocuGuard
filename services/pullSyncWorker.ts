import { AppState, AppStateStatus } from "react-native";
import { pullDocumentsFromCloud } from "./syncService";
import { DebugLogger } from "./debugLogger";

/**
 * Background pull sync worker.
 *
 * Fetches documents and reminders from the cloud periodically to keep the local
 * vault in sync with changes made on other devices. Runs independently of the
 * push sync worker and the realtime WebSocket.
 *
 * The push sync worker handles local→cloud; this worker handles cloud→local.
 * The realtime WebSocket provides instant updates when connected; this worker
 * provides periodic catch-up when the socket is disconnected or on app resume.
 */

const MIN_INTERVAL_MS = 30 * 1000;
const POLL_INTERVAL_MS = 5 * 60 * 1000;
const INITIAL_DELAY_MS = 10 * 1000;

class PullSyncWorker {
  private running = false;
  private lastRunAt = 0;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private appStateSubscription: { remove?: () => void } | null = null;
  private started = false;

  start(): void {
    if (this.started) {
      return;
    }

    this.started = true;

    this.appStateSubscription = AppState.addEventListener(
      "change",
      this.handleAppStateChange,
    );

    this.scheduleNext(INITIAL_DELAY_MS);
  }

  stop(): void {
    this.started = false;

    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    if (this.appStateSubscription?.remove) {
      this.appStateSubscription.remove();
    }

    this.appStateSubscription = null;
  }

  private handleAppStateChange = (state: AppStateStatus): void => {
    if (state === "active") {
      this.requestPull();
    }
  };

  private requestPull(): void {
    if (this.running) {
      return;
    }

    const elapsed = Date.now() - this.lastRunAt;
    const delay = Math.max(0, MIN_INTERVAL_MS - elapsed);

    if (delay > 0) {
      this.scheduleNext(delay);
      return;
    }

    void this.runPull();
  }

  private scheduleNext(delayMs: number): void {
    if (!this.started) {
      return;
    }

    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
    }

    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      void this.runPull();
    }, delayMs);
  }

  private async runPull(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;

    try {
      const processed = await pullDocumentsFromCloud();

      this.lastRunAt = Date.now();

      if (processed > 0) {
        DebugLogger.info("PullSyncWorker", "Pull sync completed", { processed });
      }
    } catch (error) {
      DebugLogger.warn("PullSyncWorker", "Pull sync failed", { error });
    } finally {
      this.running = false;

      if (this.started) {
        this.scheduleNext(POLL_INTERVAL_MS);
      }
    }
  }
}

export const pullSyncWorker = new PullSyncWorker();