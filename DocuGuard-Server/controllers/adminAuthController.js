"use strict";

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const db = require("../config/db");
const { verifyTOTP } = require("../utils/totp");

const PENDING_LOGIN_SECONDS = 300;
const CHALLENGE_SECONDS = 90;
const ADMIN_SESSION_SECONDS = 8 * 60 * 60;

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

function validDeviceId(value) {
  return (
    (typeof value === "string" &&
      (/^[1-9]\d{0,18}$/.test(value) || // Supports numeric IDs
        /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
          value,
        ))) || // Supports UUIDs
    (typeof value === "number" && Number.isSafeInteger(value) && value > 0)
  );
}

function validSignature(value) {
  return (
    typeof value === "string" &&
    value.length >= 40 &&
    value.length <= 2048 &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  );
}

function isExpired(value) {
  return !value || new Date(value).getTime() <= Date.now();
}

function isAdminAccount(user) {
  return (
    user &&
    String(user.role).trim().toLowerCase() === "admin" &&
    typeof user.admin_id === "string" &&
    user.admin_id.trim().length > 0 &&
    user.is_verified === true
  );
}

// Stage 1: Verify Admin ID, password and any configured TOTP.
// This handler deliberately does not issue a session JWT.
exports.adminLogin = async (req, res) => {
  const adminId =
    typeof req.body?.adminId === "string" ? req.body.adminId.trim() : "";
  const password =
    typeof req.body?.password === "string" ? req.body.password : "";
  const totpCode =
    typeof req.body?.totpCode === "string" ? req.body.totpCode.trim() : "";

  if (
    adminId.length < 1 ||
    adminId.length > 128 ||
    password.length < 1 ||
    password.length > 1024
  ) {
    return sendError(
      res,
      400,
      "Enter a valid Admin ID and password.",
      "ADMIN_LOGIN_INVALID",
    );
  }

  try {
    const result = await db.query(
      `SELECT id, email, name, password_hash, is_verified,
              role, admin_id, two_factor_secret, two_factor_enabled_at
         FROM public.users
        WHERE LOWER(BTRIM(admin_id)) = LOWER($1)
        LIMIT 1`,
      [adminId],
    );

    const user = result.rows[0];

    // Use a generic credential error to avoid revealing which identity exists.
    if (!user || !user.password_hash) {
      return sendError(
        res,
        401,
        "Invalid Admin ID or password.",
        "ADMIN_LOGIN_FAILED",
      );
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatches) {
      return sendError(
        res,
        401,
        "Invalid Admin ID or password.",
        "ADMIN_LOGIN_FAILED",
      );
    }

    if (!isAdminAccount(user)) {
      return sendError(
        res,
        403,
        "This account is not authorized for DocuGuard Admin.",
        "ADMIN_ACCESS_REQUIRED",
      );
    }

    if (user.two_factor_secret && user.two_factor_enabled_at) {
      if (!totpCode) {
        return res.status(200).json({
          requiresTwoFactor: true,
          user: { id: user.id, name: user.name },
        });
      }

      let validCode = false;
      try {
        validCode = verifyTOTP(user.two_factor_secret, totpCode) === true;
      } catch {
        validCode = false;
      }

      if (!validCode) {
        return sendError(
          res,
          401,
          "Invalid verification code.",
          "ADMIN_LOGIN_FAILED",
        );
      }
    }

    const pendingToken = crypto.randomBytes(32).toString("base64url");

    await db.query(
      `INSERT INTO public.admin_login_attempts
         (user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '5 minutes')`,
      [user.id, hashToken(pendingToken)],
    );

    return res.status(200).json({
      pendingToken,
      expiresIn: PENDING_LOGIN_SECONDS,
      user: { id: user.id, name: user.name },
      requiresDeviceVerification: true,
    });
  } catch {
    return sendError(
      res,
      503,
      "Administrator authentication is temporarily unavailable.",
      "ADMIN_AUTH_UNAVAILABLE",
    );
  }
};

