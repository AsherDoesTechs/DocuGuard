"use strict";

/**
 * Revision (conflict detection) contract between the client and the server.
 *
 * The server stores `updated_at` with microsecond precision and renders it as
 * `YYYY-MM-DDTHH:MM:SS.ffffffZ`. A client that sends a revision in any other
 * shape either causes a false conflict (the row never matches) or bypasses the
 * check entirely (the row is overwritten without being compared).
 *
 * These tests cover the client half: which revision is sent, and what happens
 * when the server refuses the write.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildDocumentSyncPayload,
  canonicalizeServerRevision,
  SERVER_REVISION_PATTERN,
} = require("../shared/sync/syncPolicy");
const {
  syncDocumentToCloud,
  readConflictServerUpdatedAt,
  SYNC_OUTCOME,
} = require("../shared/sync/documentSyncCore");
const { FakeLocalStore } = require("./helpers/fakeLocalStore");

const CANONICAL = "2026-10-20T15:27:11.123456Z";
const LEGACY_MILLISECONDS = "2026-10-20T15:27:11.123Z";

function localDocument(overrides) {
  return {
    id: 1,
    title: "Passport",
    category: "identification",
    issuer: "DFA",
    documentNumber: "P123",
    issueDate: "2024-01-01",
    expiryDate: null,
    notes: "",
    status: "active",
    enableAlerts: true,
    processingStatus: "completed",
    riskScore: null,
    riskLevel: null,
    fileUrl: null,
    fileType: null,
    s3Key: null,
    cloudId: 42,
    serverUpdatedAt: null,
    needsSync: true,
    syncStatus: "pending",
    ...overrides,
  };
}

test("the canonical server revision is recognised and sent unchanged", () => {
  assert.ok(SERVER_REVISION_PATTERN.test(CANONICAL));
  assert.equal(canonicalizeServerRevision(CANONICAL), CANONICAL);

  const payload = buildDocumentSyncPayload(
    localDocument({ serverUpdatedAt: CANONICAL }),
  );
  assert.equal(payload.baseUpdatedAt, CANONICAL);
});

test("a legacy millisecond revision is rewritten into the server format", () => {
  assert.equal(
    canonicalizeServerRevision(LEGACY_MILLISECONDS),
    "2026-10-20T15:27:11.123000Z",
  );

  const payload = buildDocumentSyncPayload(
    localDocument({ serverUpdatedAt: LEGACY_MILLISECONDS }),
  );

  assert.equal(
    payload.baseUpdatedAt,
    "2026-10-20T15:27:11.123000Z",
    "the revision must be sent in the format the server compares",
  );
  assert.ok(
    SERVER_REVISION_PATTERN.test(payload.baseUpdatedAt),
    "the rewritten revision still has to be a canonical revision",
  );
});

test("a revision that cannot be parsed is not sent at all", () => {
  for (const value of [
    null,
    undefined,
    "",
    "   ",
    "not-a-date",
    "2026-10-20",
    "2026-10-20T15:27:11.123456+00:00",
    12345,
    {},
  ]) {
    assert.equal(canonicalizeServerRevision(value), null);
  }

  const payload = buildDocumentSyncPayload(
    localDocument({ serverUpdatedAt: "2026-10-20T15:27:11.123456+00:00" }),
  );
  assert.equal("baseUpdatedAt" in payload, false);
});

test("a document that was never synced sends no revision", () => {
  const payload = buildDocumentSyncPayload(localDocument({ cloudId: null }));
  assert.equal("baseUpdatedAt" in payload, false);
  assert.equal("cloudId" in payload, false);
});

test("a successful update stores the revision the server returned", async () => {
  const store = new FakeLocalStore([]);
  const docId = store.insert({ title: "Passport", needsSync: true, syncStatus: "pending" });

  const outcome = await syncDocumentToCloud(store.get(docId), {
    requestSync: async () => ({ document: { id: "42", updatedAt: CANONICAL } }),
    deleteCloudDocument: async () => {},
    markSynced: async (id, cloudId, serverUpdatedAt) =>
      store.markSynced(id, cloudId, serverUpdatedAt),
    markFailed: async (id) => store.markFailed(id),
    markDeleted: async (id) => store.remove(id),
  });

  assert.equal(outcome.status, SYNC_OUTCOME.SYNCED);
  assert.equal(store.get(docId).serverUpdatedAt, CANONICAL);
  assert.equal(store.get(docId).cloudId, 42);
});

test("a legacy server revision is stored in the comparable format", async () => {
  const store = new FakeLocalStore([]);
  const docId = store.insert({ title: "Passport", needsSync: true, syncStatus: "pending" });

  await syncDocumentToCloud(store.get(docId), {
    requestSync: async () => ({
      document: { id: "42", updatedAt: LEGACY_MILLISECONDS },
    }),
    deleteCloudDocument: async () => {},
    markSynced: async (id, cloudId, serverUpdatedAt) =>
      store.markSynced(id, cloudId, serverUpdatedAt),
    markFailed: async (id) => store.markFailed(id),
    markDeleted: async (id) => store.remove(id),
  });

  assert.equal(store.get(docId).serverUpdatedAt, "2026-10-20T15:27:11.123000Z");
});

test("a genuine conflict keeps the local copy and reports the server revision", async () => {
  const store = new FakeLocalStore([]);
  const docId = store.insert({
    title: "Passport",
    needsSync: true,
    syncStatus: "pending",
    cloudId: 42,
    serverUpdatedAt: CANONICAL,
  });

  const conflictError = Object.assign(new Error("conflict"), {
    response: {
      status: 409,
      data: {
        error: "This document was changed on another device since your last sync",
        conflict: true,
        serverUpdatedAt: "2026-10-21T09:00:00.500000Z",
      },
    },
  });

  const outcome = await syncDocumentToCloud(store.get(docId), {
    requestSync: async () => {
      throw conflictError;
    },
    deleteCloudDocument: async () => {},
    markSynced: async (id, cloudId, serverUpdatedAt) =>
      store.markSynced(id, cloudId, serverUpdatedAt),
    markFailed: async (id) => store.markFailed(id),
    markDeleted: async (id) => store.remove(id),
  });

  assert.equal(outcome.status, SYNC_OUTCOME.CONFLICT);
  assert.equal(outcome.permanent, true);
  assert.equal(outcome.serverUpdatedAt, "2026-10-21T09:00:00.500000Z");

  const row = store.get(docId);
  assert.ok(row, "the local document must survive the conflict");
  assert.equal(row.needsSync, 1, "it must stay queued for the user to resolve");
  assert.equal(row.syncStatus, "failed");
  assert.equal(
    row.serverUpdatedAt,
    CANONICAL,
    "the local revision must not be replaced by the server revision",
  );
});

test("the server revision of a conflict is read from the response body", () => {
  assert.equal(
    readConflictServerUpdatedAt({
      response: { data: { serverUpdatedAt: CANONICAL } },
    }),
    CANONICAL,
  );
  assert.equal(readConflictServerUpdatedAt({}), null);
  assert.equal(readConflictServerUpdatedAt(null), null);
});

test("the status the client sends is one the server accepts", () => {
  assert.equal(buildDocumentSyncPayload(localDocument({ status: "active" })).status, "active");
  assert.equal(
    buildDocumentSyncPayload(localDocument({ status: "verified" })).status,
    "verified",
  );
  assert.equal(
    buildDocumentSyncPayload(localDocument({ status: "expired" })).status,
    "expired",
  );
  assert.equal(
    buildDocumentSyncPayload(localDocument({ status: "deleted" })).status,
    "active",
    "a tombstone is never pushed as a document status",
  );
});
