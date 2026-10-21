"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  classifySyncFailure,
  computeBackoffDelayMs,
  createSyncAttemptState,
  recordSyncFailure,
  isSyncAttemptDue,
  requiresUserAttention,
  evaluateSyncGate,
  SYNC_GATE,
  isRemoteFileUrl,
  buildDocumentSyncPayload,
  MAX_SYNC_ATTEMPTS,
  SYNC_FAILURE_KIND,
} = require("../shared/sync/syncPolicy");

test("an offline failure is retryable", () => {
  const failure = classifySyncFailure({ isOffline: true });

  assert.equal(failure.kind, SYNC_FAILURE_KIND.OFFLINE);
  assert.equal(failure.retryable, true);
  assert.equal(failure.permanent, false);
});

test("a conflict is permanent so it is not retried forever", () => {
  const failure = classifySyncFailure({ response: { status: 409 } });

  assert.equal(failure.kind, SYNC_FAILURE_KIND.CONFLICT);
  assert.equal(failure.retryable, false);
  assert.equal(failure.permanent, true);
});

test("a rejected payload is permanent, a server error is not", () => {
  const rejected = classifySyncFailure({ response: { status: 400 } });
  const serverError = classifySyncFailure({ response: { status: 503 } });

  assert.equal(rejected.permanent, true);
  assert.equal(serverError.retryable, true);
  assert.equal(serverError.permanent, false);
});

test("an expired session is permanent and asks for a sign in", () => {
  const failure = classifySyncFailure({ response: { status: 401 } });

  assert.equal(failure.kind, SYNC_FAILURE_KIND.AUTH);
  assert.equal(failure.permanent, true);
});

test("the backoff grows and is capped", () => {
  const options = { baseMs: 1000, maxMs: 8000, factor: 2 };

  assert.equal(computeBackoffDelayMs(1, options), 1000);
  assert.equal(computeBackoffDelayMs(2, options), 2000);
  assert.equal(computeBackoffDelayMs(3, options), 4000);
  assert.equal(computeBackoffDelayMs(4, options), 8000);
  assert.equal(computeBackoffDelayMs(9, options), 8000);
});

test("a failed attempt is not due again until its backoff elapsed", () => {
  const now = 1_000_000;
  const failure = classifySyncFailure({ isOffline: true });
  const state = recordSyncFailure(createSyncAttemptState(), failure, now, {
    baseMs: 30_000,
  });

  assert.equal(state.attempts, 1);
  assert.equal(isSyncAttemptDue(state, now), false);
  assert.equal(isSyncAttemptDue(state, now + 29_000), false);
  assert.equal(isSyncAttemptDue(state, now + 31_000), true);
});

test("the attempt budget is bounded and the record is parked afterwards", () => {
  const now = 1_000_000;
  const failure = classifySyncFailure({ isOffline: true });
  let state = createSyncAttemptState();

  for (let attempt = 0; attempt < MAX_SYNC_ATTEMPTS; attempt++) {
    state = recordSyncFailure(state, failure, now, { baseMs: 1 });
  }

  assert.equal(state.attempts, MAX_SYNC_ATTEMPTS);
  assert.equal(state.permanent, true);
  assert.equal(requiresUserAttention(state), true);
  assert.equal(isSyncAttemptDue(state, now + 10_000_000), false);
});

test("a permanent failure parks the record on the first attempt", () => {
  const failure = classifySyncFailure({ response: { status: 409 } });
  const state = recordSyncFailure(createSyncAttemptState(), failure, 1000);

  assert.equal(state.permanent, true);
  assert.equal(state.nextAttemptAt, null);
  assert.equal(isSyncAttemptDue(state, 999_999_999), false);
});

test("a record without a retry state is always due", () => {
  assert.equal(isSyncAttemptDue(null, 0), true);
  assert.equal(isSyncAttemptDue(createSyncAttemptState(), 0), true);
});

test("only https file urls are sent to the server", () => {
  assert.equal(isRemoteFileUrl("https://example.com/a.pdf"), true);
  assert.equal(isRemoteFileUrl("file:///data/user/0/a.pdf"), false);
  assert.equal(isRemoteFileUrl("http://example.com/a.pdf"), false);
  assert.equal(isRemoteFileUrl(undefined), false);
});

