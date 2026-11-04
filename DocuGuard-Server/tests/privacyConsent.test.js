
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const db = require("../config/db");
const controller = require("../controllers/privacyConsentController");

async function call(handler, { userId = 7, body = {}, authenticated = true } = {}) {
  const originalQuery = db.query;
  const calls = [];

  db.query = async (sql, params) => {
    calls.push({ sql, params });

    if (typeof db.testQueryResult === "function") {
      return db.testQueryResult(sql, params);
    }

    return {
      rows: [
        {
          id: 11,
          noticeVersion: "1.0.0",
          eventType: "accepted",
          noticeAcknowledged: true,
          processingAgreed: true,
          occurredAt: "2026-10-27T00:00:00.000Z",
        },
      ],
      rowCount: 1,
    };
  };

  const req = {
    user: authenticated && userId !== undefined ? { userId } : {},
    body,
  };

  const res = {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };

  try {
    await handler(req, res);
    return { calls, res };
  } finally {
    db.query = originalQuery;
    delete db.testQueryResult;
  }
}

test("acceptance records the authenticated account and notice version", async () => {
  const { calls, res } = await call(
    controller.acceptPrivacyConsent,
    {
      userId: 7,
      body: {
        noticeVersion: "1.0.0",
        noticeAcknowledged: true,
        processingAgreed: true,
        userId: 999,
      },
    },
  );

  assert.equal(res.statusCode, 201);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /INSERT INTO public\.privacy_consent_records/);
  assert.deepEqual(calls[0].params, [7, "1.0.0"]);
  assert.match(calls[0].sql, /'accepted', TRUE, TRUE/);
});

test("acceptance rejects missing consent flags without writing", async () => {
  const { calls, res } = await call(
    controller.acceptPrivacyConsent,
    {
      userId: 7,
      body: {
        noticeVersion: "1.0.0",
        noticeAcknowledged: true,
        processingAgreed: false,
      },
    },
  );

  assert.equal(res.statusCode, 400);
  assert.equal(calls.length, 0);
});

test("acceptance rejects an invalid notice version", async () => {
  const { calls, res } = await call(
    controller.acceptPrivacyConsent,
    {
      userId: 7,
      body: {
        noticeVersion: "   ",
        noticeAcknowledged: true,
        processingAgreed: true,
      },
    },
  );

  assert.equal(res.statusCode, 400);
  assert.equal(calls.length, 0);
});

test("withdrawal appends a withdrawn event", async () => {
  const { calls, res } = await call(
    controller.withdrawPrivacyConsent,
    {
      userId: 7,
      body: {
        noticeVersion: "1.0.0",
      },
    },
  );

  assert.equal(res.statusCode, 201);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /'withdrawn', TRUE, FALSE/);
  assert.deepEqual(calls[0].params, [7, "1.0.0"]);
});

test("a missing authenticated user cannot write consent", async () => {
  const { calls, res } = await call(
    controller.acceptPrivacyConsent,
    {
      authenticated: false,
      body: {
        noticeVersion: "1.0.0",
        noticeAcknowledged: true,
        processingAgreed: true,
      },
    },
  );

  assert.equal(res.statusCode, 401);
  assert.equal(calls.length, 0);
});

test("GET returns the latest consent record for the authenticated user", async () => {
  const { calls, res } = await call(
    controller.getPrivacyConsent,
    { userId: 7 },
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.consent.eventType, "accepted");
  assert.match(calls[0].sql, /WHERE user_id = \$1/);
  assert.match(calls[0].sql, /ORDER BY occurred_at DESC, id DESC/);
  assert.deepEqual(calls[0].params, [7]);
});

test("database failure returns an error response", async () => {
  const originalQuery = db.query;
  db.query = async () => {
    throw new Error("simulated database failure");
  };

  const req = {
    user: { userId: 7 },
    body: {
      noticeVersion: "1.0.0",
      noticeAcknowledged: true,
      processingAgreed: true,
    },
  };

  const res = {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };

  try {
    await controller.acceptPrivacyConsent(req, res);
    assert.equal(res.statusCode, 500);
  } finally {
    db.query = originalQuery;
  }
});

// Additional edge-case coverage.
test("invalid authenticated account ID is rejected without querying the database", async () => {
  for (const userId of [0, -1, "not-a-number", 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const { calls, res } = await call(controller.getPrivacyConsent, { userId });
    assert.equal(res.statusCode, 401, `Expected 401 for userId=${userId}`);
    assert.equal(calls.length, 0, `Expected no query for userId=${userId}`);
  }
});

test("GET returns null when no consent history exists", async () => {
  const originalQuery = db.query;
  db.query = async () => ({ rows: [], rowCount: 0 });

  const req = { user: { userId: 7 }, body: {} };
  const res = {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };

  try {
    await controller.getPrivacyConsent(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.consent, null);
  } finally {
    db.query = originalQuery;
  }
});

test("GET database failure returns a generic server error", async () => {
  const originalQuery = db.query;
  db.query = async () => { throw new Error("simulated GET database failure"); };

  const req = { user: { userId: 7 }, body: {} };
  const res = {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };

  try {
    await controller.getPrivacyConsent(req, res);
    assert.equal(res.statusCode, 500);
    assert.equal(res.payload.error, "Unable to process the privacy consent request.");
  } finally {
    db.query = originalQuery;
  }
});

test("withdrawal database failure returns a generic server error", async () => {
  const originalQuery = db.query;
  db.query = async () => { throw new Error("simulated withdrawal database failure"); };

  const req = { user: { userId: 7 }, body: { noticeVersion: "1.0.0" } };
  const res = {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };

  try {
    await controller.withdrawPrivacyConsent(req, res);
    assert.equal(res.statusCode, 500);
    assert.equal(res.payload.error, "Unable to process the privacy consent request.");
  } finally {
    db.query = originalQuery;
  }
});

