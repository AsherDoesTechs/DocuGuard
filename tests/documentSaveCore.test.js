"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { saveNewDocument } = require("../shared/sync/documentSaveCore");
const { FakeLocalStore } = require("./helpers/fakeLocalStore");

function makeDeps(overrides) {
  return {
    createLocal: async () => 1,
    logAction: async () => {},
    scheduleReminders: async () => {},
    deleteCloudDraft: async () => {},
    requestSync: async () => true,
    ...overrides,
  };
}

test("a saved document is reported as saved even when the history entry fails", async () => {
  const store = new FakeLocalStore([]);
  const deps = makeDeps({
    createLocal: async (payload) => store.insert(payload),
    logAction: async () => {
      throw new Error("history table is locked");
    },
  });

  const result = await saveNewDocument({ title: "Passport" }, deps);

  assert.equal(result.savedLocally, true);
  assert.equal(result.localId, 1);
  assert.equal(result.warnings.length, 1);
  assert.equal(store.all().length, 1);
});

test("a saved document is reported as saved even when the reminders fail", async () => {
  const store = new FakeLocalStore([]);
  const deps = makeDeps({
    createLocal: async (payload) => store.insert(payload),
    scheduleReminders: async () => {
      throw new Error("notification service unavailable");
    },
  });

  const result = await saveNewDocument({ title: "Passport" }, deps);

  assert.equal(result.savedLocally, true);
  assert.equal(result.warnings.length, 1);
  assert.equal(store.all().length, 1);
});

test("a failed local insert removes the cloud draft that was created for it", async () => {
  const deleted = [];
  const deps = makeDeps({
    createLocal: async () => {
      throw new Error("SQLITE_FULL: database or disk is full");
    },
    deleteCloudDraft: async (cloudId) => {
      deleted.push(cloudId);
    },
  });

  await assert.rejects(
    () => saveNewDocument({ title: "Passport", cloudId: 42 }, deps),
    (error) => {
      assert.equal(error.name, "DocumentSaveError");
      assert.equal(error.stage, "localInsert");
      assert.equal(error.cloudId, 42);
      assert.equal(error.compensated, true);
      return true;
    },
  );

  assert.deepEqual(deleted, [42], "the orphaned cloud draft must be removed");
});

test("a failed local insert is reported when the cloud draft could not be removed", async () => {
  const deps = makeDeps({
    createLocal: async () => {
      throw new Error("SQLITE_FULL: database or disk is full");
    },
    deleteCloudDraft: async () => {
      throw new Error("offline");
    },
  });

  await assert.rejects(
    () => saveNewDocument({ title: "Passport", cloudId: 42 }, deps),
    (error) => {
      assert.equal(error.compensated, false);
      assert.equal(error.cloudId, 42);
      return true;
    },
  );
});

test("a document without a cloud draft is not compensated", async () => {
  const deleted = [];
  const deps = makeDeps({
    createLocal: async () => {
      throw new Error("local insert failed");
    },
    deleteCloudDraft: async (cloudId) => {
      deleted.push(cloudId);
    },
  });

  await assert.rejects(() => saveNewDocument({ title: "Passport" }, deps));

  assert.deepEqual(deleted, []);
});

test("saving the same document twice is only possible if the caller asks for it", async () => {
  const store = new FakeLocalStore([]);
  let attempts = 0;

  const deps = makeDeps({
    createLocal: async (payload) => {
      attempts += 1;

      // The first attempt fails after the user already pressed save.
      if (attempts === 1) {
        throw new Error("transient failure");
      }

      return store.insert(payload);
    },
  });

  await assert.rejects(() => saveNewDocument({ title: "Passport" }, deps));

  const result = await saveNewDocument({ title: "Passport" }, deps);

  assert.equal(result.savedLocally, true);
  assert.equal(store.all().length, 1, "a retry after a failed save adds one row");
});

test("the cloud id of the draft is kept on the saved document", async () => {
  const store = new FakeLocalStore([]);
  const deps = makeDeps({
    createLocal: async (payload) => store.insert(payload),
  });

  const result = await saveNewDocument(
    { title: "Passport", cloudId: 42, s3Key: "1/abc.pdf" },
    deps,
  );

  assert.equal(result.cloudId, 42);
  assert.equal(store.get(result.localId).cloudId, 42);
  assert.equal(store.get(result.localId).s3Key, "1/abc.pdf");
});
