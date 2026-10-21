"use strict";

/**
 * Regression tests for the PostgreSQL id contract.
 *
 * `documents.id` and `reminders.id` are `BIGSERIAL`, and node-postgres parses
 * `int8` with `parseBigInteger`, which keeps the value as text. Every server
 * response therefore carries `"42"` where the client expected `42`.
 *
 * The client compared those ids with `typeof id === "number"`, so a valid id
 * was treated as "no id": `cloud_id` was never persisted, the compensating
 * delete after a failed local insert never ran, deleted documents were not
 * tombstoned, and every reminder retry inserted a second server row.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { normalizeCloudId, hasCloudId } = require("../shared/sync/cloudId");
const { readCloudId, readServerUpdatedAt } = require("../shared/sync/documentSyncCore");
const { saveNewDocument } = require("../shared/sync/documentSaveCore");
const { FakeLocalStore } = require("./helpers/fakeLocalStore");

test("a PostgreSQL BIGSERIAL id arrives as a string and is still a usable id", () => {
  assert.equal(normalizeCloudId("42"), 42);
  assert.equal(normalizeCloudId(" 42 "), 42);
  assert.equal(normalizeCloudId(42), 42);
  assert.equal(hasCloudId("42"), true);
});

test("ids that are not positive integers are rejected", () => {
  for (const value of [
    null,
    undefined,
    "",
    "   ",
    "abc",
    "42abc",
    "-1",
    "0",
    "4.2",
    "4e2",
    0,
    -1,
    4.2,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    "9007199254740993", // beyond Number.MAX_SAFE_INTEGER
    {},
    [],
    true,
  ]) {
    assert.equal(
      normalizeCloudId(value),
      null,
      `${JSON.stringify(value)} must not be accepted as an id`,
    );
  }
});

test("readCloudId accepts the string id the server actually returns", () => {
  assert.equal(readCloudId({ document: { id: "42" } }), 42);
  assert.equal(readCloudId({ id: "42" }), 42);
  assert.equal(readCloudId({ document: { id: 42 } }), 42);
  assert.equal(readCloudId({ document: { id: "not-an-id" } }), null);
  assert.equal(readCloudId({}), null);
  assert.equal(readCloudId(null), null);
});

test("a successful sync stores the string id as a number", async () => {
  const store = new FakeLocalStore([]);

  const docId = store.insert({
    title: "Passport",
    needsSync: true,
    syncStatus: "pending",
  });

  const outcome = await require("../shared/sync/documentSyncCore").syncDocumentToCloud(
    store.get(docId),
    {
      requestSync: async () => ({
        document: { id: "77", updatedAt: "2026-10-20T15:27:11.123456Z" },
      }),
      deleteCloudDraft: async () => {},
      markSynced: async (id, cloudId, serverUpdatedAt) =>
        store.markSynced(id, cloudId, serverUpdatedAt),
      markFailed: async (id) => store.markFailed(id),
      markDeleted: async (id) => store.remove(id),
    },
  );

  assert.equal(outcome.status, "synced");
  assert.equal(store.get(docId).cloudId, 77);
  assert.equal(typeof store.get(docId).cloudId, "number");
  assert.equal(
    store.get(docId).serverUpdatedAt,
    "2026-10-20T15:27:11.123456Z",
  );
});

test("a failed local insert compensates the draft the scan created", async () => {
  const deleted = [];

  await assert.rejects(
    () =>
      saveNewDocument(
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
          fileUrl: "https://example.test/signed.pdf",
          s3Key: "1/abc.jpg",
          needsSync: true,
          syncStatus: "pending",
          // The draft id as the server sends it: a string.
          cloudId: "512",
        },
        {
          createLocal: async () => {
            throw new Error("disk full");
          },
          logAction: async () => {},
          scheduleReminders: async () => {},
          deleteCloudDraft: async (cloudId) => {
            deleted.push(cloudId);
          },
        },
      ),
    (error) => {
      assert.equal(error.name, "DocumentSaveError");
      assert.equal(error.stage, "localInsert");
      assert.equal(error.cloudId, 512);
      assert.equal(error.compensated, true);
      return true;
    },
  );

  assert.deepEqual(deleted, [512], "the exact draft of this save is deleted");
});

test("a failed local insert does not delete anything when the draft id is unusable", async () => {
  const deleted = [];

  await assert.rejects(
    () =>
      saveNewDocument(
        {
          title: "Passport",
          documentNumber: "P123",
          // A malformed id must never be turned into a delete request.
          cloudId: "not-an-id",
        },
        {
          createLocal: async () => {
            throw new Error("disk full");
          },
          logAction: async () => {},
          scheduleReminders: async () => {},
          deleteCloudDraft: async (cloudId) => {
            deleted.push(cloudId);
          },
        },
      ),
    (error) => {
      assert.equal(error.compensated, false);
      assert.equal(error.cloudId, null);
      return true;
    },
  );

  assert.deepEqual(deleted, [], "no unrelated row may be deleted");
});

test("the server revision is read independently of the id", () => {
  assert.equal(
    readServerUpdatedAt({
      document: { id: "42", updatedAt: "2026-10-20T15:27:11.123456Z" },
    }),
    "2026-10-20T15:27:11.123456Z",
  );
  assert.equal(readServerUpdatedAt({ document: { id: "42" } }), null);
});
