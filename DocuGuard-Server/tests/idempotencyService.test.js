"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

process.env.DATABASE_URL =
  "postgresql://placeholder:placeholder@127.0.0.1:1/placeholder";

const dbPath = require.resolve("../config/db", {
  paths: [__dirname],
});
const servicePath = require.resolve(
  "../services/idempotencyService",
  { paths: [__dirname] },
);

const db = require(dbPath);
const originalQuery = db.query;

function mockQueries(script) {
  const calls = [];

  db.query = async (sql, params = []) => {
    calls.push({ sql, params });
    const rows = await script(sql, params, calls);
    return { rows: rows || [], rowCount: (rows || []).length };
  };

  return calls;
}

test("fingerprintRequest is stable for objects with different key order", () => {
  const service = require(servicePath);

  assert.equal(
    service.fingerprintRequest({ title: "Passport", category: "identity" }),
    service.fingerprintRequest({ category: "identity", title: "Passport" }),
  );

  assert.notEqual(
    service.fingerprintRequest({ title: "Passport" }),
    service.fingerprintRequest({ title: "License" }),
  );
});

test("beginIdempotentRequest starts a new request with a payload fingerprint", async () => {
  const service = require(servicePath);
  let insertParams;

  const calls = mockQueries(async (sql, params) => {
    if (/INSERT INTO public\.idempotency_requests/i.test(sql)) {
      insertParams = params;
      return [{ request_fingerprint: params[2] }];
    }
    return [];
  });

  try {
    const payload = { title: "Passport", category: "identity" };
    const result = await service.beginIdempotentRequest("1", "test-key", payload);

    assert.equal(result.started, true);
    assert.equal(result.fingerprint, service.fingerprintRequest(payload));
    assert.equal(insertParams[2], result.fingerprint);
    assert.equal(calls.length, 1);
  } finally {
    db.query = originalQuery;
  }
});

test("beginIdempotentRequest reports a conflict for a different payload", async () => {
  const service = require(servicePath);
  const existingFingerprint = service.fingerprintRequest({ title: "Passport" });

  mockQueries(async (sql) => {
    if (/INSERT INTO public\.idempotency_requests/i.test(sql)) {
      return [];
    }
    if (/SELECT request_fingerprint, state, response_status, response_body/i.test(sql)) {
      return [{
        request_fingerprint: existingFingerprint,
        state: "completed",
        response_status: 201,
        response_body: { message: "original" },
      }];
    }
    return [];
  });

  try {
    const result = await service.beginIdempotentRequest(
      "1",
      "test-key",
      { title: "Driver License" },
    );

    assert.deepEqual(result, { conflict: true });
  } finally {
    db.query = originalQuery;
  }
});

test("beginIdempotentRequest replays a completed response for the same payload", async () => {
  const service = require(servicePath);
  const payload = { title: "Passport" };
  const fingerprint = service.fingerprintRequest(payload);
  const responseBody = { message: "Document created successfully", document: { id: 42 } };

  mockQueries(async (sql) => {
    if (/INSERT INTO public\.idempotency_requests/i.test(sql)) {
      return [];
    }
    if (/SELECT request_fingerprint, state, response_status, response_body/i.test(sql)) {
      return [{
        request_fingerprint: fingerprint,
        state: "completed",
        response_status: 201,
        response_body: responseBody,
      }];
    }
    return [];
  });

  try {
    const result = await service.beginIdempotentRequest("1", "test-key", payload);

    assert.equal(result.replay.response_status, 201);
    assert.deepEqual(result.replay.response_body, responseBody);
  } finally {
    db.query = originalQuery;
  }
});

