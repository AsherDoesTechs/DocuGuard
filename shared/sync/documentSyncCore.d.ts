import type { SyncFailure, SyncDocumentPayload } from "./syncPolicy";

export declare const SYNC_OUTCOME: Readonly<{
  SYNCED: "synced";
  FAILED: "failed";
  CONFLICT: "conflict";
  DELETED: "deleted";
}>;

export type SyncOutcomeStatus = "synced" | "failed" | "conflict" | "deleted";

export interface SyncOutcome {
  status: SyncOutcomeStatus;
  docId?: number;
  cloudId?: number | null;
  serverUpdatedAt?: string | null;
  failure?: SyncFailure;
  retryable: boolean;
  permanent: boolean;
  message: string;
}

export interface DocumentSyncDeps {
  /** Performs the remote write. Must reject on failure. */
  requestSync: (payload: SyncDocumentPayload) => Promise<any>;
  /** Removes the server row for a tombstone. */
  deleteCloudDocument: (cloudId: number) => Promise<void>;
  /** Clears `needsSync` and stores the cloud id plus the server revision. */
  markSynced: (
    docId: number,
    cloudId: number | null,
    serverUpdatedAt: string | null,
  ) => Promise<void>;
  /** Marks the record as failed while keeping it queued for a retry. */
  markFailed: (docId: number) => Promise<void>;
  /** Removes the local row once the server copy is gone. */
  markDeleted: (docId: number) => Promise<void>;
  formatCategory?: (value: string | undefined) => string;
  onInternalError?: (error: unknown, context: { stage: string; docId?: number }) => void;
}

export declare function syncDocumentToCloud(
  doc: Record<string, any>,
  deps: DocumentSyncDeps,
): Promise<SyncOutcome>;

export declare function syncDeletedDocument(
  doc: Record<string, any>,
  deps: DocumentSyncDeps,
): Promise<SyncOutcome>;

export declare function readCloudId(result: any): number | null;
export declare function readServerUpdatedAt(result: any): string | null;

/**
 * The revision the server holds for a document it refused to overwrite.
 * Reported for the user; never stored locally.
 */
export declare function readConflictServerUpdatedAt(error: any): string | null;
