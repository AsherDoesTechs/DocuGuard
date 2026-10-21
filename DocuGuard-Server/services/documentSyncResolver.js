"use strict";

/**
 * Decides which server row a sync payload belongs to.
 *
 * The sync endpoint used to look the target up by document number only. Two
 * consequences followed from that:
 *
 *   - A retry that had lost the server id could insert a second row for the
 *     same document, because the number was not unique.
 *   - The first push of a scanned document never matched its own OCR draft,
 *     because a draft has no document number yet, so the account ended up
 *     with the draft *and* the finished document.
 *
 * The lookup is therefore ordered from the most specific key to the least:
 *
 *   1. `cloudId`   - the exact row this device already owns.
 *   2. `s3Key`     - the storage object this upload produced. Server generated
 *                    and unique per upload, so it identifies the same physical
 *                    document even when the client lost the row id.
 *   3. document number - the last resort, and only when the title still
 *                    matches, so two different documents that share a number
 *                    are reported as a conflict instead of being merged.
 *
 * The function is deliberately free of any HTTP or SQL-writing concern so the
 * decision can be asserted directly.
 */

const SYNC_TARGET = Object.freeze({
  UPDATE: "update",
  INSERT: "insert",
  CONFLICT: "conflict",
});

/**
 * @param {{ query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> }} db
 * @param {{ userId: number|string, cloudId?: number|null, s3Key?: string|null,
 *           documentNumber?: string|null, title?: string|null }} target
 */
async function resolveSyncTarget(db, target) {
  const {
    userId,
    cloudId,
    s3Key,
    documentNumber,
    title,
  } = target || {};

  if (Number.isInteger(cloudId) && cloudId > 0) {
    const owned = await db.query(
      `SELECT id FROM documents WHERE id = $1 AND user_id = $2`,
      [cloudId, userId],
    );

    if (!owned.rows || owned.rows.length === 0) {
      /*
       * The row this client knew about is gone or is no longer owned by it.
       * Creating a replacement would resurrect a document the user deleted on
       * another device, so this is reported as a conflict instead.
       */
      return {
        action: SYNC_TARGET.CONFLICT,
        reason: "notOwned",
        cloudId,
      };
    }

    return { action: SYNC_TARGET.UPDATE, rowId: cloudId, matchedBy: "cloudId" };
  }

  if (typeof s3Key === "string" && s3Key.length > 0) {
    const byKey = await db.query(
      `SELECT id FROM documents
        WHERE s3_key = $1 AND user_id = $2
        ORDER BY id ASC
        LIMIT 1`,
      [s3Key, userId],
    );

    if (byKey.rows && byKey.rows.length > 0) {
      return {
        action: SYNC_TARGET.UPDATE,
        rowId: byKey.rows[0].id,
        matchedBy: "s3Key",
      };
    }
  }

  const lookupValue =
    typeof documentNumber === "string" && documentNumber.length > 0
      ? documentNumber
      : typeof title === "string" && title.length > 0
        ? title
        : null;

  if (lookupValue) {
    const byNumber = await db.query(
      `SELECT id, title FROM documents
        WHERE document_number = $1 AND user_id = $2
        ORDER BY id ASC`,
      [lookupValue, userId],
    );

    if (byNumber.rows && byNumber.rows.length > 0) {
      const existingTitle = byNumber.rows[0].title;

      if (existingTitle !== title) {
        // Same number, different document. Flag rather than overwrite.
        return {
          action: SYNC_TARGET.CONFLICT,
          reason: "documentNumberOwnedByAnotherDocument",
          rowId: byNumber.rows[0].id,
        };
      }

      return {
        action: SYNC_TARGET.UPDATE,
        rowId: byNumber.rows[0].id,
        matchedBy: "documentNumber",
      };
    }
  }

  return { action: SYNC_TARGET.INSERT };
}

module.exports = {
  SYNC_TARGET,
  resolveSyncTarget,
};
