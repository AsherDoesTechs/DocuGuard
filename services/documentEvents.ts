/**
 * Lightweight in-process event emitter used to notify screens that the
 * local document vault changed (created, updated, deleted) without forcing
 * every consumer to poll or refresh manually.
 *
 * This keeps deletes, edits and new scans visible instantly across the
 * dashboard, documents list and detail view even when the user never pulls
 * to refresh.
 */

type DocumentEvent =
  | { type: "document:created"; documentId: number }
  | { type: "document:updated"; documentId: number }
  | { type: "document:deleted"; documentId: number }
  | { type: "document:synced"; documentId: number };

type Listener = (event: DocumentEvent) => void;

const listeners = new Set<Listener>();

export const documentEvents = {
  /**
   * Subscribe to document changes. Returns an unsubscribe function.
   */
  subscribe: (listener: Listener): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  /**
   * Emit a document change to every subscriber.
   */
  emit: (event: DocumentEvent): void => {
    // Snapshot so a listener that unsubscribes mid-iteration cannot skip
    // the rest of the queue.
    const current = Array.from(listeners);
    for (const listener of current) {
      try {
        listener(event);
      } catch (err) {
        console.error("documentEvents listener error:", err);
      }
    }
  },
};

export type { DocumentEvent, Listener };