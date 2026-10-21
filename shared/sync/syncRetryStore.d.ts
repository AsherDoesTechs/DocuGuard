import type { SyncAttemptState, SyncFailure, BackoffOptions } from "./syncPolicy";

export interface RetryStorageBackend {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem?: (key: string) => Promise<void>;
}

export interface SyncRetryStore {
  readonly key: string;
  /**
   * The retry state of one record.
   *
   * The key is a document id, or a namespaced key such as `reminder:12` for a
   * reminder, so the two id sequences cannot collide.
   */
  get(documentId: number | string): Promise<SyncAttemptState | null>;
  getAll(): Promise<Record<string, SyncAttemptState>>;
  isDue(documentId: number | string, now: number): Promise<boolean>;
  needsUserAttention(documentId: number | string): Promise<boolean>;
  recordFailure(
    documentId: number | string,
    failure: SyncFailure,
    now: number,
    backoffOptions?: BackoffOptions,
  ): Promise<SyncAttemptState>;
  clear(documentId: number | string): Promise<void>;
  prune(validIds: Array<number | string>): Promise<void>;
  /**
   * Drops the state of the records that were blocked by a failure of the
   * given kind, so they become eligible for a retry again.
   */
  clearBlockedBy(options?: { kind?: string }): Promise<boolean>;
  clearAll(): Promise<void>;
}

export declare const RETRY_STATE_KEY: string;

export declare function createSyncRetryStore(
  storage: RetryStorageBackend,
  options?: { key?: string },
): SyncRetryStore;
