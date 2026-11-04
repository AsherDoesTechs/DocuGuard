const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const db = require("../config/db");
const { AppError, ErrorCodes } = require("../utils/errors");
const { verifyTOTP } = require("../utils/totp");
const { verifyRecoveryCode } = require("../utils/twoFactorRecovery");
const { createSession, revokeSession } = require("../services/sessionService");
const { debug, info, warn, error: logError } = require("../utils/debugLogger");
const {
  sendVerificationEmail,
  sendPasswordResetEmail,
  APP_DEEPLINK_SCHEME,
  buildVerificationLink,
  buildPasswordResetLink,
  escapeHtml,
} = require("../config/email");
const {
  registerSchema,
  loginSchema,
  verifyEmailSchema,
  resendVerificationSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  checkEmailSchema,
  updateFcmTokenSchema,
  validateSchema,
} = require("../../shared/validation/schemas");

// 1. Registration
exports.register = async (req, res, next) => {
  const validation = validateSchema(registerSchema, req.body);
  if (!validation.success) {
    return res.status(400).json({
      error: Object.values(validation.errors).join(", "),
      code: ErrorCodes.AUTH_REGISTER_FAILED,
      details: validation.errors,
    });
  }

  const { name, email, password } = validation.data;

  try {
    debug("Auth", "Registration attempt", { email });

    const existingUser = await db.query(
      "SELECT id FROM users WHERE email = $1",
      [email],
    );
    if (existingUser.rows.length > 0) {
      warn("Auth", "Duplicate registration attempt", { email });
      return res.status(400).json({
        error: "Email is already registered.",
        code: ErrorCodes.AUTH_REGISTER_FAILED,
      });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const verificationToken = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const result = await db.query(
      `INSERT INTO users (name, email, password_hash, verification_token, verification_expires_at, is_verified) 
       VALUES ($1, $2, $3, $4, $5, FALSE) 
       RETURNING id, email, name`,
      [
        name.trim() || "User",
        email.trim().toLowerCase(),
        passwordHash,
        verificationToken,
        expiresAt,
      ],
    );

    const newUser = result.rows[0];
    info("Auth", "User registered", {
      userId: newUser.id,
      email: newUser.email,
    });

    let emailSent = true;

    try {
      await sendVerificationEmail(
        newUser.email,
        newUser.name,
        verificationToken,
      );
      debug("Auth", "Verification email sent", {
        to: newUser.email,
        userId: newUser.id,
      });
    } catch (mailErr) {
      emailSent = false;
      logError(
        "Auth",
        "Failed to send verification email",
        {
          email: newUser.email,
          userId: newUser.id,
          error: mailErr.message,
        },
        ErrorCodes.UNKNOWN_ERROR,
      );
    }

    res.status(201).json({
      message:
        "User registered successfully. Please check your email to verify your account.",
      user: { id: newUser.id, email: newUser.email, name: newUser.name },
      emailSent,
    });
  } catch (err) {
    logError(
      "Auth",
      "Registration error",
      { error: err.message, stack: err.stack, body: req.body },
      ErrorCodes.AUTH_REGISTER_FAILED,
    );
    return next(
      new AppError(
        "Registration failed due to server error",
        500,
        "AUTH_REGISTER_FAILED",
      ),
    );
  }
};

// 2. Login
const createLoginHandler =
  (requireAdmin = false) =>
  async (req, res, next) => {
    const validation = validateSchema(loginSchema, req.body);

    if (!validation.success) {
      return res.status(400).json({
        error: Object.values(validation.errors).join(", "),
        code: ErrorCodes.AUTH_LOGIN_FAILED,
        details: validation.errors,
      });
    }

    const { email, password } = validation.data;

    try {
      debug("Auth", requireAdmin ? "Admin login attempt" : "Login attempt", {
        email,
      });

      const { rows } = await db.query(
        "SELECT * FROM public.users WHERE email = $1",
        [email.trim().toLowerCase()],
      );

      if (rows.length === 0) {
        warn("Auth", "Login failed - user not found", { email });
        return res.status(401).json({
          error: "Invalid credentials",
          code: ErrorCodes.AUTH_LOGIN_FAILED,
        });
      }

      const user = rows[0];
      const isMatch = await bcrypt.compare(password, user.password_hash);

      if (!isMatch) {
        warn("Auth", "Login failed - password mismatch", { email });
        return res.status(401).json({
          error: "Invalid credentials",
          code: ErrorCodes.AUTH_LOGIN_FAILED,
        });
      }

      if (!user.is_verified) {
        return res.status(403).json({
          error: "Please verify your email address before logging in.",
          code: "AUTH_EMAIL_NOT_VERIFIED",
        });
      }

      // Enforce 2FA before issuing a token or creating a login session.
      if (user.two_factor === true && user.two_factor_enabled_at) {
        const totpCode =
          typeof req.body.totpCode === "string" ? req.body.totpCode.trim() : "";
        const recoveryCode =
          typeof req.body.recoveryCode === "string"
            ? req.body.recoveryCode.trim()
            : "";

        if (totpCode && recoveryCode) {
          return res.status(400).json({
            error: "Submit either an authenticator code or a recovery code.",
            code: ErrorCodes.AUTH_LOGIN_FAILED,
          });
        }

        if (!totpCode && !recoveryCode) {
          return res.status(200).json({
            requiresTwoFactor: true,
            user: { id: user.id, email: user.email, name: user.name },
          });
        }

        if (totpCode) {
          const isValidCode = verifyTOTP(user.two_factor_secret, totpCode);

          if (!isValidCode) {
            warn("Auth", "Login failed - invalid 2FA code", {
              userId: user.id,
            });

            return res.status(401).json({
              error: "Invalid verification code.",
              code: ErrorCodes.AUTH_LOGIN_FAILED,
            });
          }
        } else {
          if (requireAdmin) {
            return res.status(401).json({
              error: "Invalid verification code.",
              code: ErrorCodes.AUTH_LOGIN_FAILED,
            });
          }

          const recoveryCodeConsumed = await db.withTransaction(
            async (client) => {
              const result = await client.query(
                `SELECT id, code_hash
                 FROM public.user_two_factor_recovery_codes
                 WHERE user_id = $1 AND used_at IS NULL
                 ORDER BY id
                 FOR UPDATE`,
                [user.id],
              );

              const hashes = result.rows.map((row) => row.code_hash);
              const matchedIndex = await verifyRecoveryCode(
                recoveryCode,
                hashes,
              );

              if (matchedIndex < 0) return false;

              const matchedRow = result.rows[matchedIndex];
              const consumed = await client.query(
                `UPDATE public.user_two_factor_recovery_codes
                 SET used_at = NOW()
                 WHERE id = $1 AND used_at IS NULL`,
                [matchedRow.id],
              );

              return consumed.rowCount === 1;
            },
          );

          if (!recoveryCodeConsumed) {
            warn("Auth", "Login failed - invalid recovery code", {
              userId: user.id,
            });

            return res.status(401).json({
              error: "Invalid verification code.",
              code: ErrorCodes.AUTH_LOGIN_FAILED,
            });
          }
        }
      }

      let role = user.role || "user";

      if (requireAdmin) {
        let roleResult;

        try {
          // Read the current role from the database; never trust a submitted
          // role or an older token claim for administrator authorization.
          roleResult = await db.query(
            "SELECT role FROM public.users WHERE id = $1 LIMIT 1",
            [user.id],
          );
        } catch (roleError) {
          console.error("Admin login role verification failed.");

          return res.status(503).json({
            error: "Administrator authorization is temporarily unavailable.",
            code: "ADMIN_AUTH_UNAVAILABLE",
          });
        }

        if (
          roleResult.rows.length === 0 ||
          roleResult.rows[0].role !== "admin"
        ) {
          return res.status(403).json({
            error: "Administrator access required.",
            code: "ADMIN_ACCESS_REQUIRED",
          });
        }

        role = "admin";
      }

      const token = jwt.sign(
        { userId: user.id, role },
        process.env.JWT_SECRET,
        { expiresIn: "7d" },
      );

      const decodedToken = jwt.decode(token);

      await createSession({
        userId: user.id,
        token,
        expiresAt: decodedToken.exp * 1000,
        deviceName: req.headers["user-agent"] || null,
        platform: req.headers["x-platform"] || null,
        ipAddress: req.ip || null,
      });

      info(
        "Auth",
        requireAdmin ? "Admin login successful" : "Login successful",
        {
          userId: user.id,
          email: user.email,
        },
      );

      return res.json({
        token,
        user: { id: user.id, email: user.email, name: user.name },
      });
    } catch (err) {
      logError(
        "Auth",
        requireAdmin ? "Admin login error" : "Login error",
        { error: err.message, stack: err.stack },
        ErrorCodes.AUTH_LOGIN_FAILED,
      );

      return next(
        new AppError(
          requireAdmin
            ? "Admin login failed due to server error"
            : "Login failed due to server error",
          500,
          "AUTH_LOGIN_FAILED",
        ),
      );
    }
  };

exports.login = createLoginHandler(false);
exports.adminLogin = createLoginHandler(true);
// 3. Check Email Availability
exports.checkEmail = async (req, res) => {
  try {
    const validation = validateSchema(checkEmailSchema, req.query);
    if (!validation.success) {
      return res.status(400).json({
        error: Object.values(validation.errors).join(", "),
        code: ErrorCodes.DOC_VALIDATION,
        details: validation.errors,
      });
    }

    const { email } = validation.data;

    const result = await db.query("SELECT id FROM users WHERE email = $1", [
      email.trim().toLowerCase(),
    ]);
    return res.json({ exists: result.rows.length > 0 });
  } catch (err) {
    logError(
      "Auth",
      "Database error checking email",
      { error: err.message, stack: err.stack },
      ErrorCodes.DB_QUERY_FAILED,
    );
    return res.status(500).json({
      error: "Internal server error",
      code: ErrorCodes.DB_QUERY_FAILED,
    });
  }
};

// 4a. Verify Email (API / Deep Link)

exports.verifyEmail = async (req, res, next) => {
  const validation = validateSchema(verifyEmailSchema, req.body);

  if (!validation.success) {
    return res.status(400).json({
      error: Object.values(validation.errors).join(", "),
      code: ErrorCodes.AUTH_TOKEN_INVALID,
      details: validation.errors,
    });
  }

  const { token } = validation.data;

  try {
    debug("Auth", "Email verification attempt", {
      tokenLength: token?.length,
    });

    // Atomically verify the account and consume the token.
    // A token can succeed only once and only before expiration.
    const result = await db.query(
      `UPDATE users
       SET is_verified = TRUE,
           verification_token = NULL,
           verification_expires_at = NULL
       WHERE verification_token = $1
         AND verification_expires_at > NOW()
         AND is_verified = FALSE
       RETURNING id, email, role`,
      [token],
    );

    if (result.rows.length === 0) {
      warn("Auth", "Invalid, expired, or already-used verification token", {
        tokenLength: token?.length,
      });

      return res.status(400).json({
        error:
          "This verification link is invalid, expired, or has already been used. Please sign in or request a new verification email.",
        code: ErrorCodes.AUTH_TOKEN_INVALID,
      });
    }

    const user = result.rows[0];

    const authToken = jwt.sign(
      {
        userId: user.id,
        role: user.role || "user",
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" },
    );

    const decodedAuthToken = jwt.decode(authToken);

    if (!decodedAuthToken || typeof decodedAuthToken.exp !== "number") {
      throw new Error("Could not determine email-verification session expiry.");
    }

    await createSession({
      userId: user.id,
      token: authToken,
      expiresAt: decodedAuthToken.exp * 1000,
      deviceName: req.headers?.["user-agent"] || null,
      platform: req.headers?.["x-platform"] || null,
      ipAddress: req.ip || null,
    });

    info("Auth", "Email verified successfully", {
      userId: user.id,
      email: user.email,
    });

    return res.json({
      message: "Email verified successfully!",
      token: authToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role || "user",
      },
    });
  } catch (err) {
    logError(
      "Auth",
      "Email verification error",
      { error: err.message, stack: err.stack },
      ErrorCodes.UNKNOWN_ERROR,
    );

    return next(
      new AppError(
        "Internal server error during verification",
        500,
        "AUTH_VERIFY_FAILED",
      ),
    );
  }
};

// 4b. Verify Email via Web Link

exports.verifyEmailWeb = async (req, res) => {
  const rawToken = req.query.token;
  const token = typeof rawToken === "string" ? rawToken.trim() : "";

  const appLoginLink = `${APP_DEEPLINK_SCHEME}://login`;

  const renderPage = ({
    title,
    heading,
    message,
    type = "success",
    buttonText = "Continue to DocuGuard",
    buttonLink = appLoginLink,
    statusCode = 200,
  }) => {
    const isSuccess = type === "success";
    const isWarning = type === "warning";

    const iconBackground = isSuccess
      ? "#DCFCE7"
      : isWarning
        ? "#FEF3C7"
        : "#FEE2E2";

    const iconColor = isSuccess ? "#16A34A" : isWarning ? "#D97706" : "#DC2626";

    const icon = isSuccess ? "&#10003;" : isWarning ? "&#9888;" : "!";

    return res.status(statusCode).send(`
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <meta name="robots" content="noindex, nofollow">
          <meta name="referrer" content="no-referrer">
          <title>${escapeHtml(title)} - DocuGuard</title>
        </head>
        <body style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;text-align:center;padding:50px 20px;background:#f3f4f6;box-sizing:border-box;">
          <main style="max-width:420px;margin:0 auto;background:#fff;border-radius:16px;padding:36px 28px;box-shadow:0 8px 32px rgba(0,0,0,0.08);">
            <div style="width:72px;height:72px;background:${iconBackground};border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;font-size:32px;font-weight:700;color:${iconColor};">
              ${icon}
            </div>
            <h1 style="margin:0 0 12px;color:#111827;font-size:24px;font-weight:700;">
              ${escapeHtml(heading)}
            </h1>
            <p style="margin:0 0 24px;color:#6B7280;font-size:16px;line-height:1.6;">
              ${message}
            </p>
            <a href="${escapeHtml(buttonLink)}"
               style="display:inline-block;padding:14px 24px;background:#2563EB;color:#fff;text-decoration:none;border-radius:10px;font-size:15px;font-weight:600;">
              ${escapeHtml(buttonText)}
            </a>
          </main>
        </body>
      </html>
    `);
  };

  if (!token) {
    return renderPage({
      title: "Invalid Verification Link",
      heading: "Invalid Verification Link",
      message:
        "This verification link is missing its required token. Please open the latest verification email or request a new link.",
      type: "error",
      buttonText: "Open DocuGuard",
      statusCode: 400,
    });
  }

  try {
    // Verify and consume the token in one database operation.
    // This also prevents concurrent requests from using the same token.
    const result = await db.query(
      `UPDATE users
       SET is_verified = TRUE,
           verification_token = NULL,
           verification_expires_at = NULL
       WHERE verification_token = $1
         AND verification_expires_at > NOW()
         AND is_verified = FALSE
       RETURNING id, email, name`,
      [token],
    );

    if (result.rows.length === 0) {
      // The token may be invalid, expired, or already consumed.
      // Do not attempt to reuse it or issue a session from this page.
      return renderPage({
        title: "Link Invalid or Expired",
        heading: "Link Invalid or Expired",
        message:
          "This verification link is invalid, has expired, or has already been used. If you have already verified your email, you can sign in to DocuGuard. Otherwise, request a new verification email.",
        type: "warning",
        buttonText: "Open DocuGuard",
        statusCode: 400,
      });
    }

    const user = result.rows[0];
    const displayName = escapeHtml(user.name || "there");

    info("Auth", "Email verified through web link", {
      userId: user.id,
      email: user.email,
    });

    return renderPage({
      title: "Email Verified",
      heading: "Email Verified!",
      message: `Welcome, <strong style="color:#111827;">${displayName}</strong>! Your email has been verified successfully. You can now sign in to your DocuGuard account.`,
      type: "success",
      buttonText: "Continue to DocuGuard",
    });
  } catch (err) {
    logError(
      "Auth",
      "Web email verification error",
      { error: err.message, stack: err.stack },
      ErrorCodes.UNKNOWN_ERROR,
    );

    return renderPage({
      title: "Verification Error",
      heading: "Verification Error",
      message:
        "We couldn't complete your email verification because of a server error. Please try again later.",
      type: "error",
      buttonText: "Open DocuGuard",
      statusCode: 500,
    });
  }
};

exports.resendVerification = async (req, res) => {
  const validation = validateSchema(resendVerificationSchema, req.body);
  if (!validation.success) {
    return res.status(400).json({
      error: Object.values(validation.errors).join(", "),
      code: ErrorCodes.AUTH_REGISTER_FAILED,
      details: validation.errors,
    });
  }

  const { email } = validation.data;

  try {
    const result = await db.query(
      "SELECT id, name, is_verified FROM users WHERE email = $1",
      [email.trim().toLowerCase()],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found with this email." });
    }

    const user = result.rows[0];
    if (user.is_verified) {
      return res.status(400).json({ error: "Email is already verified." });
    }

    const verificationToken = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await db.query(
      "UPDATE users SET verification_token = $1, verification_expires_at = $2 WHERE id = $3",
      [verificationToken, expiresAt, user.id],
    );

    try {
      await sendVerificationEmail(
        email,
        user.name || "there",
        verificationToken,
      );
      info("Auth", "Verification email resent", {
        to: email,
        userId: user.id,
      });
    } catch (mailErr) {
      logError(
        "Auth",
        "Failed to resend verification email",
        { email, userId: user.id, error: mailErr.message },
        ErrorCodes.UNKNOWN_ERROR,
      );
      return res.status(500).json({
        error:
          "Failed to resend verification email. Please check your Resend configuration and try again later.",
        code: ErrorCodes.UNKNOWN_ERROR,
      });
    }

    return res.json({ message: "Verification link resent successfully!" });
  } catch (err) {
    logError(
      "Auth",
      "Resend verification error",
      { error: err.message, stack: err.stack },
      ErrorCodes.UNKNOWN_ERROR,
    );
    return res
      .status(500)
      .json({ error: "Failed to resend verification link." });
  }
};

// 6. Request Password Reset
exports.forgotPassword = async (req, res) => {
  const validation = validateSchema(forgotPasswordSchema, req.body);
  if (!validation.success) {
    return res.status(400).json({
      error: Object.values(validation.errors).join(", "),
      code: ErrorCodes.AUTH_LOGIN_FAILED,
      details: validation.errors,
    });
  }

  const { email } = validation.data;

  try {
    const { rows } = await db.query("SELECT id FROM users WHERE email = $1", [
      email.trim().toLowerCase(),
    ]);

    // Always return success to prevent email enumeration
    if (rows.length === 0) {
      return res.json({
        message: "If that email exists, reset instructions have been sent.",
      });
    }

    const resetToken = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await db.query(
      "INSERT INTO password_resets (email, token, expires_at) VALUES ($1, $2, $3)",
      [email.trim().toLowerCase(), resetToken, expiresAt],
    );

    try {
      await sendPasswordResetEmail(email, resetToken);
      info("Auth", "Password reset email sent", { to: email });
    } catch (mailErr) {
      logError(
        "Auth",
        "Failed to send password reset email",
        { email, error: mailErr.message },
        ErrorCodes.UNKNOWN_ERROR,
      );
      return res.status(500).json({
        error: "Failed to send password reset email. Please try again later.",
      });
    }

    res.json({ message: "Password reset instructions sent successfully" });
  } catch (err) {
    logError(
      "Auth",
      "Password reset error",
      { error: err.message, stack: err.stack },
      ErrorCodes.UNKNOWN_ERROR,
    );
    res.status(500).json({ error: "Password reset failed" });
  }
};

// 7. Reset Password (API / Deep Link)
exports.resetPassword = async (req, res) => {
  const validation = validateSchema(resetPasswordSchema, req.body);
  if (!validation.success) {
    return res.status(400).json({
      error: Object.values(validation.errors).join(", "),
      code: ErrorCodes.AUTH_LOGIN_FAILED,
      details: validation.errors,
    });
  }

  const { token, newPassword } = validation.data;

  try {
    // The password change and the token consumption MUST commit together.
    // Running them as separate autocommit statements let a consumed-but-still-
    // valid token overwrite the password a second time.
    const result = await db.withTransaction(async (client) => {
      // Re-check and lock the row inside the transaction so two concurrent
      // resets using the same token cannot both win.
      const resetRes = await client.query(
        `SELECT id, email FROM password_resets
          WHERE token = $1 AND expires_at > NOW() AND used = FALSE
          FOR UPDATE`,
        [token],
      );

      if (resetRes.rows.length === 0) {
        return null;
      }

      const resetRecord = resetRes.rows[0];
      const salt = await bcrypt.genSalt(12);
      const passwordHash = await bcrypt.hash(newPassword, salt);

      await client.query(
        "UPDATE users SET password_hash = $1 WHERE email = $2",
        [passwordHash, resetRecord.email],
      );
      await client.query(
        "UPDATE password_resets SET used = TRUE WHERE id = $1",
        [resetRecord.id],
      );

      return resetRecord;
    });

    if (!result) {
      return res
        .status(400)
        .json({ error: "Invalid or expired password reset link." });
    }

    return res.json({ message: "Password updated successfully!" });
  } catch (err) {
    console.error("Reset password error:", err);
    return res.status(500).json({ error: "Failed to reset password." });
  }
};

// 7b. Reset Password via Web Link
exports.resetPasswordWeb = async (req, res) => {
  const { token } = req.query;

  if (!token) {
    return res.status(400).send(`
      <html>
        <head>
          <title>Invalid Link - DocuGuard</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; text-align: center; padding: 50px 20px; background-color: #f3f4f6;">
          <div style="max-width: 400px; margin: 0 auto; background: #ffffff; border-radius: 16px; padding: 40px; box-shadow: 0 8px 32px rgba(0,0,0,0.08);">
            <div style="width: 80px; height: 80px; background: #FEE2E2; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 20px; font-size: 32px; font-weight: 700; color: #DC2626;">!</div>
            <h1 style="margin: 0 0 12px; color: #111827; font-size: 24px; font-weight: 700;">Invalid Reset Link</h1>
            <p style="margin: 0; color: #6B7280; font-size: 16px;">This password reset link is missing the required token.</p>
          </div>
        </body>
      </html>
    `);
  }

  try {
    const result = await db.query(
      "SELECT id, email FROM password_resets WHERE token = $1 AND expires_at > NOW() AND used = FALSE",
      [token],
    );

    if (result.rows.length === 0) {
      return res.status(400).send(`
        <html>
          <head>
            <title>Invalid Link - DocuGuard</title>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
          </head>
          <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; text-align: center; padding: 50px 20px; background-color: #f3f4f6;">
            <div style="max-width: 400px; margin: 0 auto; background: #ffffff; border-radius: 16px; padding: 40px; box-shadow: 0 8px 32px rgba(0,0,0,0.08);">
              <div style="width: 80px; height: 80px; background: #FEE2E2; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 20px; font-size: 32px; font-weight: 700; color: #DC2626;">!</div>
              <h1 style="margin: 0 0 12px; color: #111827; font-size: 24px; font-weight: 700;">Invalid or Expired Link</h1>
              <p style="margin: 0; color: #6B7280; font-size: 16px;">This password reset link is invalid or has expired.</p>
            </div>
          </body>
        </html>
      `);
    }

    const resetRecord = result.rows[0];

    // Show a simple page that redirects to the app deep link
    const deepLink = buildPasswordResetLink(token);

    return res.send(`
      <html>
        <head>
          <title>Reset Your Password - DocuGuard</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; text-align: center; padding: 50px 20px; background-color: #f3f4f6;">
          <div style="max-width: 400px; margin: 0 auto; background: #ffffff; border-radius: 16px; padding: 40px; box-shadow: 0 8px 32px rgba(0,0,0,0.08);">
            <div style="width: 80px; height: 80px; background: #FEF3C7; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 20px; font-size: 32px; font-weight: 700; color: #F59E0B;">&#9889;</div>
            <h1 style="margin: 0 0 12px; color: #111827; font-size: 24px; font-weight: 700;">Reset Your Password</h1>
            <p style="margin: 0 0 24px; color: #6B7280; font-size: 16px;">Click the button below to open the DocuGuard app and create a new password.</p>
            <a href="${deepLink}" style="display: inline-block; padding: 14px 28px; background: linear-gradient(135deg, #DC2626 0%, #B91C1C 100%); color: #ffffff; text-decoration: none; border-radius: 10px; font-size: 15px; font-weight: 600;">Open in DocuGuard App</a>
            <p style="margin: 20px 0 0; color: #9CA3AF; font-size: 13px;">If the app doesn't open, copy this link into your browser:<br><code style="word-break: break-all; font-size: 12px; color: #DC2626;">${deepLink}</code></p>
          </div>
        </body>
      </html>
    `);
  } catch (err) {
    logError(
      "Auth",
      "Web password reset error",
      { error: err.message, stack: err.stack },
      ErrorCodes.UNKNOWN_ERROR,
    );
    return res.status(500).send(`
      <html>
        <head>
          <title>Error - DocuGuard</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; text-align: center; padding: 50px 20px; background-color: #f3f4f6;">
          <div style="max-width: 400px; margin: 0 auto; background: #ffffff; border-radius: 16px; padding: 40px; box-shadow: 0 8px 32px rgba(0,0,0,0.08);">
            <div style="width: 80px; height: 80px; background: #FEE2E2; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 20px; font-size: 32px; font-weight: 700; color: #DC2626;">!</div>
            <h1 style="margin: 0 0 12px; color: #111827; font-size: 24px; font-weight: 700;">Reset Error</h1>
            <p style="margin: 0; color: #6B7280; font-size: 16px;">An error occurred. Please try again later.</p>
          </div>
        </body>
      </html>
    `);
  }
};

/**
 * Revoke the authenticated user's current bearer-token session.
 * Requires authMiddleware to have populated req.user.
 */
exports.logout = async (req, res, next) => {
  const userId = req.user?.userId;
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";

  if (!token || userId === undefined || userId === null) {
    return res.status(401).json({
      error: "Authentication required.",
      code: ErrorCodes.AUTH_REQUIRED,
    });
  }

  try {
    const revoked = await revokeSession({ userId, token });

    if (!revoked) {
      return res.status(401).json({
        error: "Session is not active.",
        code: ErrorCodes.AUTH_TOKEN_INVALID,
      });
    }

    return res.status(200).json({ message: "Signed out successfully." });
  } catch (err) {
    return next(err);
  }
};

// 8. Update FCM Token
exports.updateFcmToken = async (req, res) => {
  const validation = validateSchema(updateFcmTokenSchema, req.body);
  if (!validation.success) {
    return res.status(400).json({
      error: Object.values(validation.errors).join(", "),
      code: ErrorCodes.AUTH_LOGIN_FAILED,
      details: validation.errors,
    });
  }

  const { fcmToken } = validation.data;
  try {
    await db.query("UPDATE users SET fcm_token = $1 WHERE id = $2", [
      fcmToken,
      req.user.userId,
    ]);
    res.json({ message: "FCM token updated successfully" });
  } catch (err) {
    console.error("FCM update error:", err);
    res.status(500).json({ error: "Failed to update FCM token" });
  }
};
