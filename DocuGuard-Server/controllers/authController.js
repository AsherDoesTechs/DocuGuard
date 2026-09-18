const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const db = require("../config/db");
const { AppError, ErrorCodes } = require("../utils/errors");
const { debug, info, warn, error: logError } = require("../utils/debugLogger");

// Configure Nodemailer transporter using your .env variables
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || "smtp.gmail.com",
  port: parseInt(process.env.EMAIL_PORT || "587"),
  secure: false, // true for 465, false for other ports
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// 1. Registration: Hash password, create verification token, save user, and send verification email
exports.register = async (req, res) => {
  const { name, email, password } = req.body;

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
      [name || "User", email, passwordHash, verificationToken, expiresAt],
    );

    const newUser = result.rows[0];
    info("Auth", "User registered", { userId: newUser.id, email: newUser.email });

    const verificationLink = `exp://localhost:8081/(auth)/verify-email?token=${verificationToken}`;

    try {
      await transporter.sendMail({
        from: `"DocuGuard System" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: "Verify Your Email - DocuGuard",
        html: `
          <h3>Welcome to DocuGuard, ${newUser.name}!</h3>
          <p>Please click the button below to verify your email address and activate your account:</p>
          <a href="${verificationLink}" style="padding: 10px 20px; background: #2563EB; color: #fff; text-decoration: none; border-radius: 5px; display: inline-block;">Verify Email</a>
          <p style="margin-top: 15px;">If the button doesn't work, copy and paste this link into your browser:</p>
          <p>${verificationLink}</p>
        `,
      });
      debug("Auth", "Verification email sent", { to: email, userId: newUser.id });
    } catch (mailErr) {
      warn("Auth", "Failed to send verification email", { email, error: mailErr.message });
    }

    res.status(201).json({
      message:
        "User registered successfully. Please check your email to verify your account.",
      user: { id: newUser.id, email: newUser.email, name: newUser.name },
    });
  } catch (err) {
    logError("Auth", "Registration error", {
      error: err.message,
      stack: err.stack,
      body: req.body,
    }, ErrorCodes.AUTH_REGISTER_FAILED);
    return next(
      new AppError(
        "Registration failed due to server error",
        500,
        "AUTH_REGISTER_FAILED",
      ),
    );
  }
};

// 2. Login: Verify credentials and issue a JWT
exports.login = async (req, res, next) => {
  const { email, password } = req.body;

  try {
    debug("Auth", "Login attempt", { email });

    const { rows } = await db.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);
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

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });

    info("Auth", "Login successful", { userId: user.id, email: user.email });

    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name },
    });
  } catch (err) {
    logError("Auth", "Login error", {
      error: err.message,
      stack: err.stack,
    }, ErrorCodes.AUTH_LOGIN_FAILED);
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
    const { email } = req.query;
    if (!email) {
      return res.status(400).json({
        error: "Email parameter is required",
        code: ErrorCodes.DOC_VALIDATION,
      });
    }

    const result = await db.query("SELECT id FROM users WHERE email = $1", [
      email,
    ]);
    return res.json({ exists: result.rows.length > 0 });
  } catch (err) {
    logError("Auth", "Database error checking email", {
      error: err.message,
      stack: err.stack,
    }, ErrorCodes.DB_QUERY_FAILED);
    return res.status(500).json({
      error: "Internal server error",
      code: ErrorCodes.DB_QUERY_FAILED,
    });
  }
};

// 4. Verify Email via Deep Link Token
exports.verifyEmail = async (req, res, next) => {
  const { token } = req.body;

  try {
    debug("Auth", "Email verification attempt", { tokenLength: token?.length });

    const result = await db.query(
      "SELECT id, email FROM users WHERE verification_token = $1 AND verification_expires_at > NOW()",
      [token],
    );

    if (result.rows.length === 0) {
      warn("Auth", "Invalid or expired verification token", { tokenLength: token?.length });
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

    info("Auth", "Email verified successfully", { userId: user.id, email: user.email });

    return res.json({
      message: "Email verified successfully!",
      token: authToken,
    });
  } catch (err) {
    logError("Auth", "Email verification error", {
      error: err.message,
      stack: err.stack,
    }, ErrorCodes.UNKNOWN_ERROR);
    return next(
      new AppError(
        "Internal server error during verification",
        500,
        "AUTH_VERIFY_FAILED",
      ),
    );
  }
};

// 5. Resend Verification Link
exports.resendVerification = async (req, res) => {
  const { email } = req.body;

  try {
    const result = await db.query(
      "SELECT id, is_verified FROM users WHERE email = $1",
      [email],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found with this email." });
    }

    const user = result.rows[0];
    if (user.is_verified) {
      return res.status(400).json({ error: "Email is already verified." });
    }

    // Generate new token & 24-hour expiry
    const verificationToken = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await db.query(
      "UPDATE users SET verification_token = $1, verification_expires_at = $2 WHERE id = $3",
      [verificationToken, expiresAt, user.id],
    );

    const verificationLink = `exp://localhost:8081/(auth)/verify-email?token=${verificationToken}`;

    await transporter.sendMail({
      from: `"DocuGuard System" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Verify Your Email - DocuGuard",
      html: `
        <h3>Verify Your Account</h3>
        <p>Please click the button below to verify your email address:</p>
        <a href="${verificationLink}" style="padding: 10px 20px; background: #2563EB; color: #fff; text-decoration: none; border-radius: 5px; display: inline-block;">Verify Email</a>
        <p style="margin-top: 15px;">Or use this link:</p>
        <p>${verificationLink}</p>
      `,
    });

    console.log(`🔗 [DEV RESEND LINK]: ${verificationLink}`);
    return res.json({ message: "Verification link resent successfully!" });
  } catch (err) {
    console.error("Resend verification error:", err);
    return res
      .status(500)
      .json({ error: "Failed to resend verification link." });
  }
};

// 6. Request Password Reset
exports.forgotPassword = async (req, res) => {
  const { email } = req.body;

  try {
    const { rows } = await db.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);
    if (rows.length === 0) {
      return res.json({
        message: "If that email exists, reset instructions have been sent.",
      });
    }

    // Generate token and 1-hour expiry
    const resetToken = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await db.query(
      "INSERT INTO password_resets (email, token, expires_at) VALUES ($1, $2, $3)",
      [email, resetToken, expiresAt],
    );

    const resetLink = `exp://localhost:8081/(auth)/reset-password?token=${resetToken}`;

    await transporter.sendMail({
      from: `"DocuGuard System" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Password Reset Request - DocuGuard",
      html: `
        <h3>Password Reset</h3>
        <p>You requested a password reset for your DocuGuard account. Click the button below to set a new password:</p>
        <a href="${resetLink}" style="padding: 10px 20px; background: #DC2626; color: #fff; text-decoration: none; border-radius: 5px; display: inline-block;">Reset Password</a>
        <p style="margin-top: 15px;">This link expires in 1 hour.</p>
      `,
    });

    console.log(`🔗 [DEV RESET LINK]: ${resetLink}`);
    res.json({ message: "Password reset instructions sent successfully" });
  } catch (err) {
    console.error("Password reset error:", err);
    res.status(500).json({ error: "Password reset failed" });
  }
};

// 7. Reset Password (Completing process with new password)
exports.resetPassword = async (req, res) => {
  const { token, newPassword } = req.body;

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

    // Hash the new password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(newPassword, salt);

    // Update user's password
    await db.query("UPDATE users SET password_hash = $1 WHERE email = $2", [
      passwordHash,
      resetRecord.email,
    ]);

    // Mark reset token as used
    await db.query("UPDATE password_resets SET used = TRUE WHERE id = $1", [
      resetRecord.id,
    ]);

    return res.json({ message: "Password updated successfully!" });
  } catch (err) {
    console.error("Reset password error:", err);
    return res.status(500).json({ error: "Failed to reset password." });
  }
};

// 8. Update FCM Token for push notifications
exports.updateFcmToken = async (req, res) => {
  const { fcmToken } = req.body;
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
