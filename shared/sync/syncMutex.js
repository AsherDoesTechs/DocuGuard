"use strict";

/**
 * A process-wide lock around the sync pass.
 *
 * The background worker and the manual "Sync now" button both push the same
 * queue to the same server. When they ran at the same time, both read the same
 * `needs_sync = 1` row and both resolved it to "no server row yet", so both
 * inserted one: the same document existed twice on the server.
 *
 * The lock serialises the passes instead. A pass that arrives while another
 * one is running waits for it, and then runs itself - nothing is dropped, and
 * no two passes ever touch the same queue at the same time.
 *
 * The lock is per process. It is deliberately not persisted: it protects
 * against two passes racing inside one app instance, which is the case that
 * actually happens.
 */
function createSyncMutex() {
  let tail = Promise.resolve();
  let running = 0;
  let waiting = 0;

  return {
    /**
     * Runs `fn` once every previously requested run has finished.
     *
     * @template T
     * @param {() => Promise<T>} fn
     * @returns {Promise<T>}
     */
    async run(fn) {
      waiting++;

      const previous = tail;
      let release;
      tail = new Promise((resolve) => {
        release = resolve;
      });

      await previous;
      waiting--;
      running++;

      try {
        return await fn();
      } finally {
        running--;
        release();
      }
    },

    /** True while a run is in progress. */
    isLocked() {
      return running > 0;
    },

    /** Number of runs that are waiting for the current one. */
    pendingCount() {
      return waiting;
    },
  };
}

module.exports = {
  createSyncMutex,
};
