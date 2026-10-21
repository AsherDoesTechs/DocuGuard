"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createSyncRetryStore } = require("../shared/sync/syncRetryStore");
const { classifySyncFailure } = require("../shared/sync/syncPolicy");

/**
 * A key/value store that survives being handed to a second store instance,
 * which is how an app restart is simulated.
 */
function makeStorage(initial) {
  const values = new Map(Object.entries(initial || {}));

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

test("a failed attempt is remembered and the record is not due yet", async () => {
  const storage = makeStorage();
  const store = createSyncRetryStore(storage);

  const failure = classifySyncFailure({ isOffline: true });
  const state = await store.recordFailure(7, failure, 1000, { baseMs: 30_000 });

  assert.equal(state.attempts, 1);
  assert.equal(await store.isDue(7, 1000), false);
  assert.equal(await store.isDue(7, 40_000), true);
});

test("the retry state survives an app restart", async () => {
  const storage = makeStorage();
  const first = createSyncRetryStore(storage);

  await first.recordFailure(
    7,
    classifySyncFailure({ isOffline: true }),
    1000,
    { baseMs: 30_000 },
  );

  // A new instance over the same storage is what the next app launch sees.
  const second = createSyncRetryStore(storage);
  const state = await second.get(7);

  assert.ok(state, "the retry state must still be there after a restart");
  assert.equal(state.attempts, 1);
  assert.equal(await second.isDue(7, 1000), false);
});

test("a successful sync clears the retry state", async () => {
  const storage = makeStorage();
  const store = createSyncRetryStore(storage);

  await store.recordFailure(7, classifySyncFailure({ isOffline: true }), 1000);
  await store.clear(7);

  assert.equal(await store.get(7), null);
  assert.equal(await store.isDue(7, 1000), true);
});

test("a record that ran out of attempts asks for the user", async () => {
  const storage = makeStorage();
  const store = createSyncRetryStore(storage);

  const failure = classifySyncFailure({ isOffline: true });

  for (let attempt = 0; attempt < 5; attempt++) {
    await store.recordFailure(7, failure, 1000, { baseMs: 1 });
  }

  assert.equal(await store.needsUserAttention(7), true);
  assert.equal(await store.isDue(7, 10_000_000), false);
});

test("a permanent failure asks for the user straight away", async () => {
  const storage = makeStorage();
  const store = createSyncRetryStore(storage);

  await store.recordFailure(7, classifySyncFailure({ response: { status: 409 } }), 1000);

  assert.equal(await store.needsUserAttention(7), true);
});

test("the state of documents that no longer exist is dropped", async () => {
  const storage = makeStorage();
  const store = createSyncRetryStore(storage);

  await store.recordFailure(7, classifySyncFailure({ isOffline: true }), 1000);
  await store.recordFailure(8, classifySyncFailure({ isOffline: true }), 1000);

  await store.prune([8]);

  assert.equal(await store.get(7), null);
  assert.ok(await store.get(8));
});

test("a corrupt retry log does not break syncing", async () => {
  const storage = makeStorage({ "docuguard.sync.retry.v1": "{not json" });
  const store = createSyncRetryStore(storage);

  assert.equal(await store.get(7), null);
  assert.equal(await store.isDue(7, 1000), true);
});
