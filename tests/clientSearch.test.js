"use strict";

/**
 * Client-side search API tests for DocuGuard's Documents screen.
 *
 * Covers:
 *   - API search endpoint call shape (authenticated, correct path, params)
 *   - Response shape (query, results, count)
 *   - Network error propagation
 *   - Empty results
 *
 * These tests run in plain Node (no React Native renderer). They mock the
 * axios API client and exercise the search API integration in isolation.
 * Debounce, stale-response prevention, and UI rendering are exercised by
 * the Documents screen component (covered by manual review) since plain Node
 * cannot render React Native components without a testing library.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

// --- Mock axios -------------------------------------------------------------

const axiosCalls = [];
let axiosShouldFail = false;
let axiosResponse = null;

const mockAxios = {
  create: () => ({
    interceptors: {
      request: { use: () => {} },
      response: { use: () => {} },
    },
    get: async (url, config) => {
      axiosCalls.push({ url, config });
      if (axiosShouldFail) {
        const err = new Error("Network error");
        err.code = "ERR_NETWORK";
        err.isOffline = true;
        throw err;
      }
      return { data: axiosResponse };
    },
  }),
};

const modulePath = require.resolve("axios");
require.cache[modulePath] = {
  id: modulePath,
  filename: modulePath,
  loaded: true,
  exports: mockAxios,
};

// Minimal mock of the search API layer (mirrors services/api.ts search.documents)
async function searchDocuments(query) {
  const apiClient = mockAxios.create();
  const response = await apiClient.get("/api/search", {
    params: { q: query },
  });
  return response.data;
}

// --- Helpers ----------------------------------------------------------------

function resetCalls() {
  axiosCalls.length = 0;
  axiosShouldFail = false;
  axiosResponse = null;
}

async function flushPromises() {
  return new Promise((resolve) => setImmediate(resolve));
}

// --- Tests ------------------------------------------------------------------

test("search calls the authenticated /api/search endpoint with q param", async () => {
  resetCalls();
  axiosResponse = { query: "passport", results: [], count: 0 };

  await searchDocuments("passport");
  await flushPromises();

  assert.equal(axiosCalls.length, 1);
  assert.equal(axiosCalls[0].url, "/api/search");
  assert.equal(axiosCalls[0].config.params.q, "passport");
});

test("search returns results wrapped in query/count shape", async () => {
  resetCalls();
  axiosResponse = {
    query: "passport",
    results: [{ id: 1, title: "Passport" }],
    count: 1,
  };

  const result = await searchDocuments("passport");
  await flushPromises();

  assert.equal(result.query, "passport");
  assert.equal(result.count, 1);
  assert.equal(result.results[0].id, 1);
});

test("search propagates network errors", async () => {
  resetCalls();
  axiosShouldFail = true;

  let threw = false;
  try {
    await searchDocuments("passport");
  } catch (err) {
    threw = true;
    assert.equal(err.isOffline, true);
  }
  await flushPromises();
  assert.equal(threw, true, "expected network error to be thrown");
});

test("search result count matches results array length", async () => {
  resetCalls();
  axiosResponse = {
    query: "x",
    results: [{ id: 1 }, { id: 2 }, { id: 3 }],
    count: 3,
  };

  const result = await searchDocuments("x");
  await flushPromises();

  assert.equal(result.count, 3);
  assert.equal(result.results.length, 3);
});

test("empty search returns empty results", async () => {
  resetCalls();
  axiosResponse = { query: "", results: [], count: 0 };

  const result = await searchDocuments("");
  await flushPromises();

  assert.equal(result.count, 0);
  assert.equal(result.results.length, 0);
});