test("the sync payload omits values that are not set", () => {
  const payload = buildDocumentSyncPayload({
    title: "Passport",
    category: "identification",
    issuer: "DFA",
    documentNumber: "p123",
    issueDate: "2024-01-01",
    expiryDate: null,
    notes: "",
    status: "active",
    enableAlerts: true,
    processingStatus: "processing",
    riskScore: null,
    riskLevel: null,
    fileUrl: "file:///data/user/0/local.pdf",
    s3Key: null,
    cloudId: null,
  });

  // A null risk score was the reason every document was rejected with a 400.
  assert.equal("riskScore" in payload, false);
  assert.equal("riskLevel" in payload, false);
  assert.equal("notes" in payload, false);
  assert.equal("fileUrl" in payload, false);
  assert.equal("s3Key" in payload, false);
  assert.equal("cloudId" in payload, false);
  assert.equal(payload.expiryDate, null);
  assert.equal(payload.issueDate, "2024-01-01");
  assert.equal(payload.documentNumber, "P123");
});

test("the sync payload carries the cloud id and the revision when they are known", () => {  const payload = buildDocumentSyncPayload({
    title: "Passport",
    category: "identification",
    issuer: "DFA",
    documentNumber: "P123",
    issueDate: "2024-01-01",
    expiryDate: "2030-01-01",
    status: "active",
    enableAlerts: true,
    processingStatus: "completed",
    riskScore: 12,
    riskLevel: "Low",
    fileUrl: "https://example.com/a.pdf",
    s3Key: "1/abc.pdf",
    cloudId: 42,
    serverUpdatedAt: "2026-10-20T15:27:11.123456Z",
  });

  assert.equal(payload.cloudId, 42);
  assert.equal(payload.baseUpdatedAt, "2026-10-20T15:27:11.123456Z");
  assert.equal(payload.riskScore, 12);
  assert.equal(payload.riskLevel, "Low");
  assert.equal(payload.fileUrl, "https://example.com/a.pdf");
  assert.equal(payload.s3Key, "1/abc.pdf");
});

/*
 * The gate decides what a sync pass is allowed to attempt. These are the
 * rules the pass in `services/syncService.ts` runs on, and they are the
 * reason a failing document is not hammered and a parked document is not
 * retried behind the user's back.
 */

test("a record without a retry state is attempted", () => {
  const gate = evaluateSyncGate(null, { now: 1_000 });

  assert.equal(gate.attempt, true);
  assert.equal(gate.reason, SYNC_GATE.NEW);
  assert.equal(gate.needsAttention, false);
});

test("a record in backoff is left queued", () => {
  const now = 1_000_000;
  const failure = classifySyncFailure({ isOffline: true });
  const state = recordSyncFailure(createSyncAttemptState(), failure, now, {
    baseMs: 30_000,
  });

  const gate = evaluateSyncGate(state, { now: now + 1_000 });

  assert.equal(gate.attempt, false);
  assert.equal(gate.reason, SYNC_GATE.BACKOFF);
  assert.equal(gate.needsAttention, false);
});

test("a record is attempted once its backoff elapsed", () => {
  const now = 1_000_000;
  const failure = classifySyncFailure({ isOffline: true });
  const state = recordSyncFailure(createSyncAttemptState(), failure, now, {
    baseMs: 30_000,
  });

  const gate = evaluateSyncGate(state, { now: now + 31_000 });

  assert.equal(gate.attempt, true);
  assert.equal(gate.reason, SYNC_GATE.DUE);
});

test("a parked record is not retried and is reported to the user", () => {
  const failure = classifySyncFailure({ response: { status: 409 } });
  const state = recordSyncFailure(createSyncAttemptState(), failure, 1_000);

  const gate = evaluateSyncGate(state, { now: 1_000_000_000 });

  assert.equal(gate.attempt, false);
  assert.equal(gate.reason, SYNC_GATE.PARKED);
  assert.equal(gate.needsAttention, true);
});

test("an explicit request overrides the backoff and the parked state", () => {
  const failure = classifySyncFailure({ response: { status: 409 } });
  const state = recordSyncFailure(createSyncAttemptState(), failure, 1_000);

  const gate = evaluateSyncGate(state, { force: true, now: 1_000 });

  assert.equal(gate.attempt, true);
  assert.equal(gate.reason, SYNC_GATE.FORCED);
  assert.equal(gate.needsAttention, false);
});

test("a record that used up its attempts is parked and never retried again", () => {
  const now = 1_000_000;
  const failure = classifySyncFailure({ isOffline: true });
  let state = createSyncAttemptState();

  for (let attempt = 0; attempt < MAX_SYNC_ATTEMPTS; attempt++) {
    state = recordSyncFailure(state, failure, now, { baseMs: 1 });
  }

  const gate = evaluateSyncGate(state, { now: now + 10_000_000 });

  assert.equal(state.permanent, true);
  assert.equal(gate.attempt, false);
  assert.equal(gate.reason, SYNC_GATE.PARKED);
  assert.equal(gate.needsAttention, true);
});
