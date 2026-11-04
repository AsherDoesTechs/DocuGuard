"use strict";

const crypto = require("crypto");
const db = require("../config/db");

function hashSessionToken(token) {
  if (typeof token !== "string" || token.length === 0) {
    throw new TypeError("A session token is required.");
  }

  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

async function createSession({
  userId,
  token,
  expiresAt,
  deviceName = null,
  platform = null,
  ipAddress = null,
  location = null,
}) {
  if (userId === undefined || userId === null) {
    throw new TypeError("A user ID is required to create a session.");
  }

  const expiry = new Date(expiresAt);
  if (!Number.isFinite(expiry.getTime()) || expiry <= new Date()) {
    throw new TypeError("A valid future session expiry is required.");
  }

  const tokenHash = hashSessionToken(token);

  const result = await db.query(
    `INSERT INTO login_sessions (
       user_id,
       device_name,
       platform,
       ip_address,
       location,
       is_current,
       session_token_hash,
       expires_at,
       revoked,
       revoked_at,
       last_active
     )
     VALUES ($1, $2, $3, $4, $5, TRUE, $6, $7, FALSE, NULL, NOW())
     RETURNING id`,
    [
      userId,
      deviceName,
      platform,
      ipAddress,
      location,
      tokenHash,
      expiry.toISOString(),
    ],
  );

  return result.rows[0];
}

async function isSessionActive({ userId, token }) {
  if (userId === undefined || userId === null) return false;

  const tokenHash = hashSessionToken(token);
  const result = await db.query(
    `SELECT id
     FROM login_sessions
     WHERE user_id = $1
       AND session_token_hash = $2
       AND revoked = FALSE
       AND revoked_at IS NULL
       AND expires_at > NOW()
     LIMIT 1`,
    [userId, tokenHash],
  );

  return result.rows.length > 0;
}

async function revokeSession({ userId, token }) {
  if (userId === undefined || userId === null) return false;

  const tokenHash = hashSessionToken(token);
  const result = await db.query(
    `UPDATE login_sessions
     SET revoked = TRUE,
         revoked_at = COALESCE(revoked_at, NOW()),
         is_current = FALSE,
         last_active = NOW()
     WHERE user_id = $1
       AND session_token_hash = $2
       AND revoked = FALSE
     RETURNING id`,
    [userId, tokenHash],
  );

  return result.rows.length > 0;
}

module.exports = {
  hashSessionToken,
  createSession,
  isSessionActive,
  revokeSession,
};
