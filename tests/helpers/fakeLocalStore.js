"use strict";

/**
 * An in-memory stand-in for the local document table.
 *
 * It implements the same rules the real SQLite statements implement, so the
 * sync contract can be asserted without an emulator:
 *
 *   - `needs_sync` is 1 until a sync succeeds.
 *   - `sync_status` is "pending" | "failed" | "synced" | "local".
 *   - A tombstone is a row with status "deleted"; the row itself is only
 *     removed once the server copy is gone.
 *
 * The store can be handed to a second "app instance" to simulate a restart.
 */

class FakeLocalStore {
  constructor(rows) {
    this.rows = new Map();
    this.failNextWrite = null;

    for (const row of rows || []) {
      this.rows.set(row.id, { ...row });
    }

    this.nextId =
      Math.max(0, ...Array.from(this.rows.keys()).map((id) => Number(id))) + 1;
  }

  insert(row) {
    if (this.failNextWrite) {
      const error = this.failNextWrite;
      this.failNextWrite = null;
      throw error;
    }

    const id = this.nextId++;
    const stored = {
      id,
      title: row.title,
      category: row.category,
      issuer: row.issuer,
      documentNumber: row.documentNumber,
      issueDate: row.issueDate ?? null,
      expiryDate: row.expiryDate ?? null,
      notes: row.notes ?? "",
      status: row.status ?? "active",
      enableAlerts: row.enableAlerts ?? true,
      processingStatus: row.processingStatus ?? "completed",
      riskScore: row.riskScore ?? null,
      riskLevel: row.riskLevel ?? null,
      fileUrl: row.fileUrl ?? null,
      fileType: row.fileType ?? null,
      s3Key: row.s3Key ?? null,
      cloudId: row.cloudId ?? null,
      serverUpdatedAt: row.serverUpdatedAt ?? null,
      needsSync: row.needsSync === false ? 0 : 1,
      syncStatus: row.syncStatus ?? "pending",
    };

    this.rows.set(id, stored);
    return id;
  }

  get(id) {
    return this.rows.get(id) || null;
  }

  all() {
    return Array.from(this.rows.values());
  }

  /** Mirrors `markDocumentSyncedWithCloud`. */
  markSynced(id, cloudId, serverUpdatedAt) {
    const row = this.rows.get(id);
    if (!row) return;

    if (cloudId !== null && cloudId !== undefined) {
      row.cloudId = cloudId;
    }

    if (serverUpdatedAt !== null && serverUpdatedAt !== undefined) {
      row.serverUpdatedAt = serverUpdatedAt;
    }

    row.needsSync = 0;
    row.syncStatus = "synced";
  }

  /** Mirrors `updateDocumentSyncStatus`. */
  markFailed(id) {
    const row = this.rows.get(id);
    if (!row) return;

    row.syncStatus = "failed";
    row.needsSync = 1;
  }

  remove(id) {
    this.rows.delete(id);
  }
}

module.exports = { FakeLocalStore };
