"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  syncDocumentToCloud,
  syncDeletedDocument,
  SYNC_OUTCOME,
} = require("../shared/sync/documentSyncCore");
const {
  classifySyncFailure,
  createSyncAttemptState,
  recordSyncFailure,
} = require("../shared/sync/syncPolicy");
const { FakeLocalStore } = require("./helpers/fakeLocalStore");

function makeDocument(overrides) {
  return {
    id: 1,
    title: "Passport",
    category: "identification",
    issuer: "DFA",
    documentNumber: "P123",
    issueDate: "2024-01-01",
    expiryDate: null,
    status: "active",
    enableAlerts: true,
    processingStatus: "completed",
    riskScore: null,
    riskLevel: null,
    fileUrl: null,
    s3Key: null,
    cloudId: null,
    serverUpdatedAt: null,
    ...overrides,
  };
}

function makeDeps(store, requestSync) {
  return {
    requestSync,
    deleteCloudDocument: async () => {},
    markSynced: async (docId, cloudId, serverUpdatedAt) => {
      store.markSynced(docId, cloudId, serverUpdatedAt);
    },
    markFailed: async (docId) => {
      store.markFailed(docId);
    },
    markDeleted: async (docId) => {
      store.remove(docId);
    },
  };
}

test("a successful sync clears the pending flag and records the cloud id", async () => {
  const store = new FakeLocalStore([]);
  const docId = store.insert(makeDocument());
  const doc = store.get(docId);

  const sent = [];
  const deps = makeDeps(store, async (payload) => {
    sent.push(payload);
    return { document: { id: 77, updatedAt: "2026-10-20T15:27:11.123456Z" } };
  });

  const outcome = await syncDocumentToCloud(doc, deps);

  assert.equal(outcome.status, SYNC_OUTCOME.SYNCED);
  assert.equal(outcome.cloudId, 77);

  const row = store.get(docId);
  assert.equal(row.needsSync, 0);
  assert.equal(row.syncStatus, "synced");
  assert.equal(row.cloudId, 77);
  assert.equal(row.serverUpdatedAt, "2026-10-20T15:27:11.123456Z");
  assert.equal(sent.length, 1);
});

test("the cloud succeeded but the local write failed: the record stays pending and is retried", async () => {
  const store = new FakeLocalStore([]);
  const docId = store.insert(makeDocument({ s3Key: "1/abc.pdf" }));
  const doc = store.get(docId);

  const sent = [];

  const deps = makeDeps(store, async (payload) => {
    sent.push(payload);
    return { document: { id: 77, updatedAt: "2026-10-20T15:27:11.123456Z" } };
  });

  // The local bookkeeping write fails, the way a full disk or a locked
  // database would make it fail.
  deps.markSynced = async () => {
    throw new Error("SQLITE_FULL: database or disk is full");
  };

  const outcome = await syncDocumentToCloud(doc, deps);

  assert.equal(outcome.status, SYNC_OUTCOME.FAILED);
  assert.equal(outcome.retryable, true);

  const row = store.get(docId);
  assert.equal(row.needsSync, 1, "the record must stay queued for a retry");
  assert.equal(row.syncStatus, "failed");
  assert.equal(row.cloudId, null);

  // The next attempt sends exactly the same payload, so the server resolves
  // the same row again instead of inserting a second document.
  const retry = await syncDocumentToCloud(row, deps);
  assert.equal(retry.status, SYNC_OUTCOME.FAILED);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0], sent[1]);
});

test("a network failure keeps the record queued and reports a retryable failure", async () => {
  const store = new FakeLocalStore([]);
  const docId = store.insert(makeDocument());
  const doc = store.get(docId);

  const offline = Object.assign(new Error("Network Error"), { isOffline: true });
  const deps = makeDeps(store, async () => {
    throw offline;
  });

  const outcome = await syncDocumentToCloud(doc, deps);

  assert.equal(outcome.status, SYNC_OUTCOME.FAILED);
  assert.equal(outcome.retryable, true);
  assert.equal(outcome.permanent, false);

  const row = store.get(docId);
  assert.equal(row.needsSync, 1);
  assert.equal(row.syncStatus, "failed");
});

test("a network failure followed by a successful retry clears the pending flag", async () => {
  const store = new FakeLocalStore([]);
  const docId = store.insert(makeDocument());
  const doc = store.get(docId);

  let attempt = 0;
  const deps = makeDeps(store, async () => {
    attempt += 1;

    if (attempt === 1) {
      throw Object.assign(new Error("Network Error"), { isOffline: true });
    }

    return { document: { id: 5, updatedAt: "2026-10-20T15:27:11.123456Z" } };
  });

  const first = await syncDocumentToCloud(doc, deps);
  assert.equal(first.status, SYNC_OUTCOME.FAILED);
  assert.equal(store.get(docId).needsSync, 1);

  const second = await syncDocumentToCloud(store.get(docId), deps);
  assert.equal(second.status, SYNC_OUTCOME.SYNCED);
  assert.equal(store.get(docId).needsSync, 0);
  assert.equal(store.get(docId).syncStatus, "synced");
  assert.equal(store.get(docId).cloudId, 5);
});

