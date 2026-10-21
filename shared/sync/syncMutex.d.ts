/**
 * A process-wide lock around the sync pass.
 */
export interface SyncMutex {
  /**
   * Runs `fn` once every previously requested run has finished.
   */
  run<T>(fn: () => Promise<T>): Promise<T>;

  /** True while a run is in progress. */
  isLocked(): boolean;

  /** Number of runs that are waiting for the current one. */
  pendingCount(): number;
}

export declare function createSyncMutex(): SyncMutex;
