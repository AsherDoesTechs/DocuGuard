/**
 * A request for a sync pass.
 */
export interface SyncRequest {
  /** Attempt every queued record, ignoring the per-record backoff. */
  force: boolean;
  /** The documents to cover, or null for every queued document. */
  documentIds: number[] | null;
}

/** Merges a new request into the request that is already waiting. */
export declare function mergeSyncRequest(
  current: SyncRequest | null | undefined,
  request: SyncRequest,
): SyncRequest;

/** The options a scope turns into for the sync pass. */
export declare function scopeToSyncOptions(scope: SyncRequest | null | undefined): {
  force: boolean;
  onlyDocumentIds?: number[];
};

/** Whether a pass has anything to do at all. */
export declare function hasWork(counts: {
  pendingDocuments?: number;
  pendingReminders?: number;
}): boolean;

/** How long to wait before the next pass. */
export declare function computeNextDelayMs(options: {
  elapsedMs: number;
  force?: boolean;
  minIntervalMs: number;
}): number;
