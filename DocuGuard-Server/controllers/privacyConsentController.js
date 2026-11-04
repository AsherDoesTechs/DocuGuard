
"use strict";

const db = require("../config/db");

const MAX_NOTICE_VERSION_LENGTH = 50;

function getAuthenticatedUserId(req) {
  const rawUserId = req?.user?.userId;

  if (
    rawUserId === undefined ||
    rawUserId === null ||
    rawUserId === ""
  ) {
    return null;
  }

  const userId = Number(rawUserId);

  if (!Number.isSafeInteger(userId) || userId <= 0) {
    return null;
  }

  return userId;
}

function validateNoticeVersion(value) {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= MAX_NOTICE_VERSION_LENGTH
  );
}

function sendInvalidRequest(res, message) {
  return res.status(400).json({
    error: message,
  });
}

function sendServerError(res) {
  return res.status(500).json({
    error: "Unable to process the privacy consent request.",
  });
}

/**
 * GET /profile/privacy-consent
 *
 * Returns the latest recorded consent event for the authenticated account.
 */
async function getPrivacyConsent(req, res) {
  const userId = getAuthenticatedUserId(req);

  if (userId === null) {
    return res.status(401).json({
      error: "A valid authenticated user is required.",
    });
  }

  try {
    const result = await db.query(
      `
      SELECT
        id,
        notice_version AS "noticeVersion",
        event_type AS "eventType",
        notice_acknowledged AS "noticeAcknowledged",
        processing_agreed AS "processingAgreed",
        occurred_at AS "occurredAt"
      FROM public.privacy_consent_records
      WHERE user_id = $1
      ORDER BY occurred_at DESC, id DESC
      LIMIT 1
      `,
      [userId],
    );

    return res.status(200).json({
      consent: result.rows[0] || null,
    });
  } catch (error) {
    console.error(
      "Unable to retrieve privacy consent:",
      error.message,
    );

    return sendServerError(res);
  }
}

/**
 * POST /profile/privacy-consent
 *
 * Records acceptance. The account ID always comes from the verified JWT.
 */
async function acceptPrivacyConsent(req, res) {
  const userId = getAuthenticatedUserId(req);

  if (userId === null) {
    return res.status(401).json({
      error: "A valid authenticated user is required.",
    });
  }

  const body = req.body || {};
  const noticeVersion =
    typeof body.noticeVersion === "string"
      ? body.noticeVersion.trim()
      : body.noticeVersion;

  if (!validateNoticeVersion(noticeVersion)) {
    return sendInvalidRequest(
      res,
      "A valid noticeVersion is required.",
    );
  }

  if (
    body.noticeAcknowledged !== true ||
    body.processingAgreed !== true
  ) {
    return sendInvalidRequest(
      res,
      "Both notice acknowledgment and processing agreement are required for this acceptance event.",
    );
  }

  try {
    const result = await db.query(
      `
      INSERT INTO public.privacy_consent_records
        (
          user_id,
          notice_version,
          event_type,
          notice_acknowledged,
          processing_agreed
        )
      VALUES ($1, $2, 'accepted', TRUE, TRUE)
      RETURNING
        id,
        notice_version AS "noticeVersion",
        event_type AS "eventType",
        notice_acknowledged AS "noticeAcknowledged",
        processing_agreed AS "processingAgreed",
        occurred_at AS "occurredAt"
      `,
      [userId, noticeVersion],
    );

    return res.status(201).json({
      message: "Privacy consent acceptance recorded.",
      consent: result.rows[0],
    });
  } catch (error) {
    console.error(
      "Unable to record privacy consent acceptance:",
      error.message,
    );

    return sendServerError(res);
  }
}

/**
 * POST /profile/privacy-consent/withdraw
 *
 * Records withdrawal without deleting previous consent events.
 */
async function withdrawPrivacyConsent(req, res) {
  const userId = getAuthenticatedUserId(req);

  if (userId === null) {
    return res.status(401).json({
      error: "A valid authenticated user is required.",
    });
  }

  const body = req.body || {};
  const noticeVersion =
    typeof body.noticeVersion === "string"
      ? body.noticeVersion.trim()
      : body.noticeVersion;

  if (!validateNoticeVersion(noticeVersion)) {
    return sendInvalidRequest(
      res,
      "A valid noticeVersion is required.",
    );
  }

  try {
    const result = await db.query(
      `
      INSERT INTO public.privacy_consent_records
        (
          user_id,
          notice_version,
          event_type,
          notice_acknowledged,
          processing_agreed
        )
      VALUES ($1, $2, 'withdrawn', TRUE, FALSE)
      RETURNING
        id,
        notice_version AS "noticeVersion",
        event_type AS "eventType",
        notice_acknowledged AS "noticeAcknowledged",
        processing_agreed AS "processingAgreed",
        occurred_at AS "occurredAt"
      `,
      [userId, noticeVersion],
    );

    return res.status(201).json({
      message: "Privacy consent withdrawal recorded.",
      consent: result.rows[0],
    });
  } catch (error) {
    console.error(
      "Unable to record privacy consent withdrawal:",
      error.message,
    );

    return sendServerError(res);
  }
}

module.exports = {
  getPrivacyConsent,
  acceptPrivacyConsent,
  withdrawPrivacyConsent,
};