// Stage 2: Create a short-lived challenge for a previously provisioned device.
// The pending token is not a session JWT.
exports.createChallenge = async (req, res) => {
  const pendingToken = req.body?.pendingToken;
  const deviceId = req.body?.deviceId;

  if (!validOpaqueToken(pendingToken) || !validDeviceId(deviceId)) {
    return sendError(
      res,
      400,
      "Invalid pending login or device.",
      "ADMIN_CHALLENGE_INVALID",
    );
  }

  let outcome;

  try {
    outcome = await db.withTransaction(async (client) => {
      const result = await client.query(
        `SELECT a.id AS attempt_id, a.user_id, a.expires_at, a.used_at,
                u.role, u.admin_id, u.is_verified
           FROM public.admin_login_attempts a
           JOIN public.users u ON u.id = a.user_id
          WHERE a.token_hash = $1
          FOR UPDATE OF a, u`,
        [hashToken(pendingToken)],
      );

      const attempt = result.rows[0];
      if (
        !attempt ||
        attempt.used_at ||
        isExpired(attempt.expires_at) ||
        !isAdminAccount(attempt)
      ) {
        return { failure: "pending" };
      }

      const deviceResult = await client.query(
        `SELECT id
           FROM public.admin_devices
          WHERE id = $1
            AND user_id = $2
            AND revoked_at IS NULL
          FOR UPDATE`,
        [String(deviceId), attempt.user_id],
      );

      if (deviceResult.rows.length === 0) {
        return { failure: "device" };
      }

      const challengeId = crypto.randomUUID();
      const challengeValue = crypto.randomBytes(32).toString("base64url");

      // Keep only the newest challenge active for this login attempt.
      await client.query(
        `UPDATE public.admin_device_challenges
            SET used_at = NOW()
          WHERE login_attempt_id = $1
            AND used_at IS NULL`,
        [attempt.attempt_id],
      );

      await client.query(
        `INSERT INTO public.admin_device_challenges
           (challenge_id, user_id, device_id, login_attempt_id,
            challenge_value, expires_at)
         VALUES ($1, $2, $3, $4, $5, NOW() + INTERVAL '90 seconds')`,
        [
          challengeId,
          attempt.user_id,
          String(deviceId),
          attempt.attempt_id,
          challengeValue,
        ],
      );

      return {
        challengeId,
        challenge: challengeValue,
        expiresIn: CHALLENGE_SECONDS,
      };
    });
  } catch (err) {
    console.error("CREATE CHALLENGE ERROR:", err);
    return sendError(
      res,
      503,
      "Administrator device verification is temporarily unavailable.",
      "ADMIN_AUTH_UNAVAILABLE",
    );
  }

  if (outcome?.failure === "pending") {
    return sendError(
      res,
      401,
      "Pending login is invalid or expired.",
      "ADMIN_PENDING_LOGIN_INVALID",
    );
  }

  if (outcome?.failure === "device") {
    return sendError(
      res,
      403,
      "This device is not authorized.",
      "ADMIN_DEVICE_NOT_AUTHORIZED",
    );
  }

  return res.status(200).json(outcome);
};
// Stage 3: Verify the signature and atomically consume the challenge and attempt.
// The session JWT is issued only after the transaction commits successfully.
exports.verifyDevice = async (req, res) => {
  const pendingToken = req.body?.pendingToken;
  const challengeId = req.body?.challengeId;
  const deviceId = req.body?.deviceId;
  const signature = req.body?.signature;

  if (
    !validOpaqueToken(pendingToken) ||
    typeof challengeId !== "string" ||
    challengeId.length < 16 ||
    challengeId.length > 128 ||
    !validDeviceId(deviceId) ||
    !validSignature(signature)
  ) {
    return sendError(
      res,
      400,
      "Invalid device verification request.",
      "ADMIN_DEVICE_PROOF_INVALID",
    );
  }

  const jwtSecret = process.env.JWT_SECRET;
  if (
    typeof jwtSecret !== "string" ||
    jwtSecret.length < 32 ||
    jwtSecret.trim().length === 0
  ) {
    return sendError(
      res,
      503,
      "Administrator session creation is temporarily unavailable.",
      "ADMIN_AUTH_UNAVAILABLE",
    );
  }

  let verifiedAccount;

  try {
    verifiedAccount = await db.withTransaction(async (client) => {
      const attemptResult = await client.query(
        `SELECT a.id AS attempt_id, a.user_id, a.expires_at, a.used_at,
                u.email, u.name, u.role, u.admin_id, u.is_verified
           FROM public.admin_login_attempts a
           JOIN public.users u ON u.id = a.user_id
          WHERE a.token_hash = $1
          FOR UPDATE OF a, u`,
        [hashToken(pendingToken)],
      );

      const attempt = attemptResult.rows[0];
      if (
        !attempt ||
        attempt.used_at ||
        isExpired(attempt.expires_at) ||
        !isAdminAccount(attempt)
      ) {
        return { failure: "pending" };
      }

      const deviceResult = await client.query(
        `SELECT id, public_key_pem, key_algorithm
           FROM public.admin_devices
          WHERE id = $1
            AND user_id = $2
            AND revoked_at IS NULL
          FOR UPDATE`,
        [String(deviceId), attempt.user_id],
      );

      const device = deviceResult.rows[0];
      if (!device) {
        return { failure: "device" };
      }

      const challengeResult = await client.query(
        `SELECT challenge_id, challenge_value, expires_at, used_at
           FROM public.admin_device_challenges
          WHERE challenge_id = $1
            AND user_id = $2
            AND device_id = $3
            AND login_attempt_id = $4
          FOR UPDATE`,
        [challengeId, attempt.user_id, String(deviceId), attempt.attempt_id],
      );

      const challenge = challengeResult.rows[0];
      if (!challenge || challenge.used_at || isExpired(challenge.expires_at)) {
        return { failure: "challenge" };
      }

      let signatureValid = false;
      try {
        const publicKey = crypto.createPublicKey(device.public_key_pem);
        const keyDetails = publicKey.asymmetricKeyDetails;
        const expectedKey =
          device.key_algorithm === "ECDSA_P256_SHA256" &&
          publicKey.asymmetricKeyType === "ec" &&
          keyDetails?.namedCurve === "prime256v1";

        if (expectedKey) {
          signatureValid = crypto.verify(
            "sha256",
            Buffer.from(challenge.challenge_value, "utf8"),
            publicKey,
            Buffer.from(signature, "base64"),
          );
        }
      } catch {
        signatureValid = false;
      }

      if (!signatureValid) {
        const rejectedChallenge = await client.query(
          `UPDATE public.admin_device_challenges
      SET used_at = NOW()
    WHERE challenge_id = $1
      AND user_id = $2
      AND device_id = $3
      AND login_attempt_id = $4
      AND used_at IS NULL
      AND expires_at > NOW()
    RETURNING challenge_id`,
          [challengeId, attempt.user_id, String(deviceId), attempt.attempt_id],
        );

        if (rejectedChallenge.rowCount !== 1) {
          throw new Error(
            "Rejected challenge consumption failed unexpectedly.",
          );
        }

        return { failure: "signature" };
      }

      const consumedChallenge = await client.query(
        `UPDATE public.admin_device_challenges
      SET used_at = NOW()
    WHERE challenge_id = $1
      AND user_id = $2
      AND device_id = $3
      AND login_attempt_id = $4
      AND used_at IS NULL
      AND expires_at > NOW()
    RETURNING challenge_id`,
        [challengeId, attempt.user_id, String(deviceId), attempt.attempt_id],
      );

      if (consumedChallenge.rowCount !== 1) {
        throw new Error("Challenge consumption failed unexpectedly.");
      }

      const consumedAttempt = await client.query(
        `UPDATE public.admin_login_attempts
            SET used_at = NOW()
          WHERE id = $1
            AND used_at IS NULL
            AND expires_at > NOW()
          RETURNING id`,
        [attempt.attempt_id],
      );

      if (consumedAttempt.rowCount !== 1) {
        throw new Error("Pending login consumption failed unexpectedly.");
      }

      const deviceUpdate = await client.query(
        `UPDATE public.admin_devices
            SET last_used_at = NOW()
          WHERE id = $1
            AND user_id = $2
            AND revoked_at IS NULL
          RETURNING id`,
        [String(deviceId), attempt.user_id],
      );

      if (deviceUpdate.rowCount !== 1) {
        throw new Error("Authorized device update failed unexpectedly.");
      }

      return {
        userId: attempt.user_id,
        deviceId: String(deviceId),
        email: attempt.email,
        name: attempt.name,
      };
    });
  } catch {
    return sendError(
      res,
      503,
      "Administrator verification is temporarily unavailable.",
      "ADMIN_AUTH_UNAVAILABLE",
    );
  }

  if (verifiedAccount?.failure === "device") {
    return sendError(
      res,
      403,
      "This device is not authorized.",
      "ADMIN_DEVICE_NOT_AUTHORIZED",
    );
  }

  if (verifiedAccount?.failure === "signature") {
    return sendError(
      res,
      401,
      "Device verification failed.",
      "ADMIN_DEVICE_PROOF_INVALID",
    );
  }

  if (verifiedAccount?.failure) {
    return sendError(
      res,
      401,
      "Verification is invalid or expired. Start again.",
      "ADMIN_DEVICE_PROOF_INVALID",
    );
  }

  try {
    const token = jwt.sign(
      {
        userId: verifiedAccount.userId,
        role: "admin",
        deviceId: verifiedAccount.deviceId,
      },
      jwtSecret,
      { expiresIn: ADMIN_SESSION_SECONDS },
    );

    return res.status(200).json({
      token,
      expiresIn: ADMIN_SESSION_SECONDS,
      user: {
        id: verifiedAccount.userId,
        email: verifiedAccount.email,
        name: verifiedAccount.name,
      },
    });
  } catch (err) {
    console.error("VERIFY DEVICE ERROR:", err);
    return sendError(
      res,
      503,
      "Administrator verification is temporarily unavailable.",
      "ADMIN_AUTH_UNAVAILABLE",
    );
  }
};
