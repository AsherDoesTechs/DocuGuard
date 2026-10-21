"use strict";

/**
 * Sync policy shared by the mobile client and the API.
 *
 * Everything in this module is pure: it takes plain data in and returns plain
 * data out. That is deliberate. The rules that decide whether a document is
 * retried, when it is retried and what is sent to the server are exactly the
 * rules that broke silently before, and they could not be tested because they
 * were buried inside a React screen and an Axios call.
 *
 * The module is plain CommonJS so the Express server can `require` it and the
 * Expo client can `import` it without a build step.
 */

const { normalizeCloudId } = require("./cloudId");
const {
  SERVER_REVISION_PATTERN,
  LEGACY_REVISION_PATTERN,
  canonicalizeServerRevision,
} = require("./serverRevision");

const SYNC_FAILURE_KIND = Object.freeze({  /** No usable connection. The document stays pending and is retried later. */
  OFFLINE: "offline",
  /** The server row moved on. A human has to decide which side wins. */
  CONFLICT: "conflict",
  /** The session is no longer valid. Signing in again is required. */
  AUTH: "auth",
  /** The server refused the payload. Retrying the same payload cannot help. */
  VALIDATION: "validation",
  /** The server failed. The payload is fine, so it is worth retrying. */
  SERVER: "server",
  UNKNOWN: "unknown",
});

/**
 * How many times a single document is retried automatically.
 *
 * After this many attempts the record is parked as "requires attention" instead
 * of being retried forever, so a permanently broken document cannot keep the
 * retry queue busy or spam the user.
 */
const MAX_SYNC_ATTEMPTS = 5;

const DEFAULT_BACKOFF_BASE_MS = 30 * 1000;
const DEFAULT_BACKOFF_MAX_MS = 30 * 60 * 1000;
const DEFAULT_BACKOFF_FACTOR = 2;

const SERVER_CATEGORIES = ["identification", "financial", "medical", "legal", "academic", "other"];
const SERVER_STATUSES = ["active", "verified", "expired"];
const SERVER_PROCESSING_STATUSES = ["pending", "uploading", "processing", "completed", "failed"];

/**
 * Turns any thrown value into a decision the sync engine can act on.
 *
 * The distinction that matters is retryable versus permanent. A dropped
 * connection is worth retrying with the exact same payload. A rejected payload
 * is not: retrying it burns the user's data plan and never succeeds, so the
 * record has to be surfaced to the user instead.
 */
function classifySyncFailure(error) {
  const status =
    error && typeof error.response === "object" && error.response
      ? error.response.status
      : undefined;

  const code = error && typeof error.code === "string" ? error.code : "";

  const isOffline =
    Boolean(error && error.isOffline) ||
    code === "ERR_NETWORK" ||
    code === "ECONNABORTED" ||
    code === "ETIMEDOUT";

  if (isOffline) {
    return {
      kind: SYNC_FAILURE_KIND.OFFLINE,
      retryable: true,
      permanent: false,
      status: undefined,
      message: "Network unavailable. The document is saved on this device.",
    };
  }

  if (status === 409) {
    return {
      kind: SYNC_FAILURE_KIND.CONFLICT,
      retryable: false,
      permanent: true,
      status,
      message:
        "This document was changed on another device. The local copy was kept.",
    };
  }

  if (status === 401 || status === 403) {
    return {
      kind: SYNC_FAILURE_KIND.AUTH,
      retryable: false,
      permanent: true,
      status,
      message: "Your session is no longer valid. Sign in again to sync.",
    };
  }

  if (status === 404) {
    return {
      kind: SYNC_FAILURE_KIND.VALIDATION,
      retryable: false,
      permanent: true,
      status,
      message: "The server copy of this document no longer exists.",
    };
  }

  if (status === 400 || status === 422) {
    return {
      kind: SYNC_FAILURE_KIND.VALIDATION,
      retryable: false,
      permanent: true,
      status,
      message: "The server rejected the document details. Review and try again.",
    };
  }

  if (typeof status === "number" && status >= 500) {
    return {
      kind: SYNC_FAILURE_KIND.SERVER,
      retryable: true,
      permanent: false,
      status,
      message: "The server could not complete the sync. It will be retried.",
    };
  }

  if (typeof status === "number" && status >= 400) {
    return {
      kind: SYNC_FAILURE_KIND.VALIDATION,
      retryable: false,
      permanent: true,
      status,
      message: "The server rejected the document details. Review and try again.",
    };
  }

  return {
    kind: SYNC_FAILURE_KIND.UNKNOWN,
    retryable: true,
    permanent: false,
    status,
    message:
      (error && error.message) || "An unexpected error occurred while syncing.",
  };
}

