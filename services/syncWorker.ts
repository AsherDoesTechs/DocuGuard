import { AppState, AppStateStatus } from "react-native";
import { syncToCloud, SyncResult } from "./syncService";
import {
  getUnsyncedDocumentCount,
  getUnsyncedDocuments,
  getUnsyncedReminderCount,
} from "./localDatabase";
import { syncRetryStore } from "./syncRetryStore";
import { DebugLogger } from "./debugLogger";
import {
  mergeSyncRequest,
  scopeToSyncOptions,
  hasWork,
  computeNextDelayMs,
  SyncRequest,
} from "@/shared/sync/syncWorkerCore";

/**
 * How long the worker waits between two passes.
 *
 * The per-record backoff in the retry log is what actually protects the
 * server from a failing document. This interval only keeps an idle app from
 * asking the network the same question every few seconds.
 *
 * The actual retry timing of a failed record is therefore:
 *
 *   - the per-record backoff decides whether the record is due at all, and
 *     it starts at 30 seconds and doubles up to 30 minutes;
 *   - the worker only looks for due records every 5 minutes, so the earliest
 *     a record with a 30 second backoff is attempted again is 5 minutes after
 *     the failure, and later for records with a longer backoff.
 *
 * A record that is saved while the app is open does not wait for the poll: the
 * save asks for a pass, and the request runs as soon as the minimum interval
 * has passed.
 */
const MIN_INTERVAL_MS = 60 * 1000;

/** How often the worker looks for work while the app is in the foreground. */
const POLL_INTERVAL_MS = 5 * 60 * 1000;

/** The first pass waits a moment so it does not compete with app start-up. */
const INITIAL_DELAY_MS = 8 * 1000;

export interface SyncRequestOptions {
  /** Attempt every queued record, ignoring the per-record backoff. */
  force?: boolean;
  /** Restrict the pass to a single local document. */
  onlyDocumentId?: number;
  /** Called once the pass that covers this request has finished. */
  onComplete?: (result: SyncResult) => void;
}

/**
 * The retry worker.
 *
 * There was no worker at all before: `syncToCloud` was only reachable from the
 * "Sync now" button on the Cloud Sync screen, so a document saved while
 * offline stayed unsynchronised until the user happened to open that screen
 * and press the button.
 *
 * The worker changes nothing about how a document is saved. It only pushes the
 * records that are already queued, respects the per-record backoff, and never
 * removes local data.
 */
class SyncWorker {
  private running = false;
  private lastRunAt = 0;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private appStateSubscription: { remove?: () => void } | null = null;
  private started = false;
  private rerunRequested = false;
  private pendingCallbacks: Array<(result: SyncResult) => void> = [];
  private nextRequest: SyncRequest | null = null;

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

  /**
   * Asks for a pass as soon as possible.
   *
   * Called right after a document is saved so the user does not have to wait
   * for the next poll to see the document in their cloud vault. The request is
   * scoped to the document that was saved, so a record that is waiting for its
   * backoff is not pushed early by an unrelated save.
   *
   * A request that arrives while another one is waiting does not replace it:
   * the scopes are merged, so neither document is dropped.
   */
  requestSync(options: SyncRequestOptions = {}): void {
    if (options.onComplete) {
      this.pendingCallbacks.push(options.onComplete);
    }

    this.nextRequest = mergeSyncRequest(this.nextRequest, {
      force: Boolean(options.force),
      documentIds:
        options.onlyDocumentId !== undefined && options.onlyDocumentId !== null
          ? [options.onlyDocumentId]
          : null,
    });

    if (this.running) {
      // A pass is already in flight. It may not know about a document that was
      // just queued, so ask for another pass afterwards.
      this.rerunRequested = true;
      return;
    }

    const elapsed = Date.now() - this.lastRunAt;
    const delay = computeNextDelayMs({
      elapsedMs: elapsed,
      force: this.nextRequest.force,
      minIntervalMs: MIN_INTERVAL_MS,
    });

    if (delay > 0) {
      this.scheduleNext(delay);
      return;
    }

    void this.runPass();
  }

  private handleAppStateChange = (state: AppStateStatus): void => {
    if (state === "active") {
      this.requestSync();
    }
  };

  private scheduleNext(delayMs: number): void {
    if (!this.started) {
      return;
    }

    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
    }

    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      void this.runPass();
    }, delayMs);
  }

  private flushCallbacks(result: SyncResult): void {
    const callbacks = this.pendingCallbacks;
    this.pendingCallbacks = [];

    for (const callback of callbacks) {
      try {
        callback(result);
      } catch (error) {
        DebugLogger.warn("SyncWorker", "Sync completion callback failed", {
          error,
        });
      }
    }
  }

  private async runPass(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;

    const request = this.nextRequest;
    this.nextRequest = null;

    let result: SyncResult = {
      success: true,
      message: "Nothing to sync.",
      documentsSynced: 0,
      remindersSynced: 0,
    };

    try {
      const [pendingDocuments, pendingReminders] = await Promise.all([
        getUnsyncedDocumentCount(),
        getUnsyncedReminderCount(),
      ]);

      if (!hasWork({ pendingDocuments, pendingReminders })) {
        this.lastRunAt = Date.now();
        this.flushCallbacks(result);
        return;
      }

      const scope = scopeToSyncOptions(request);

      result = await syncToCloud({
        ...scope,
        // Reminders are queued the same way documents are, so the background
        // worker has to push them too. Without it a reminder created offline
        // only reached the server when the user opened the sync screen.
        includeReminders: true,
        includeProfile: false,
        triggerExport: false,
      });

      this.lastRunAt = Date.now();

      if (result.errors && result.errors.length > 0) {
        DebugLogger.warn("SyncWorker", "Sync pass finished with errors", {
          errors: result.errors,
        });
      }

      // Drop the retry log of records that no longer exist.
      const queued = await getUnsyncedDocuments();
      await syncRetryStore.prune(
        queued.map((doc) => doc.id!).filter((id): id is number => Boolean(id)),
      );
    } catch (error) {
      DebugLogger.warn("SyncWorker", "Sync pass failed", { error });
    } finally {
      this.running = false;
      this.flushCallbacks(result);

      if (this.rerunRequested) {
        this.rerunRequested = false;
        void this.runPass();
        return;
      }

      if (this.started) {
        this.scheduleNext(POLL_INTERVAL_MS);
      }
    }
  }
}

export const syncWorker = new SyncWorker();
