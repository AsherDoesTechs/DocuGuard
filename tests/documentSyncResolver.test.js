"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  SYNC_TARGET,
  resolveSyncTarget,
} = require("../DocuGuard-Server/services/documentSyncResolver");

/**
 * A database stub that answers the three lookups the resolver performs.
 */
function makeDb(rows) {
  const calls = [];

  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });

      if (sql.includes("WHERE id = $1 AND user_id = $2")) {
        const id = params[0];
        const found = rows.find((row) => row.id === id && row.user_id === params[1]);
        return { rows: found ? [found] : [] };
      }

      if (sql.includes("WHERE s3_key = $1 AND user_id = $2")) {
        const found = rows.filter(
          (row) => row.s3_key === params[0] && row.user_id === params[1],
        );
        return { rows: found.length > 0 ? [found[0]] : [] };
      }

      if (sql.includes("WHERE document_number = $1 AND user_id = $2")) {
        const found = rows.filter(
          (row) =>
            row.document_number === params[0] && row.user_id === params[1],
        );
        return { rows: found };
      }

      throw new Error(`unexpected query: ${sql}`);
    },
  };
}

test("a known cloud id updates that row", async () => {
  const db = makeDb([{ id: 7, user_id: 1, title: "Passport" }]);

  const target = await resolveSyncTarget(db, {
    userId: 1,
    cloudId: 7,
    documentNumber: "P1",
    title: "Passport",
  });

  assert.equal(target.action, SYNC_TARGET.UPDATE);
  assert.equal(target.rowId, 7);
  assert.equal(target.matchedBy, "cloudId");
});

test("a cloud id that is not owned is a conflict, never an insert", async () => {
  const db = makeDb([{ id: 7, user_id: 2, title: "Passport" }]);

  const target = await resolveSyncTarget(db, {
    userId: 1,
    cloudId: 7,
    documentNumber: "P1",
    title: "Passport",
  });

  assert.equal(target.action, SYNC_TARGET.CONFLICT);
  assert.equal(target.reason, "notOwned");
});

test("a retry that lost the cloud id still finds its row through the storage key", async () => {
  const db = makeDb([
    { id: 12, user_id: 1, title: "Scanned Document", s3_key: "1/abc.pdf" },
  ]);

  const target = await resolveSyncTarget(db, {
    userId: 1,
    cloudId: null,
    s3Key: "1/abc.pdf",
    documentNumber: "P123",
    title: "Passport",
  });

  assert.equal(target.action, SYNC_TARGET.UPDATE);
  assert.equal(target.rowId, 12);
  assert.equal(target.matchedBy, "s3Key");
});

test("a document number that belongs to a different document is a conflict", async () => {
  const db = makeDb([
    { id: 3, user_id: 1, title: "Driver License", document_number: "P123" },
  ]);

  const target = await resolveSyncTarget(db, {
    userId: 1,
    cloudId: null,
    s3Key: null,
    documentNumber: "P123",
    title: "Passport",
  });

  assert.equal(target.action, SYNC_TARGET.CONFLICT);
  assert.equal(target.reason, "documentNumberOwnedByAnotherDocument");
});

test("the same document number with the same title updates the existing row", async () => {
  const db = makeDb([
    { id: 3, user_id: 1, title: "Passport", document_number: "P123" },
  ]);

  const target = await resolveSyncTarget(db, {
    userId: 1,
    cloudId: null,
    s3Key: null,
    documentNumber: "P123",
    title: "Passport",
  });

  assert.equal(target.action, SYNC_TARGET.UPDATE);
  assert.equal(target.rowId, 3);
  assert.equal(target.matchedBy, "documentNumber");
});

test("an unknown document is inserted", async () => {
  const db = makeDb([]);

  const target = await resolveSyncTarget(db, {
    userId: 1,
    cloudId: null,
    s3Key: "1/new.pdf",
    documentNumber: "P999",
    title: "New Document",
  });

  assert.equal(target.action, SYNC_TARGET.INSERT);
});

test("another account's row with the same storage key is ignored", async () => {
  const db = makeDb([
    { id: 12, user_id: 2, title: "Passport", s3_key: "1/abc.pdf" },
  ]);

  const target = await resolveSyncTarget(db, {
    userId: 1,
    cloudId: null,
    s3Key: "1/abc.pdf",
    documentNumber: "P123",
    title: "Passport",
  });

  assert.equal(target.action, SYNC_TARGET.INSERT);
});