test("repeated retries send the same payload, so the server cannot create a duplicate", async () => {
  const store = new FakeLocalStore([]);
  const docId = store.insert(makeDocument({ s3Key: "1/abc.pdf" }));
  const doc = store.get(docId);

  const sent = [];
  const deps = makeDeps(store, async (payload) => {
    sent.push(payload);
    return { document: { id: 77, updatedAt: "2026-10-20T15:27:11.123456Z" } };
  });

  for (let attempt = 0; attempt < 5; attempt++) {
    const outcome = await syncDocumentToCloud(store.get(docId), deps);
    assert.equal(outcome.status, SYNC_OUTCOME.SYNCED);
  }

  assert.equal(sent.length, 5);

  for (const payload of sent) {
    // The storage key is the idempotency key the server falls back to.
    assert.equal(payload.s3Key, "1/abc.pdf");
  }

  // From the second attempt on the payload names the server row, so the
  // server updates it instead of inserting another one.
  assert.equal(sent[0].cloudId, undefined);
  for (const payload of sent.slice(1)) {
    assert.equal(payload.cloudId, 77);
  }

  assert.equal(store.all().length, 1, "only one local row may exist");
});

test("a conflict is reported as permanent and never clears the pending flag", async () => {
  const store = new FakeLocalStore([]);
  const docId = store.insert(makeDocument());
  const doc = store.get(docId);

  const deps = makeDeps(store, async () => {
    throw Object.assign(new Error("Conflict"), { response: { status: 409 } });
  });

  const outcome = await syncDocumentToCloud(doc, deps);

  // A 409 is a conflict whether the server signals it with a status code or
  // in the response body. Both paths keep the local copy and stay queued.
  assert.equal(outcome.status, SYNC_OUTCOME.CONFLICT);
  assert.equal(outcome.permanent, true);
  assert.equal(outcome.retryable, false);
  assert.equal(store.get(docId).needsSync, 1);
});

test("the server can report a conflict in the response body", async () => {
  const store = new FakeLocalStore([]);
  const docId = store.insert(makeDocument());
  const doc = store.get(docId);

  const deps = makeDeps(store, async () => ({
    conflict: true,
    error: "This document was changed on another device",
  }));

  const outcome = await syncDocumentToCloud(doc, deps);

  assert.equal(outcome.status, SYNC_OUTCOME.CONFLICT);
  assert.equal(outcome.permanent, true);
  assert.equal(store.get(docId).needsSync, 1);
});

test("the pending flag is cleared only after the remote operation succeeded", async () => {
  const store = new FakeLocalStore([]);
  const docId = store.insert(makeDocument());
  const doc = store.get(docId);

  const order = [];
  const deps = makeDeps(store, async () => {
    order.push("remote");
    return { document: { id: 9, updatedAt: "2026-10-20T15:27:11.123456Z" } };
  });

  deps.markSynced = async (id, cloudId, revision) => {
    order.push("local");
    store.markSynced(id, cloudId, revision);
  };

  await syncDocumentToCloud(doc, deps);

  assert.deepEqual(order, ["remote", "local"]);
});

test("a deleted document is removed locally only after the server copy is gone", async () => {
  const store = new FakeLocalStore([]);
  const docId = store.insert(makeDocument({ cloudId: 12 }));
  const doc = store.get(docId);

  const deleted = [];
  const deps = makeDeps(store, async () => ({}));
  deps.deleteCloudDocument = async (cloudId) => {
    deleted.push(cloudId);
  };

  const outcome = await syncDeletedDocument(doc, deps);

  assert.equal(outcome.status, SYNC_OUTCOME.DELETED);
  assert.deepEqual(deleted, [12]);
  assert.equal(store.get(docId), null);
});

test("a failed delete keeps the tombstone queued", async () => {
  const store = new FakeLocalStore([]);
  const docId = store.insert(makeDocument({ cloudId: 12 }));
  const doc = store.get(docId);

  const deps = makeDeps(store, async () => ({}));
  deps.deleteCloudDocument = async () => {
    throw Object.assign(new Error("Network Error"), { isOffline: true });
  };

  const outcome = await syncDeletedDocument(doc, deps);

  assert.equal(outcome.status, SYNC_OUTCOME.FAILED);
  assert.equal(store.get(docId).needsSync, 1);
});

test("a failure that could not be recorded locally does not abort the sync", async () => {
  const store = new FakeLocalStore([]);
  const docId = store.insert(makeDocument());
  const doc = store.get(docId);

  const deps = makeDeps(store, async () => {
    throw Object.assign(new Error("Network Error"), { isOffline: true });
  });

  deps.markFailed = async () => {
    throw new Error("local write failed too");
  };

  const outcome = await syncDocumentToCloud(doc, deps);

  assert.equal(outcome.status, SYNC_OUTCOME.FAILED);
  assert.equal(outcome.retryable, true);
});

test("the failure of an attempt is folded into the retry state", () => {
  const failure = classifySyncFailure({ isOffline: true });
  const state = recordSyncFailure(createSyncAttemptState(), failure, 1000, {
    baseMs: 30_000,
  });

  assert.equal(state.attempts, 1);
  assert.equal(state.lastStatus, "offline");
  assert.equal(state.nextAttemptAt, 31_000);
});
