"use strict";

/**
 * The rules of the background sync worker and the lock around the sync pass.
 *
 * The worker used to overwrite the scope of a pending request with the scope
 * of a newer one, and the manual "Sync now" button called the sync function
 * directly, so a background pass and a manual pass could push the same
 * document at the same time and create it twice on the server.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { createSyncMutex } = require("../shared/sync/syncMutex");
const {
  mergeSyncRequest,
  scopeToSyncOptions,
  hasWork,
  computeNextDelayMs,
} = require("../shared/sync/syncWorkerCore");
const { createSyncRetryStore } = require("../shared/sync/syncRetryStore");
const { classifySyncFailure, SYNC_FAILURE_KIND } = require("../shared/sync/syncPolicy");

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

test("two sync passes never run at the same time", async () => {
  const mutex = createSyncMutex();
  const events = [];

  const first = mutex.run(async () => {
    events.push("first:start");
    await new Promise((resolve) => setTimeout(resolve, 20));
    events.push("first:end");
    return "first";
  });

  const second = mutex.run(async () => {
    events.push("second:start");
    events.push("second:end");
    return "second";
  });

  const results = await Promise.all([first, second]);

  assert.deepEqual(results, ["first", "second"]);
  assert.deepEqual(events, [
    "first:start",
    "first:end",
    "second:start",
    "second:end",
  ]);
});

test("a pass that waits for the lock still runs", async () => {
  const mutex = createSyncMutex();
  let runs = 0;

  await Promise.all([
    mutex.run(async () => {
      runs++;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }),
    mutex.run(async () => {
      runs++;
    }),
    mutex.run(async () => {
      runs++;
    }),
  ]);

  assert.equal(runs, 3, "no request may be dropped");
});

test("a failing pass releases the lock", async () => {
  const mutex = createSyncMutex();

  await assert.rejects(() =>
    mutex.run(async () => {
      throw new Error("boom");
    }),
  );

  assert.equal(mutex.isLocked(), false);
  assert.equal(await mutex.run(async () => "ok"), "ok");
});

test("a request does not overwrite the scope of a pending request", () => {
  const first = mergeSyncRequest(null, { force: false, documentIds: [5] });
  const second = mergeSyncRequest(first, { force: false, documentIds: [7] });

  assert.deepEqual(second.documentIds, [5, 7]);
  assert.equal(second.force, false);
});

test("an unscoped request covers everything", () => {
  const scoped = mergeSyncRequest(null, { force: false, documentIds: [5] });
  const unscoped = mergeSyncRequest(scoped, { force: false, documentIds: null });

  assert.equal(unscoped.documentIds, null);

  const options = scopeToSyncOptions(unscoped);
  assert.equal(options.onlyDocumentIds, undefined);
});

test("a forced request stays forced", () => {
  const forced = mergeSyncRequest(null, { force: true, documentIds: [5] });
  const later = mergeSyncRequest(forced, { force: false, documentIds: [7] });

  assert.equal(later.force, true);
});

test("invalid document ids are dropped from a scope", () => {
  const merged = mergeSyncRequest(null, {
    force: false,
    documentIds: [5, 0, -1, 1.5, Number.NaN],
  });

  assert.deepEqual(merged.documentIds, [5]);
});

test("the scope becomes the options of a sync pass", () => {
  const scope = mergeSyncRequest(null, { force: true, documentIds: [5, 7] });

  assert.deepEqual(scopeToSyncOptions(scope), {
    force: true,
    onlyDocumentIds: [5, 7],
  });
});

test("a pass only runs when there is something to do", () => {
  assert.equal(hasWork({ pendingDocuments: 0, pendingReminders: 0 }), false);
  assert.equal(hasWork({ pendingDocuments: 1, pendingReminders: 0 }), true);
  assert.equal(hasWork({ pendingDocuments: 0, pendingReminders: 2 }), true);
});

test("the delay before the next pass respects the minimum interval", () => {
  const minIntervalMs = 60 * 1000;

  assert.equal(computeNextDelayMs({ elapsedMs: 0, minIntervalMs }), 60 * 1000);
  assert.equal(
    computeNextDelayMs({ elapsedMs: 30 * 1000, minIntervalMs }),
    30 * 1000,
  );
  assert.equal(
    computeNextDelayMs({ elapsedMs: 90 * 1000, minIntervalMs }),
    0,
    "an elapsed interval means the pass may run now",
  );
  assert.equal(
    computeNextDelayMs({ elapsedMs: 0, force: true, minIntervalMs }),
    0,
    "a forced request runs immediately",
  );
});

test("an authentication failure parks the record", async () => {
  const store = createSyncRetryStore(makeStorage());

  const failure = classifySyncFailure({ response: { status: 401 } });

  assert.equal(failure.kind, SYNC_FAILURE_KIND.AUTH);
  assert.equal(failure.permanent, true);

  await store.recordFailure(7, failure, Date.now());

  const state = await store.get(7);
  assert.equal(state.permanent, true);
  assert.equal(state.lastStatus, SYNC_FAILURE_KIND.AUTH);
});

test("signing in again releases the records that were blocked by the session", async () => {
  const storage = makeStorage();
  const store = createSyncRetryStore(storage);

  const authFailure = classifySyncFailure({ response: { status: 401 } });
  const serverFailure = classifySyncFailure({ response: { status: 500 } });

  await store.recordFailure(7, authFailure, Date.now());
  await store.recordFailure(8, serverFailure, Date.now());

  const changed = await store.clearBlockedBy({ kind: SYNC_FAILURE_KIND.AUTH });

  assert.equal(changed, true);
  assert.equal(await store.get(7), null, "the blocked record is retryable again");

  const kept = await store.get(8);
  assert.ok(kept, "the backoff of a reachable failure is kept");
  assert.equal(kept.attempts, 1);
  assert.equal(kept.lastStatus, SYNC_FAILURE_KIND.SERVER);
});

test("a record that was never blocked is left alone", async () => {
  const store = createSyncRetryStore(makeStorage());

  const serverFailure = classifySyncFailure({ response: { status: 500 } });
  await store.recordFailure(8, serverFailure, Date.now());

  const changed = await store.clearBlockedBy({ kind: SYNC_FAILURE_KIND.AUTH });

  assert.equal(changed, false);
  assert.ok(await store.get(8));
});
