const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const db = require("../config/db");
const { AppError, ErrorCodes } = require("../utils/errors");
const { debug, info, warn, error: logError } = require("../utils/debugLogger");
const {
  sendVerificationEmail,
  sendPasswordResetEmail,
  APP_DEEPLINK_SCHEME,
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
      await sendVerificationEmail(newUser.email, newUser.name, verificationToken);
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
      message: "User registered successfully. Please check your email to verify your account.",
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
exports.login = async (req, res, next) => {
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
    debug("Auth", "Login attempt", { email });

    const { rows } = await db.query("SELECT * FROM users WHERE email = $1", [
      email.trim().toLowerCase(),
    ]);
    if (rows.length === 0) {
      warn("Auth", "Login failed - user not found", { email });
      return res
        .status(401)
        .json({
          error: "Invalid credentials",
          code: ErrorCodes.AUTH_LOGIN_FAILED,
        });
    }

    const user = rows[0];

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      warn("Auth", "Login failed - password mismatch", { email });
      return res
        .status(401)
        .json({
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

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });

    info("Auth", "Login successful", { userId: user.id, email: user.email });

    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name },
    });
  } catch (err) {
    logError(
      "Auth",
      "Login error",
      { error: err.message, stack: err.stack },
      ErrorCodes.AUTH_LOGIN_FAILED,
    );
    return next(
      new AppError(
        "Login failed due to server error",
        500,
        "AUTH_LOGIN_FAILED",
      ),
    );
  }
};

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
    return res
      .status(500)
      .json({
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
    debug("Auth", "Email verification attempt", { tokenLength: token?.length });

    const result = await db.query(
      "SELECT id, email FROM users WHERE verification_token = $1 AND verification_expires_at > NOW()",
      [token],
    );

    if (result.rows.length === 0) {
      warn("Auth", "Invalid or expired verification token", {
        tokenLength: token?.length,
      });
      return res.status(400).json({
        error: "Invalid or expired verification token.",
        code: ErrorCodes.AUTH_TOKEN_INVALID,
      });
    }

    const user = result.rows[0];

    await db.query(
      "UPDATE users SET is_verified = TRUE, verification_token = NULL, verification_expires_at = NULL WHERE id = $1",
      [user.id],
    );

    const authToken = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });

    info("Auth", "Email verified successfully", {
      userId: user.id,
      email: user.email,
    });

    return res.json({
      message: "Email verified successfully!",
      token: authToken,
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
  const { token } = req.query;

  if (!token) {
    return res.status(400).send(`
      <html>
        <body style="font-family: Arial; text-align: center; padding: 50px;">
          <h2 style="color: #dc2626;">Invalid Verification Link</h2>
          <p>This verification link is missing the required token.</p>
        </body>
      </html>
    `);
  }

  try {
    const result = await db.query(
      "SELECT id, email, name FROM users WHERE verification_token = $1 AND verification_expires_at > NOW()",
      [token],
    );

    if (result.rows.length === 0) {
      return res.status(400).send(`
        <html>
          <body style="font-family: Arial; text-align: center; padding: 50px;">
            <h2 style="color: #dc2626;">Invalid or Expired Link</h2>
            <p>This link is invalid or has expired.</p>
          </body>
        </html>
      `);
    }

    const user = result.rows[0];

    await db.query(
      "UPDATE users SET is_verified = TRUE, verification_token = NULL, verification_expires_at = NULL WHERE id = $1",
      [user.id],
    );

    const deepLink = `${APP_DEEPLINK_SCHEME}://verify-email?token=${token}&verified=true`;

    return res.send(`
      <html>
        <head>
          <title>Email Verified - DocuGuard</title>
          <meta http-equiv="refresh" content="0; url=${deepLink}">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; text-align: center; padding: 0; margin: 0; background-color: #f3f4f6;">
          <table style="max-width: 520px; margin: 48px auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 8px 32px rgba(0,0,0,0.08);">
            <tr>
              <td style="padding: 48px 32px; text-align: center;">
                <div style="width: 80px; height: 80px; background: #DCFCE7; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 20px;">
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" stroke="#16A34A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    <path d="M9 12L11 14L15 10" stroke="#16A34A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </div>
                <h1 style="margin: 0 0 12px; color: #111827; font-size: 24px; font-weight: 700;">Email Verified!</h1>
                <p style="margin: 0 0 24px; color: #6B7280; font-size: 16px;">Welcome, <strong style="color: #111827;">${user.name}</strong>! Your email has been verified successfully.</p>
                <p style="margin: 0; color: #9CA3AF; font-size: 14px;">You'll be redirected to the app automatically.</p>
              </td>
            </tr>
            <tr>
              <td style="padding: 0 32px 32px; text-align: center;">
                <a href="${deepLink}" style="display: inline-block; padding: 14px 28px; background: linear-gradient(135deg, #2563EB 0%, #1d4ED8 100%); color: #ffffff; text-decoration: none; border-radius: 10px; font-size: 15px; font-weight: 600;">Continue to DocuGuard</a>
              </td>
            </tr>
          </table>
        </body>
      </html>
    `);
    } catch (err) {
      logError(
        "Auth",
        "Web email verification error",
        { error: err.message, stack: err.stack },
        ErrorCodes.UNKNOWN_ERROR,
      );
      return res.status(500).send("Verification Error");
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
      "SELECT id, is_verified FROM users WHERE email = $1",
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
      await sendVerificationEmail(email, user.name || "there", verificationToken);
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
        error: "Failed to resend verification email. Please check your Resend configuration and try again later.",
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
      return res
        .status(500)
        .json({ error: "Failed to send password reset email. Please try again later." });
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

// 7. Reset Password
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

  const client = (await db.getClient) ? await db.getClient() : null;

  try {
    const result = await db.query(
      "SELECT * FROM password_resets WHERE token = $1 AND expires_at > NOW() AND used = FALSE",
      [token],
    );

    if (result.rows.length === 0) {
      return res
        .status(400)
        .json({ error: "Invalid or expired password reset link." });
    }

    const resetRecord = result.rows[0];
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(newPassword, salt);

    if (client) await client.query("BEGIN");

    const queryDb = client || db;

    await queryDb.query(
      "UPDATE users SET password_hash = $1 WHERE email = $2",
      [passwordHash, resetRecord.email],
    );
    await queryDb.query(
      "UPDATE password_resets SET used = TRUE WHERE id = $1",
      [resetRecord.id],
    );

    if (client) await client.query("COMMIT");

    return res.json({ message: "Password updated successfully!" });
  } catch (err) {
    if (client) await client.query("ROLLBACK");
    console.error("Reset password error:", err);
    return res.status(500).json({ error: "Failed to reset password." });
  } finally {
    if (client) client.release();
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