/**
 * Exponential backoff, capped.
 *
 * `attempts` is the number of failures recorded so far, so the first retry
 * waits `baseMs`, the second `baseMs * factor` and so on.
 */
function computeBackoffDelayMs(attempts, options) {
  const base =
    options && typeof options.baseMs === "number"
      ? options.baseMs
      : DEFAULT_BACKOFF_BASE_MS;
  const max =
    options && typeof options.maxMs === "number"
      ? options.maxMs
      : DEFAULT_BACKOFF_MAX_MS;
  const factor =
    options && typeof options.factor === "number"
      ? options.factor
      : DEFAULT_BACKOFF_FACTOR;

  const count = Number.isFinite(attempts) ? Math.max(0, Math.floor(attempts)) : 0;

  if (count === 0) {
    return 0;
  }

  const delay = base * Math.pow(factor, count - 1);
  return Math.min(Math.round(delay), max);
}

/** A fresh retry state. No attempts have been made yet. */
function createSyncAttemptState() {
  return {
    attempts: 0,
    lastAttemptAt: null,
    nextAttemptAt: null,
    lastError: null,
    lastStatus: null,
    permanent: false,
  };
}

/**
 * Folds a failed attempt into the retry state.
 *
 * A failure that is permanent, or that has used up the attempt budget, stops
 * the automatic retries. The document itself is never touched here: it stays in
 * the local database and stays visible to the user.
 */
function recordSyncFailure(state, failure, now, options) {
  const previous = state || createSyncAttemptState();
  const attempts = (Number(previous.attempts) || 0) + 1;

  const exhausted = attempts >= MAX_SYNC_ATTEMPTS;
  const permanent = Boolean(failure && failure.permanent) || exhausted;

  const delay = permanent ? 0 : computeBackoffDelayMs(attempts, options);

  return {
    attempts,
    lastAttemptAt: now,
    nextAttemptAt: permanent ? null : now + delay,
    lastError: (failure && failure.message) || null,
    lastStatus: (failure && failure.kind) || SYNC_FAILURE_KIND.UNKNOWN,
    permanent,
  };
}

/**
 * Whether a record may be attempted again right now.
 *
 * A record with no state is due. A record whose backoff has not elapsed is
 * not. A permanently failed record is never due automatically; it needs the
 * user to act.
 */
function isSyncAttemptDue(state, now) {
  if (!state) {
    return true;
  }

  if (state.permanent) {
    return false;
  }

  if (state.nextAttemptAt === null || state.nextAttemptAt === undefined) {
    return true;
  }

  return now >= state.nextAttemptAt;
}

/**
 * True when the record is parked and the user has to do something about it.
 */
function requiresUserAttention(state) {
  return Boolean(state && state.permanent);
}

/**
 * The reasons a record is or is not attempted in a pass.
 */
const SYNC_GATE = Object.freeze({
  /** The record was never attempted. */
  NEW: "new",
  /** The backoff has elapsed. */
  DUE: "due",
  /** The user asked for it explicitly, so the backoff is ignored. */
  FORCED: "forced",
  /** The backoff has not elapsed yet. */
  BACKOFF: "backoff",
  /** The record is parked and only the user can release it. */
  PARKED: "parked",
});

/**
 * Decides whether a record may be attempted in this pass.
 *
 * The rules, in order:
 *
 *   - an explicit request overrides the backoff and the parked state;
 *   - a record that was never attempted is due;
 *   - a parked record is never attempted behind the user's back;
 *   - a record whose backoff has not elapsed is left queued.
 *
 * @param {object | null | undefined} state The retry state of the record.
 * @param {{ force?: boolean, now?: number }} options
 * @returns {{ attempt: boolean, reason: string, needsAttention: boolean }}
 */
function evaluateSyncGate(state, options) {
  const force = Boolean(options && options.force);
  const now =
    options && typeof options.now === "number"
      ? options.now
      : Date.now();

  if (force) {
    return {
      attempt: true,
      reason: SYNC_GATE.FORCED,
      needsAttention: false,
    };
  }

  if (!state) {
    return { attempt: true, reason: SYNC_GATE.NEW, needsAttention: false };
  }

  if (state.permanent) {
    return {
      attempt: false,
      reason: SYNC_GATE.PARKED,
      needsAttention: true,
    };
  }

  if (!isSyncAttemptDue(state, now)) {
    return {
      attempt: false,
      reason: SYNC_GATE.BACKOFF,
      needsAttention: false,
    };
  }

  return { attempt: true, reason: SYNC_GATE.DUE, needsAttention: false };
}

