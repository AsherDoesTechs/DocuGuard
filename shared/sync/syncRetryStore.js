"use strict";

/**
 * Durable retry bookkeeping for documents that are waiting to sync.
 *
 * The retry state lives outside the SQLite schema on purpose. Adding attempt
 * counters to the `documents` table would mean a migration on every install,
 * and the state is not part of the user's document data: it is bookkeeping
 * about the network. Keeping it in a small key/value store means it survives
 * an app restart, which is exactly what a retry needs, and it can be dropped
 * without touching the vault.
 *
 * The storage backend is injected so the behaviour can be exercised without a
 * device.
 */

const {
  createSyncAttemptState,
  recordSyncFailure,
  isSyncAttemptDue,
  requiresUserAttention,
  SYNC_FAILURE_KIND,
} = require("./syncPolicy");

const RETRY_STATE_KEY = "docuguard.sync.retry.v1";

/**
 * @param {{ getItem: (key: string) => Promise<string|null>,
 *           setItem: (key: string, value: string) => Promise<void>,
 *           removeItem?: (key: string) => Promise<void> }} storage
 */
function createSyncRetryStore(storage, options) {
  const key = (options && options.key) || RETRY_STATE_KEY;

  let cache = null;
  let pending = null;

  async function readAll() {
    if (cache) {
      return cache;
    }

    if (!pending) {
      pending = (async () => {
        try {
          const raw = await storage.getItem(key);
          const parsed = raw ? JSON.parse(raw) : {};
          cache = parsed && typeof parsed === "object" ? parsed : {};
        } catch (error) {
          // A corrupt or unreadable retry log must never block syncing.
          cache = {};
        }
        return cache;
      })().finally(() => {
        pending = null;
      });
    }

    return pending;
  }

  async function writeAll(state) {
    cache = state;
    await storage.setItem(key, JSON.stringify(state));
  }

  return {
    key,

    async get(documentId) {
      const state = await readAll();
      const entry = state[String(documentId)];
      return entry || null;
    },

    async getAll() {
      const state = await readAll();
      return { ...state };
    },

    async isDue(documentId, now) {
      const entry = await this.get(documentId);
      return isSyncAttemptDue(entry, now);
    },

    async needsUserAttention(documentId) {
      const entry = await this.get(documentId);
      return requiresUserAttention(entry);
    },

    /**
     * Folds a failed attempt into the stored state and returns the new state.
     */
    async recordFailure(documentId, failure, now, backoffOptions) {
      const state = await readAll();
      const previous = state[String(documentId)] || createSyncAttemptState();
      const next = recordSyncFailure(previous, failure, now, backoffOptions);

      await writeAll({ ...state, [String(documentId)]: next });

      return next;
    },

    /**
     * Clears the retry state after a successful sync.
     */
    async clear(documentId) {
      const state = await readAll();

      if (!(String(documentId) in state)) {
        return;
      }

      const next = { ...state };
      delete next[String(documentId)];

      await writeAll(next);
    },

    /**
     * Drops the state of records that no longer exist, so the log cannot grow
     * without bound.
     *
     * The log holds two kinds of keys: the id of a document, and the id of a
     * reminder behind the `reminder:` prefix. The two have separate id
     * sequences, so the same number can belong to a document and to a
     * reminder.
     *
     * The reminder ids are optional. Without them the reminder entries are
     * left alone: they are not the records the caller asked about, and
     * dropping them would throw away the backoff of a reminder that is still
     * waiting to be pushed.
     *
     * @param {Array<number|string>} validIds
     * @param {Array<number|string>} [validReminderIds]
     */
    async prune(validIds, validReminderIds) {
      const state = await readAll();
      const valid = new Set(validIds.map((id) => String(id)));
      const remindersKnown = Array.isArray(validReminderIds);
      const validReminders = new Set(
        (validReminderIds || []).map((id) => `reminder:${id}`),
      );
      let changed = false;
      const next = {};

      for (const [key, value] of Object.entries(state)) {
        if (key.startsWith("reminder:")) {
          if (!remindersKnown || validReminders.has(key)) {
            next[key] = value;
          } else {
            changed = true;
          }

          continue;
        }

        if (valid.has(key)) {
          next[key] = value;
        } else {
          changed = true;
        }
      }

      if (changed) {
        await writeAll(next);
      }
    },

    /**
     * Drops the state of the records that were blocked by an authentication
     * failure.
     *
     * A 401 or a 403 is permanent in the sense that the same request cannot
     * succeed until the session is valid again. Parking the record is right,
     * but parking it forever is not: after the user signs in again the record
     * has to become eligible for a retry.
     *
     * Only the authentication failures are dropped. The backoff and the
     * attempt count of every other record are kept, because they describe
     * real attempts against a server that was reachable.
     *
     * @param {{ kind?: string }} [options]
     */
    async clearBlockedBy(options) {
      const kind =
        options && typeof options.kind === "string"
          ? options.kind
          : SYNC_FAILURE_KIND.AUTH;

      const state = await readAll();
      const next = {};
      let changed = false;

      for (const [key, value] of Object.entries(state)) {
        if (value && value.lastStatus === kind) {
          changed = true;
          continue;
        }

        next[key] = value;
      }

      if (changed) {
        await writeAll(next);
      }

      return changed;
    },

    /** Drops everything. Used when the account changes. */
    async clearAll() {
      cache = {};

      if (typeof storage.removeItem === "function") {
        await storage.removeItem(key);
        return;
      }

      await storage.setItem(key, "{}");
    },
  };
}

module.exports = {
  RETRY_STATE_KEY,
  createSyncRetryStore,
};
