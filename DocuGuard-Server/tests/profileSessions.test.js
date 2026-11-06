"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const db = require("../config/db");
const dataSyncServicePath = require.resolve(
  "../services/dataSyncService",
);

require.cache[dataSyncServicePath] = {
  id: dataSyncServicePath,
  filename: dataSyncServicePath,
  loaded: true,
  exports: {
    syncProfile: async () => {},
  },
};

const profileController = require("../controllers/profileController");

function makeResponse() {
  return {
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
}

async function withMockedQuery(mockQuery, callback) {
  const originalQuery = db.query;
  db.query = mockQuery;

  try {
    await callback();
  } finally {
    db.query = originalQuery;
  }
}

test("getLoginSessions returns active sessions for the authenticated user", async () => {
  const expectedSessions = [
    { id: 10, deviceName: "Android", isCurrent: true },
  ];
  let capturedQuery;

  await withMockedQuery(async (sql, params) => {
    capturedQuery = { sql, params };
    return { rows: expectedSessions };
  }, async () => {
    const res = makeResponse();

    await profileController.getLoginSessions(
      { user: { userId: 7 } },
      res,
    );

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.payload.sessions, expectedSessions);
  });

  assert.deepEqual(capturedQuery.params, [7]);
  assert.match(capturedQuery.sql, /revoked\s*=\s*FALSE/i);
  assert.match(capturedQuery.sql, /revoked_at\s+IS NULL/i);
  assert.match(capturedQuery.sql, /expires_at\s*>\s*NOW\(\)/i);
});

test("getLoginSessions returns an empty array when no active sessions exist", async () => {
  await withMockedQuery(async () => ({ rows: [] }), async () => {
    const res = makeResponse();

    await profileController.getLoginSessions(
      { user: { userId: 7 } },
      res,
    );

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.payload, { sessions: [] });
  });
});

test("getLoginSessions returns a safe error when the database fails", async () => {
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    await withMockedQuery(async () => {
      throw new Error("simulated database failure");
    }, async () => {
      const res = makeResponse();

      await profileController.getLoginSessions(
        { user: { userId: 7 } },
        res,
      );

      assert.equal(res.statusCode, 500);
      assert.deepEqual(res.payload, {
        error: "Server error fetching sessions",
      });
    });
  } finally {
    console.error = originalConsoleError;
  }
});

test("terminateSession revokes an eligible other session without deleting it", async () => {
  let capturedQuery;

  await withMockedQuery(async (sql, params) => {
    capturedQuery = { sql, params };
    return { rows: [{ id: 12 }], rowCount: 1 };
  }, async () => {
    const res = makeResponse();

    await profileController.terminateSession(
      {
        user: { userId: 7 },
        params: { sessionId: "12" },
      },
      res,
    );

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.payload, { message: "Session terminated" });
  });

  assert.deepEqual(capturedQuery.params, ["12", 7]);
  assert.match(capturedQuery.sql, /UPDATE\s+login_sessions/i);
  assert.match(capturedQuery.sql, /revoked\s*=\s*TRUE/i);
  assert.match(capturedQuery.sql, /revoked_at\s*=/i);
  assert.match(capturedQuery.sql, /is_current\s*=\s*FALSE/i);
  assert.match(capturedQuery.sql, /is_current\s*=\s*FALSE[\s\S]*RETURNING id/i);
  assert.doesNotMatch(capturedQuery.sql, /DELETE\s+FROM/i);
});

test("terminateSession refuses to terminate the current or an ineligible session", async () => {
  await withMockedQuery(async () => ({ rows: [], rowCount: 0 }), async () => {
    const res = makeResponse();

    await profileController.terminateSession(
      {
        user: { userId: 7 },
        params: { sessionId: "10" },
      },
      res,
    );

    assert.equal(res.statusCode, 404);
    assert.equal(
      res.payload.error,
      "Session not found or cannot terminate current session",
    );
  });
});

test("terminateSession returns a safe error when the database fails", async () => {
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    await withMockedQuery(async () => {
      throw new Error("simulated database failure");
    }, async () => {
      const res = makeResponse();

      await profileController.terminateSession(
        {
          user: { userId: 7 },
          params: { sessionId: "12" },
        },
        res,
      );

      assert.equal(res.statusCode, 500);
      assert.deepEqual(res.payload, {
        error: "Server error terminating session",
      });
    });
  } finally {
    console.error = originalConsoleError;
  }
});

test("terminateAllOtherSessions revokes only eligible sessions belonging to the user", async () => {
  let capturedQuery;

  await withMockedQuery(async (sql, params) => {
    capturedQuery = { sql, params };
    return { rows: [{ id: 12 }, { id: 13 }], rowCount: 2 };
  }, async () => {
    const res = makeResponse();

    await profileController.terminateAllOtherSessions(
      { user: { userId: 7 } },
      res,
    );

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.payload, {
      message: "Terminated 2 other session(s)",
    });
  });

  assert.deepEqual(capturedQuery.params, [7]);
  assert.match(capturedQuery.sql, /UPDATE\s+login_sessions/i);
  assert.match(capturedQuery.sql, /user_id\s*=\s*\$1/i);
  assert.match(capturedQuery.sql, /is_current\s*=\s*FALSE/i);
  assert.match(capturedQuery.sql, /revoked\s*=\s*FALSE/i);
  assert.match(capturedQuery.sql, /revoked_at\s+IS NULL/i);
  assert.doesNotMatch(capturedQuery.sql, /DELETE\s+FROM/i);
});

test("terminateAllOtherSessions returns a safe error when the database fails", async () => {
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    await withMockedQuery(async () => {
      throw new Error("simulated database failure");
    }, async () => {
      const res = makeResponse();

      await profileController.terminateAllOtherSessions(
        { user: { userId: 7 } },
        res,
      );

      assert.equal(res.statusCode, 500);
      assert.deepEqual(res.payload, {
        error: "Server error terminating sessions",
      });
    });
  } finally {
    console.error = originalConsoleError;
  }
});
