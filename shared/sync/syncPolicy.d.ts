export type SyncFailureKind =
  | "offline"
  | "conflict"
  | "auth"
  | "validation"
  | "server"
  | "unknown";

export interface SyncFailure {
  kind: SyncFailureKind;
  /** Whether the same payload can be sent again and might succeed. */
  retryable: boolean;
  /** Whether the record must be surfaced to the user instead of retried. */
  permanent: boolean;
  status?: number;
  message: string;
}

export interface SyncAttemptState {
  attempts: number;
  lastAttemptAt: number | null;
  nextAttemptAt: number | null;
  lastError: string | null;
  lastStatus: SyncFailureKind | null;
  permanent: boolean;
}

export interface BackoffOptions {
  baseMs?: number;
  maxMs?: number;
  factor?: number;
}

export interface SyncPayloadOptions {
  formatCategory?: (value: string | undefined) => string;
}

export interface SyncDocumentPayload {
  title: string;
  category: string;
  issuer: string;
  documentNumber: string;
  issueDate: string | null;
  expiryDate: string | null;
  status: string;
  enableAlerts: boolean;
  processingStatus: string;
  notes?: string;
  riskScore?: number;
  riskLevel?: string;
  s3Key?: string;
  fileUrl?: string;
  fileType?: string;
  cloudId?: number;
  baseUpdatedAt?: string;
}

export declare const SYNC_FAILURE_KIND: Readonly<{
  OFFLINE: "offline";
  CONFLICT: "conflict";
  AUTH: "auth";
  VALIDATION: "validation";
  SERVER: "server";
  UNKNOWN: "unknown";
}>;

export declare const MAX_SYNC_ATTEMPTS: number;
export declare const DEFAULT_BACKOFF_BASE_MS: number;
export declare const DEFAULT_BACKOFF_MAX_MS: number;
export declare const DEFAULT_BACKOFF_FACTOR: number;

/** The exact revision format the server emits and expects. */
export declare const SERVER_REVISION_PATTERN: RegExp;

/** The millisecond revision format a pre-upgrade server produced. */
export declare const LEGACY_REVISION_PATTERN: RegExp;

export declare function classifySyncFailure(error: unknown): SyncFailure;

export declare function computeBackoffDelayMs(
  attempts: number,
  options?: BackoffOptions,
): number;

export declare function createSyncAttemptState(): SyncAttemptState;

export declare function recordSyncFailure(
  state: SyncAttemptState | null | undefined,
  failure: SyncFailure,
  now: number,
  options?: BackoffOptions,
): SyncAttemptState;

export declare function isSyncAttemptDue(
  state: SyncAttemptState | null | undefined,
  now: number,
): boolean;

export declare function requiresUserAttention(
  state: SyncAttemptState | null | undefined,
): boolean;

/** The reasons a record is or is not attempted in a pass. */
export declare const SYNC_GATE: Readonly<{
  NEW: "new";
  DUE: "due";
  FORCED: "forced";
  BACKOFF: "backoff";
  PARKED: "parked";
}>;

/**
 * Decides whether a record may be attempted in this pass.
 */
export declare function evaluateSyncGate(
  state: SyncAttemptState | null | undefined,
  options: { force?: boolean; now?: number },
): { attempt: boolean; reason: string; needsAttention: boolean };

export declare function isRemoteFileUrl(value: unknown): boolean;

/**
 * Normalises a server revision into the exact format the server expects, or
 * returns null when the value cannot be used as a revision.
 */
export declare function canonicalizeServerRevision(
  value: unknown,
): string | null;

export declare function buildDocumentSyncPayload(
  doc: Record<string, any> | null | undefined,
  options?: SyncPayloadOptions,
): SyncDocumentPayload;
