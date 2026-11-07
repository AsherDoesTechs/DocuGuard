"use strict";

const crypto = require("crypto");
const db = require("../config/db");

const ENROLLMENT_SECONDS = 300;
const MAX_PUBLIC_KEY_LENGTH = 8192;

function sendError(res, status, error, code) {
  return res.status(status).json({ error, code });
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

function validOpaqueToken(value) {
  return (
    typeof value === "string" &&
    value.length >= 32 &&
    value.length <= 256 &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

function validatePublicKey(value) {
  if (
    typeof value !== "string" ||
    value.length > MAX_PUBLIC_KEY_LENGTH ||
    !value.startsWith("-----BEGIN PUBLIC KEY-----") ||
    !value.includes("-----END PUBLIC KEY-----")
  ) {
    return null;
  }

  try {
    const key = crypto.createPublicKey(value);
    const details = key.asymmetricKeyDetails;

    if (
      key.type !== "public" ||
      key.asymmetricKeyType !== "ec" ||
      details?.namedCurve !== "prime256v1"
    ) {
      return null;
    }

    return key.export({ type: "spki", format: "pem" });
  } catch {
    return null;
  }
}

exports.enrollDevice = async (req, res) => {
  // Render Debug Logs: Log incoming request details
  console.log("--- INCOMING ENROLLMENT REQUEST ---", {
    hasToken: Boolean(req.body?.enrollmentToken || req.body?.token),
    hasKey: Boolean(req.body?.publicKeyPem),
    bodyKeys: Object.keys(req.body || {}),
  });

  // Support both frontend naming conventions (enrollmentToken vs token, deviceLabel vs deviceName)
  const enrollmentToken = req.body?.enrollmentToken || req.body?.token;
  const rawPublicKey = req.body?.publicKeyPem;
  const publicKeyPem = validatePublicKey(rawPublicKey);
  const suppliedLabel = req.body?.deviceLabel || req.body?.deviceName;

  if (!validOpaqueToken(enrollmentToken)) {
    console.log(
      "DEBUG: Token validation failed. Value received:",
      enrollmentToken,
    );
    return sendError(
      res,
      400,
      "Invalid enrollment request.",
      "ADMIN_ENROLLMENT_INVALID",
    );
  }

  if (!publicKeyPem) {
    console.log(
      "DEBUG: Public key validation failed. Raw input length:",
      rawPublicKey?.length,
    );
    return sendError(
      res,
      400,
      "A valid ECDSA P-256 public key is required.",
      "ADMIN_DEVICE_KEY_INVALID",
    );
  }

  const deviceLabel =
    typeof suppliedLabel === "string"
      ? suppliedLabel.trim()
      : "DocuGuard Admin device";

  try {
    const result = await db.withTransaction(async (client) => {
      const grantResult = await client.query(
        `SELECT t.id AS enrollment_token_id,
                t.user_id,
                u.role,
                u.admin_id,
                u.is_verified
           FROM public.admin_device_enrollment_tokens t
           JOIN public.users u ON u.id = t.user_id
          WHERE t.token_hash = $1
            AND t.used_at IS NULL
            AND t.expires_at > NOW()
          FOR UPDATE OF t, u`,
        [hashToken(enrollmentToken)],
      );

      const grant = grantResult.rows[0];

      if (
        !grant ||
        String(grant.role).trim().toLowerCase() !== "admin" ||
        typeof grant.admin_id !== "string" ||
        grant.admin_id.trim().length === 0 ||
        grant.is_verified !== true
      ) {
        return { failure: "grant" };
      }

      // Consume the grant inside the same transaction as device creation.
      // A failed insert rolls back this update as well.
      const consumed = await client.query(
        `UPDATE public.admin_device_enrollment_tokens
            SET used_at = NOW()
          WHERE id = $1
            AND used_at IS NULL
            AND expires_at > NOW()
          RETURNING id`,
        [grant.enrollment_token_id],
      );

      if (consumed.rowCount !== 1) {
        return { failure: "grant" };
      }

      const deviceResult = await client.query(
        `INSERT INTO public.admin_devices
           (user_id, device_label, public_key_pem, key_algorithm)
         VALUES ($1, $2, $3, 'ECDSA_P256_SHA256')
         RETURNING id`,
        [grant.user_id, deviceLabel, publicKeyPem],
      );

      if (deviceResult.rowCount !== 1 || !deviceResult.rows[0]) {
        throw new Error("Device enrollment insert did not return a row");
      }

      return { deviceId: deviceResult.rows[0].id };
    });

    if (result?.failure === "grant") {
      return sendError(
        res,
        401,
        "Enrollment grant is invalid, expired, or already used.",
        "ADMIN_ENROLLMENT_INVALID",
      );
    }

    if (!result || result.deviceId === undefined || result.deviceId === null) {
      return sendError(
        res,
        503,
        "Device enrollment is temporarily unavailable.",
        "ADMIN_ENROLLMENT_UNAVAILABLE",
      );
    }

    return res.status(201).json({
      deviceId: String(result.deviceId),
      keyAlgorithm: "ECDSA_P256_SHA256",
      enrolled: true,
    });
  } catch {
    return sendError(
      res,
      503,
      "Device enrollment is temporarily unavailable.",
      "ADMIN_ENROLLMENT_UNAVAILABLE",
    );
  }
};

exports.ENROLLMENT_SECONDS = ENROLLMENT_SECONDS;
