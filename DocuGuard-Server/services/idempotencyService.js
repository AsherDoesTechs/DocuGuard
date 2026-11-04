"use strict";

const { createHash } = require("node:crypto");
const db = require("../config/db");

const DEFAULT_TTL_HOURS = 24;
const MAX_KEY_LENGTH = 200;
const MAX_CLAIM_ATTEMPTS = 3;

function stableSerialize(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableSerialize(value[key])}`
    ).join(",")}}`;
  }

  return JSON.stringify(value);
}

function fingerprintRequest(payload) {
  return createHash("sha256")
    .update(stableSerialize(payload ?? null))
    .digest("hex");
}

function validateKey(key) {
  if (typeof key !== "string" || key.trim().length === 0) {
    throw new TypeError("Idempotency key must be a non-empty string");
  }

  const normalized = key.trim();

  if (normalized.length > MAX_KEY_LENGTH) {
    throw new TypeError(
      `Idempotency key must be at most ${MAX_KEY_LENGTH} characters`,
    );
  }

  return normalized;
}

function getQueryClient(client) {
  if (client === undefined || client === null) {
    return db;
  }

  if (typeof client.query !== "function") {
    throw new TypeError("A valid PostgreSQL query client is required");
  }

  return client;
}

async function getIdempotentResponse(userId, key, client = null) {
  const normalizedKey = validateKey(key);
  const queryClient = getQueryClient(client);

  const result = await queryClient.query(
    `SELECT response_status, response_body, request_fingerprint,
            state, expires_at
       FROM public.idempotency_requests
      WHERE user_id = $1 AND idempotency_key = $2
        AND expires_at > NOW()
      LIMIT 1`,
    [String(userId), normalizedKey],
  );

  return result.rows[0] || null;
}

async function beginIdempotentRequest(
  userId,
  key,
  payload,
  client = null,
) {
  const normalizedKey = validateKey(key);
  const queryClient = getQueryClient(client);
  const fingerprint = fingerprintRequest(payload);

  for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt += 1) {
    const inserted = await queryClient.query(
      `INSERT INTO public.idempotency_requests
         (user_id, idempotency_key, request_fingerprint, state,
          created_at, updated_at, expires_at)
       VALUES ($1, $2, $3, 'in_progress', NOW(), NOW(),
               NOW() + ($4 * INTERVAL '1 hour'))
       ON CONFLICT (user_id, idempotency_key)
       DO UPDATE SET
         request_fingerprint = EXCLUDED.request_fingerprint,
         state = 'in_progress',
         response_status = NULL,
         response_body = NULL,
         created_at = NOW(),
         updated_at = NOW(),
         expires_at = EXCLUDED.expires_at
       WHERE public.idempotency_requests.expires_at <= NOW()
       RETURNING request_fingerprint`,
      [String(userId), normalizedKey, fingerprint, DEFAULT_TTL_HOURS],
    );

    if (inserted.rows.length > 0) {
      return { started: true, fingerprint };
    }

    const existing = await queryClient.query(
      `SELECT request_fingerprint, state, response_status, response_body
         FROM public.idempotency_requests
        WHERE user_id = $1 AND idempotency_key = $2
          AND expires_at > NOW()
        LIMIT 1`,
      [String(userId), normalizedKey],
    );

    const row = existing.rows[0];

    if (!row) {
      // Retry a bounded number of times if the record changes during lookup.
      continue;
    }

    if (row.request_fingerprint !== fingerprint) {
      return { conflict: true };
    }

    if (row.state === "completed" && row.response_status != null) {
      return { replay: row };
    }

    return { inProgress: true };
  }

  return { retryable: true };
}

async function storeIdempotentResponse(
  userId,
  key,
  status,
  body,
  requestFingerprint,
  final = true,
  client = null,
) {
  const normalizedKey = validateKey(key);
  const queryClient = getQueryClient(client);

  if (
    typeof requestFingerprint !== "string" ||
    !/^[a-f0-9]{64}$/i.test(requestFingerprint)
  ) {
    throw new TypeError("A valid request fingerprint is required");
  }

  const result = await queryClient.query(
    `UPDATE public.idempotency_requests
        SET response_status = $3,
            response_body = $4::jsonb,
            state = CASE WHEN $5 THEN 'completed' ELSE 'in_progress' END,
            updated_at = NOW()
      WHERE user_id = $1 AND idempotency_key = $2
        AND expires_at > NOW()
        AND request_fingerprint = $6
      RETURNING idempotency_key`,
    [
      String(userId),
      normalizedKey,
      status,
      JSON.stringify(body ?? null),
      Boolean(final),
      requestFingerprint,
    ],
  );

  return result.rows.length > 0;
}

module.exports = {
  fingerprintRequest,
  getIdempotentResponse,
  beginIdempotentRequest,
  storeIdempotentResponse,
};