test("beginIdempotentRequest reports an existing in-progress request", async () => {
  const service = require(servicePath);
  const payload = { title: "Passport" };
  const fingerprint = service.fingerprintRequest(payload);

  mockQueries(async (sql) => {
    if (/INSERT INTO public\.idempotency_requests/i.test(sql)) {
      return [];
    }
    if (/SELECT request_fingerprint, state, response_status, response_body/i.test(sql)) {
      return [{
        request_fingerprint: fingerprint,
        state: "in_progress",
        response_status: null,
        response_body: null,
      }];
    }
    return [];
  });

  try {
    const result = await service.beginIdempotentRequest("1", "test-key", payload);

    assert.deepEqual(result, { inProgress: true });
  } finally {
    db.query = originalQuery;
  }
});


test("beginIdempotentRequest uses the supplied transaction client", async () => {
  const service = require(servicePath);
  const clientCalls = [];

  const client = {
    query: async (sql, params = []) => {
      clientCalls.push({ sql, params });

      if (/INSERT INTO public\.idempotency_requests/i.test(sql)) {
        return {
          rows: [{ request_fingerprint: params[2] }],
          rowCount: 1,
        };
      }

      return { rows: [], rowCount: 0 };
    },
  };

  const payload = { title: "Passport" };
  const result = await service.beginIdempotentRequest(
    "1",
    "transaction-key",
    payload,
    client,
  );

  assert.equal(result.started, true);
  assert.equal(result.fingerprint, service.fingerprintRequest(payload));
  assert.equal(clientCalls.length, 1);
  assert.match(clientCalls[0].sql, /INSERT INTO public\.idempotency_requests/i);
});

test("storeIdempotentResponse uses the supplied transaction client", async () => {
  const service = require(servicePath);
  const clientCalls = [];
  const fingerprint = service.fingerprintRequest({ title: "Passport" });
  const responseBody = {
    message: "Document created successfully",
    document: { id: 42 },
  };

  const client = {
    query: async (sql, params = []) => {
      clientCalls.push({ sql, params });
      return {
        rows: [{ idempotency_key: "transaction-key" }],
        rowCount: 1,
      };
    },
  };

  const stored = await service.storeIdempotentResponse(
    "1",
    "transaction-key",
    201,
    responseBody,
    fingerprint,
    true,
    client,
  );

  assert.equal(stored, true);
  assert.equal(clientCalls.length, 1);
  assert.match(clientCalls[0].sql, /UPDATE public\.idempotency_requests/i);
  assert.equal(clientCalls[0].params[5], fingerprint);
  assert.deepEqual(JSON.parse(clientCalls[0].params[3]), responseBody);
});

test("storeIdempotentResponse rejects a missing or invalid fingerprint", async () => {
  const service = require(servicePath);
  let queryCount = 0;

  const client = {
    query: async () => {
      queryCount += 1;
      return { rows: [], rowCount: 0 };
    },
  };

  await assert.rejects(
    service.storeIdempotentResponse(
      "1",
      "transaction-key",
      201,
      { message: "created" },
      null,
      true,
      client,
    ),
    /valid request fingerprint/i,
  );

  await assert.rejects(
    service.storeIdempotentResponse(
      "1",
      "transaction-key",
      201,
      { message: "created" },
      "not-a-sha256-fingerprint",
      true,
      client,
    ),
    /valid request fingerprint/i,
  );

  assert.equal(queryCount, 0);
});

test("beginIdempotentRequest bounds retries when the record disappears", async () => {
  const service = require(servicePath);
  let insertCount = 0;
  let selectCount = 0;

  mockQueries(async (sql) => {
    if (/INSERT INTO public\.idempotency_requests/i.test(sql)) {
      insertCount += 1;
      return [];
    }

    if (/SELECT request_fingerprint, state, response_status, response_body/i.test(sql)) {
      selectCount += 1;
      return [];
    }

    return [];
  });

  try {
    const result = await service.beginIdempotentRequest(
      "1",
      "expiry-race-key",
      { title: "Passport" },
    );

    assert.deepEqual(result, { retryable: true });
    assert.equal(insertCount, 3);
    assert.equal(selectCount, 3);
  } finally {
    db.query = originalQuery;
  }
});
