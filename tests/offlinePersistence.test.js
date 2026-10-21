"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { saveNewDocument } = require("../shared/sync/documentSaveCore");
const {
  syncDocumentToCloud,
  SYNC_OUTCOME,
} = require("../shared/sync/documentSyncCore");
const { createSyncRetryStore } = require("../shared/sync/syncRetryStore");
const { classifySyncFailure } = require("../shared/sync/syncPolicy");
const { FakeLocalStore } = require("./helpers/fakeLocalStore");

function makeStorage() {
  const values = new Map();

  return {
    values,
    async getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    async setItem(key, value) {
      values.set(key, value);
    },
    async removeItem(key) {
      values.delete(key);
    },
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

test("a document saved while offline stays on the device and stays queued", async () => {
  const store = new FakeLocalStore([]);
  const retryStore = createSyncRetryStore(makeStorage());

  const result = await saveNewDocument(
    {
      title: "Passport",
      category: "identification",
      issuer: "DFA",
      documentNumber: "P123",
      issueDate: "2024-01-01",
      expiryDate: null,
      status: "active",
      enableAlerts: true,
      processingStatus: "completed",
      fileUrl: "file:///data/user/0/local.pdf",
      needsSync: true,
      syncStatus: "pending",
    },
    {
      createLocal: async (payload) => store.insert(payload),
      logAction: async () => {},
      scheduleReminders: async () => {},
    },
  );

  assert.equal(result.savedLocally, true);

  const row = store.get(result.localId);
  assert.equal(row.needsSync, 1);
  assert.equal(row.syncStatus, "pending");
  assert.equal(row.fileUrl, "file:///data/user/0/local.pdf");
});

test("a failed sync never removes the local document", async () => {
  const store = new FakeLocalStore([]);
  const docId = store.insert({
    title: "Passport",
    needsSync: true,
    syncStatus: "pending",
  });
  const doc = store.get(docId);

  const deps = makeDeps(store, async () => {
    throw Object.assign(new Error("Network Error"), { isOffline: true });
  });

  const outcome = await syncDocumentToCloud(doc, deps);

  assert.equal(outcome.status, SYNC_OUTCOME.FAILED);
  assert.equal(store.all().length, 1, "the document must still be on the device");
  assert.equal(store.get(docId).needsSync, 1);
  assert.equal(store.get(docId).syncStatus, "failed");
});

test("the queued document and its retry state survive an app restart", async () => {
  const storage = makeStorage();
  const store = new FakeLocalStore([]);
  const retryStore = createSyncRetryStore(storage);

  const docId = store.insert({
    title: "Passport",
    needsSync: true,
    syncStatus: "pending",
  });

  const deps = makeDeps(store, async () => {
    throw Object.assign(new Error("Network Error"), { isOffline: true });
  });

  const failure = classifySyncFailure({ isOffline: true });
  const outcome = await syncDocumentToCloud(store.get(docId), deps);
  await retryStore.recordFailure(docId, outcome.failure || failure, 1000);

  // The app is closed and opened again.
  const restartedStore = new FakeLocalStore(store.all());
  const restartedRetryStore = createSyncRetryStore(storage);

  const row = restartedStore.get(docId);
  assert.ok(row, "the document must survive the restart");
  assert.equal(row.needsSync, 1, "it must still be queued for a retry");
  assert.equal(row.title, "Passport");

  const state = await restartedRetryStore.get(docId);
  assert.ok(state, "the retry state must survive the restart");
  assert.equal(state.attempts, 1);
});

test("a document that is queued is pushed once the network is back", async () => {
  const storage = makeStorage();
  const store = new FakeLocalStore([]);
  const retryStore = createSyncRetryStore(storage);

  const docId = store.insert({
    title: "Passport",
    needsSync: true,
    syncStatus: "pending",
  });

  let online = false;

  const deps = makeDeps(store, async () => {
    if (!online) {
      throw Object.assign(new Error("Network Error"), { isOffline: true });
    }

    return { document: { id: 31, updatedAt: "2026-10-20T15:27:11.123456Z" } };
  });

  const failure = await syncDocumentToCloud(store.get(docId), deps);
  await retryStore.recordFailure(docId, failure.failure, 1000, { baseMs: 0 });

  // The backoff has elapsed and the network is back.
  online = true;

  const outcome = await syncDocumentToCloud(store.get(docId), deps);
  assert.equal(outcome.status, SYNC_OUTCOME.SYNCED);

  await retryStore.clear(docId);

  const row = store.get(docId);
  assert.equal(row.needsSync, 0);
  assert.equal(row.syncStatus, "synced");
  assert.equal(row.cloudId, 31);
  assert.equal(await retryStore.get(docId), null);
});
