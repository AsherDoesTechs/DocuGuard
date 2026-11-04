"use strict";

/**
 * Unit tests for full-text document search (OCR-based search and indexing).
 *
 * The database layer is stubbed so no real database, network, or production
 * data is touched. The controller is driven with scripted query results to
 * verify that search is scoped by user, excludes soft-deleted documents, and
 * uses the full-text search vector.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

process.env.DATABASE_URL =
  "postgresql://placeholder:placeholder@127.0.0.1:1/placeholder";
process.env.SUPABASE_URL =
  process.env.SUPABASE_URL || "https://placeholder.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || "placeholder-service-role";
process.env.SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || "placeholder-anon";
delete process.env.DEBUG_LOG_FILE;

const db = require("../config/db");
const controller = require("../controllers/searchController");

const USER_ID = 1;

/**
 * Drives the controller with a scripted database.
 */
async function drive({ query = {}, script = () => [] } = {}) {
  const originalQuery = db.query;
  const calls = [];

  db.query = async (sql, params) => {
    calls.push({ sql, params });

    // Match by distinctive substring (template literals may have leading
    // whitespace/newlines, so startsWith is unreliable).
    for (const [key, rows] of Object.entries(query)) {
      if (sql.includes(key)) {
        return { rows, rowCount: rows.length };
      }
    }

    const rows = script(sql, params) || [];
    return { rows, rowCount: rows.length };
  };

  const req = {
    user: { userId: USER_ID },
    query: { q: "passport" },
  };
  const res = {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.payload = body;
      return this;
    },
  };

  try {
    await controller.searchDocuments(req, res);
  } finally {
    db.query = originalQuery;
  }

  return { res, calls };
}

test("search returns documents matching the query", async () => {
  const { res, calls } = await drive({
    query: {
      "FROM documents": [
        {
          id: 42,
          title: "Passport",
          category: "identification",
          rank: 0.5,
        },
      ],
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.query, "passport");
  assert.equal(res.payload.count, 1);
  assert.equal(res.payload.results[0].title, "Passport");
  assert.equal(res.payload.results[0].relevance, 0.5);

  // The query must use full-text search against search_vector.
  const searchCall = calls.find((c) =>
    c.sql.includes("search_vector") && c.sql.includes("plainto_tsquery")
  );
  assert.ok(searchCall, "search must use the full-text search vector");
  assert.deepEqual(searchCall.params, [USER_ID, "passport"]);
});

test("search excludes soft-deleted documents", async () => {
  const { res, calls } = await drive({
    query: {
      "FROM documents": [],
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.count, 0);

  // The search must filter out tombstones.
  const searchCall = calls.find((c) =>
    c.sql.includes("search_vector") && c.sql.includes("plainto_tsquery")
  );
  assert.ok(searchCall, "expected a search query");
  assert.match(
    searchCall.sql,
    /status <> 'deleted'/,
    "search must exclude soft-deleted documents",
  );
});

test("search is scoped by the authenticated user", async () => {
  const { calls } = await drive({
    query: {
      "FROM documents": [],
    },
  });

  const searchCall = calls.find((c) =>
    c.sql.includes("search_vector") && c.sql.includes("plainto_tsquery")
  );
  assert.ok(searchCall, "expected a search query");
  assert.deepEqual(searchCall.params, [USER_ID, "passport"]);
  assert.match(
    searchCall.sql,
    /WHERE user_id = \$1/,
    "search must be scoped by user_id",
  );
});

test("search returns 400 when no query is provided", async () => {
  const originalQuery = db.query;
  const calls = [];

  db.query = async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [], rowCount: 0 };
  };

  const req = {
    user: { userId: USER_ID },
    query: {},
  };
  const res = {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.payload = body;
      return this;
    },
  };

  try {
    await controller.searchDocuments(req, res);
  } finally {
    db.query = originalQuery;
  }

  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.code, 2002); // DOC_VALIDATION
  assert.equal(calls.length, 0, "no database query when validation fails");
});

test("search returns 400 when query is empty string", async () => {
  const originalQuery = db.query;
  const calls = [];

  db.query = async (sql, params) => {
    calls.push({ sql, params });
    return { rows: [], rowCount: 0 };
  };

  const req = {
    user: { userId: USER_ID },
    query: { q: "   " },
  };
  const res = {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.payload = body;
      return this;
    },
  };

  try {
    await controller.searchDocuments(req, res);
  } finally {
    db.query = originalQuery;
  }

  assert.equal(res.statusCode, 400);
  assert.equal(calls.length, 0, "no database query when validation fails");
});

test("search results are ordered by relevance", async () => {
  const { res } = await drive({
    query: {
      "FROM documents": [
        {
          id: 2,
          title: "Passport",
          rank: 0.9,
        },
        {
          id: 1,
          title: "Passport Renewal",
          rank: 0.1,
        },
      ],
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.count, 2);
  assert.equal(res.payload.results[0].id, 2); // higher rank first
  assert.equal(res.payload.results[1].id, 1);
});