/**
 * Only https URLs are meaningful to the server.
 *
 * The local database keeps the on-device `file://` path of a picked file so
 * the app can still open it. Sending that path to the server made every
 * request fail validation, so the document could never sync.
 */
function isRemoteFileUrl(value) {
  return typeof value === "string" && /^https:\/\//i.test(value.trim());
}

function pickEnum(value, allowed, fallback) {
  return typeof value === "string" && allowed.indexOf(value) !== -1
    ? value
    : fallback;
}

/**
 * Builds the payload for `POST /documents/sync`.
 *
 * Optional fields that hold no value are omitted rather than sent as null.
 * The server schema treats "absent" as "not provided" and null as a type
 * error, so sending `riskScore: null` used to make the whole request fail
 * with a 400 for every document that had never been risk-assessed.
 */
function buildDocumentSyncPayload(doc, options) {
  const source = doc || {};
  const formatCategory =
    options && typeof options.formatCategory === "function"
      ? options.formatCategory
      : (value) => value;

  const payload = {
    title: String(source.title || "").trim(),
    category: pickEnum(
      formatCategory(source.category),
      SERVER_CATEGORIES,
      "other",
    ),
    issuer: String(source.issuer || "").trim(),
    documentNumber: String(source.documentNumber || "").trim().toUpperCase(),
    issueDate: source.issueDate ? String(source.issueDate) : null,
    expiryDate: source.expiryDate ? String(source.expiryDate) : null,
    status: pickEnum(source.status, SERVER_STATUSES, "active"),
    enableAlerts: source.enableAlerts === false ? false : true,
    /*
     * The processing state of the file.
     *
     * A document whose file is stored has finished its processing: the upload
     * completed and, for a scan, the OCR already ran on the server. The
     * transient "processing" state was pushed with every metadata sync and
     * downgraded the server row from "completed" to "processing", so the
     * document then waited for an OCR run that was never going to happen.
     *
     * A failed upload is reported as failed, because that is the truth.
     */
    processingStatus:
      pickEnum(source.processingStatus, SERVER_PROCESSING_STATUSES, "completed") ===
      "failed"
        ? "failed"
        : "completed",
  };

  if (typeof source.notes === "string" && source.notes.length > 0) {
    payload.notes = source.notes;
  }

  if (typeof source.riskScore === "number" && Number.isFinite(source.riskScore)) {
    payload.riskScore = source.riskScore;
  }

  if (typeof source.riskLevel === "string" && source.riskLevel.length > 0) {
    payload.riskLevel = source.riskLevel;
  }

  if (typeof source.s3Key === "string" && source.s3Key.length > 0) {
    payload.s3Key = source.s3Key;
  }

  if (isRemoteFileUrl(source.fileUrl)) {
    payload.fileUrl = source.fileUrl;
  }

  if (typeof source.fileType === "string" && source.fileType.length > 0) {
    payload.fileType = source.fileType;
  }

  // The server row this document belongs to. Without it the server has to
  // guess from the document number, which is how a retry could create a
  // second copy of the same document.
  /*
   * The server row this document belongs to. Without it the server has to
   * guess from the document number, which is how a retry could create a
   * second copy of the same document.
   */
  const cloudId = normalizeCloudId(source.cloudId);
  if (cloudId !== null) {
    payload.cloudId = cloudId;
  }

  /*
   * The server revision this device last saw. The server refuses the write
   * when the row moved on, so a change made elsewhere is never overwritten.
   *
   * The revision is only sent in the exact format the server compares. A
   * legacy millisecond revision is rewritten into that format; a revision
   * that cannot be rewritten is left out, and the server then treats the push
   * as an unconditional update. That case is limited to a document that has
   * never been synced with revision tracking: the response of that push
   * carries the canonical revision, so every later push is conflict checked.
   */
  const baseUpdatedAt = canonicalizeServerRevision(source.serverUpdatedAt);
  if (baseUpdatedAt !== null) {
    payload.baseUpdatedAt = baseUpdatedAt;
  }

  return payload;
}

module.exports = {
  SYNC_FAILURE_KIND,
  MAX_SYNC_ATTEMPTS,
  DEFAULT_BACKOFF_BASE_MS,
  DEFAULT_BACKOFF_MAX_MS,
  DEFAULT_BACKOFF_FACTOR,
  SERVER_REVISION_PATTERN,
  LEGACY_REVISION_PATTERN,
  classifySyncFailure,
  computeBackoffDelayMs,
  createSyncAttemptState,
  recordSyncFailure,
  isSyncAttemptDue,
  requiresUserAttention,
  evaluateSyncGate,
  SYNC_GATE,
  isRemoteFileUrl,
  canonicalizeServerRevision,
  buildDocumentSyncPayload,
};
