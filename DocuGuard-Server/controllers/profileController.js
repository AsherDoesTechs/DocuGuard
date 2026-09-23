const db = require("../config/db");
const bcrypt = require("bcryptjs");
const { ErrorCodes } = require("../utils/errorCodes");
const { validateSchema, profileSchema } = require("../../shared/validation/schemas");
const { z } = require("zod");

// Get user profile data and live stats
exports.getProfile = async (req, res) => {
  const userId = req.user.userId;
  try {
    const userRes = await db.query(
      `SELECT name, email, security_level AS "securityLevel", notifications_enabled AS "notifyPush", 
       email_alerts AS "notifyEmail", expiry_alerts AS "notifyExpiry", two_factor AS "twoFactor" 
       FROM users WHERE id = $1`,
      [userId],
    );

    const statsRes = await db.query(
      `SELECT 
         COUNT(*) AS "documentCount",
         COUNT(CASE WHEN expiry_date <= CURRENT_DATE + INTERVAL '30 days' THEN 1 END) AS "expiringCount",
         COUNT(CASE WHEN expiry_date < CURRENT_DATE THEN 1 END) AS "expiredCount"
       FROM documents WHERE user_id = $1`,
      [userId],
    );

    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({
      ...userRes.rows[0],
      documentCount: parseInt(statsRes.rows[0].documentCount || 0),
      expiringCount: parseInt(statsRes.rows[0].expiringCount || 0),
      expiredCount: parseInt(statsRes.rows[0].expiredCount || 0),
    });
  } catch (err) {
    console.error("Error fetching profile:", err);
    res.status(500).json({ error: "Server error fetching profile" });
  }
};

// Update security settings (Password & 2FA)
exports.updateSecurity = async (req, res) => {
  const userId = req.user.userId;

  const securitySchema = z.object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z.string().min(6, "New password must be at least 6 characters").optional(),
    twoFactor: z.boolean().optional(),
    twoFactorCode: z.string().optional(),
  });

  const validation = validateSchema(securitySchema, req.body);
  if (!validation.success) {
    return res.status(400).json({
      error: Object.values(validation.errors).join(", "),
      code: ErrorCodes.PROFILE_UPDATE_FAILED,
      details: validation.errors,
    });
  }

  const { currentPassword, newPassword, twoFactor, twoFactorCode } = validation.data;

  try {
    if (newPassword) {
      const userRes = await db.query(
        "SELECT password FROM users WHERE id = $1",
        [userId],
      );
      const validPassword = await bcrypt.compare(
        currentPassword,
        userRes.rows[0].password,
      );
      if (!validPassword) {
        return res.status(400).json({ error: "Incorrect current password" });
      }
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(newPassword, salt);

      await db.query(
        "UPDATE users SET password = $1, two_factor = $2 WHERE id = $3",
        [hashedPassword, twoFactor, userId],
      );
    } else {
      await db.query("UPDATE users SET two_factor = $1 WHERE id = $2", [
        twoFactor,
        userId,
      ]);
    }

    res.json({ message: "Security settings updated successfully" });
  } catch (err) {
    console.error("Error updating security:", err);
    res.status(500).json({ error: "Server error updating security" });
  }
};

// Update notification preferences
exports.updatePreferences = async (req, res) => {
  const userId = req.user.userId;

  const prefsSchema = z.object({
    notifyEmail: z.boolean().optional(),
    notifyPush: z.boolean().optional(),
    notifyExpiry: z.boolean().optional(),
  });

  const validation = validateSchema(prefsSchema, req.body);
  if (!validation.success) {
    return res.status(400).json({
      error: Object.values(validation.errors).join(", "),
      code: ErrorCodes.PROFILE_UPDATE_FAILED,
      details: validation.errors,
    });
  }

  const { notifyEmail, notifyPush, notifyExpiry } = validation.data;

  try {
    await db.query(
      `UPDATE users SET email_alerts = $1, notifications_enabled = $2, expiry_alerts = $3 WHERE id = $4`,
      [notifyEmail, notifyPush, notifyExpiry, userId],
    );
    res.json({ message: "Preferences updated" });
  } catch (err) {
    console.error("Error updating preferences:", err);
    res.status(500).json({ error: "Server error updating preferences" });
  }
};

// Handle support tickets
exports.submitSupportTicket = async (req, res) => {
  const userId = req.user.userId;

  const supportSchema = z.object({
    message: z.string().min(1, "Message cannot be empty").max(5000, "Message too long"),
  });

  const validation = validateSchema(supportSchema, req.body);
  if (!validation.success) {
    return res.status(400).json({
      error: Object.values(validation.errors).join(", "),
      code: ErrorCodes.PROFILE_UPDATE_FAILED,
      details: validation.errors,
    });
  }

  const { message } = validation.data;

  try {
    await db.query(
      `INSERT INTO support_tickets (user_id, message) VALUES ($1, $2)`,
      [userId, message],
    );
    res.json({ message: "Support ticket submitted successfully" });
  } catch (err) {
    console.error("Error submitting support ticket:", err);
    res.status(500).json({ error: "Server error submitting ticket" });
  }
};

// Handle checkout & subscription upgrades
exports.handleCheckoutSubscription = async (req, res) => {
  const userId = req.user.userId;

  const checkoutSchema = z.object({
    name: z.string().min(1, "Name is required").max(100, "Name too long"),
    serial: z.string().min(1, "Serial number is required").max(50, "Serial too long"),
    card: z.string().min(12, "Invalid card number").max(19, "Invalid card number"),
    expiry: z.string().regex(/^\d{2}\/\d{2}$/, "Invalid expiry format (MM/YY)"),
  });

  const validation = validateSchema(checkoutSchema, req.body);
  if (!validation.success) {
    return res.status(400).json({
      error: Object.values(validation.errors).join(", "),
      code: ErrorCodes.PROFILE_UPDATE_FAILED,
      details: validation.errors,
    });
  }

  const { name, serial, card, expiry } = validation.data;

  try {
    // Update user security level / subscription status upon successful mock payment
    await db.query(
      `UPDATE users SET security_level = 'Pro Tier', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [userId],
    );

    // Optional: Log payment/transaction history if you have a transactions table
    await db.query(
      `INSERT INTO transactions (user_id, card_last_four, document_serial) VALUES ($1, $2, $3)`,
      [userId, card.slice(-4), serial],
    );

    res.json({ message: "Subscription upgraded successfully" });
  } catch (err) {
    console.error("Error processing checkout:", err);
    res.status(500).json({ error: "Server error processing payment" });
  }
};

// Get user settings (document preferences, appearance, privacy)
exports.getUserSettings = async (req, res) => {
  const userId = req.user.userId;
  try {
    const settingsRes = await db.query(
      `SELECT default_category AS "defaultCategory", auto_backup AS "autoBackup",
              reminder_before_days AS "reminderBeforeDays",
              reminder_30days AS "reminder30days", reminder_7days AS "reminder7days",
              reminder_1day AS "reminder1day", reminder_on_day AS "reminderOnDay",
              theme_mode AS "themeMode", font_size AS "fontSize",
              biometric_lock AS "biometricLock", data_exported_at AS "dataExportedAt"
       FROM user_settings WHERE user_id = $1 LIMIT 1`,
      [userId],
    );

    const sessionsRes = await db.query(
      `SELECT id, device_name AS "deviceName", platform, ip_address AS "ipAddress",
              location, is_current AS "isCurrent", created_at AS "createdAt",
              last_active AS "lastActive"
       FROM login_sessions WHERE user_id = $1 ORDER BY is_current DESC, last_active DESC`,
      [userId],
    );

    res.json({
      settings: settingsRes.rows[0] || null,
      sessions: sessionsRes.rows || [],
    });
  } catch (err) {
    console.error("Error fetching user settings:", err);
    res.status(500).json({ error: "Server error fetching settings" });
  }
};

// Update user settings
exports.updateUserSettings = async (req, res) => {
  const userId = req.user.userId;

  const settingsSchema = z.object({
    defaultCategory: z.string().optional(),
    autoBackup: z.boolean().optional(),
    reminderBeforeDays: z.number().int().min(1).max(30).optional(),
    reminder30days: z.boolean().optional(),
    reminder7days: z.boolean().optional(),
    reminder1day: z.boolean().optional(),
    reminderOnDay: z.boolean().optional(),
    themeMode: z.string().optional(),
    fontSize: z.string().optional(),
    biometricLock: z.boolean().optional(),
  });

  const validation = validateSchema(settingsSchema, req.body);
  if (!validation.success) {
    return res.status(400).json({
      error: Object.values(validation.errors).join(", "),
      code: ErrorCodes.PROFILE_UPDATE_FAILED,
      details: validation.errors,
    });
  }

  const data = validation.data;

  try {
    const existing = await db.query(
      `SELECT id FROM user_settings WHERE user_id = $1 LIMIT 1`,
      [userId],
    );

    if (existing.rows.length > 0) {
      const fields: string[] = [];
      const values: any[] = [];
      let idx = 1;

      const map: Record<string, string> = {
        defaultCategory: "default_category",
        autoBackup: "auto_backup",
        reminderBeforeDays: "reminder_before_days",
        reminder30days: "reminder_30days",
        reminder7days: "reminder_7days",
        reminder1day: "reminder_1day",
        reminderOnDay: "reminder_on_day",
        themeMode: "theme_mode",
        fontSize: "font_size",
        biometricLock: "biometric_lock",
      };

      for (const [key, col] of Object.entries(map)) {
        if (data[key as keyof typeof data] !== undefined) {
          fields.push(`${col} = $${idx++}`);
          values.push(data[key as keyof typeof data]);
        }
      }

      if (fields.length === 0) {
        return res.json({ message: "No changes to save" });
      }

      fields.push(`updated_at = CURRENT_TIMESTAMP`);
      values.push(userId);

      await db.query(
        `UPDATE user_settings SET ${fields.join(", ")} WHERE user_id = $${idx}`,
        values,
      );
    } else {
      await db.query(
        `INSERT INTO user_settings
          (user_id, default_category, auto_backup, reminder_before_days,
           reminder_30days, reminder_7days, reminder_1day, reminder_on_day,
           theme_mode, font_size, biometric_lock)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          userId,
          data.defaultCategory || "other",
          data.autoBackup !== undefined ? data.autoBackup : true,
          data.reminderBeforeDays || 7,
          data.reminder30days !== undefined ? data.reminder30days : true,
          data.reminder7days !== undefined ? data.reminder7days : true,
          data.reminder1day !== undefined ? data.reminder1day : true,
          data.reminderOnDay !== undefined ? data.reminderOnDay : true,
          data.themeMode || "system",
          data.fontSize || "medium",
          data.biometricLock !== undefined ? data.biometricLock : false,
        ],
      );
    }

    res.json({ message: "Settings updated successfully" });
  } catch (err) {
    console.error("Error updating user settings:", err);
    res.status(500).json({ error: "Server error updating settings" });
  }
};

// Get active login sessions
exports.getLoginSessions = async (req, res) => {
  const userId = req.user.userId;
  try {
    const sessionsRes = await db.query(
      `SELECT id, device_name AS "deviceName", platform, ip_address AS "ipAddress",
              location, is_current AS "isCurrent", created_at AS "createdAt",
              last_active AS "lastActive"
       FROM login_sessions WHERE user_id = $1 ORDER BY is_current DESC, last_active DESC`,
      [userId],
    );
    res.json({ sessions: sessionsRes.rows || [] });
  } catch (err) {
    console.error("Error fetching login sessions:", err);
    res.status(500).json({ error: "Server error fetching sessions" });
  }
};

// Terminate a specific session
exports.terminateSession = async (req, res) => {
  const userId = req.user.userId;
  const { sessionId } = req.params;
  try {
    const result = await db.query(
      `DELETE FROM login_sessions WHERE id = $1 AND user_id = $2 AND is_current = false`,
      [sessionId, userId],
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Session not found or cannot terminate current session" });
    }
    res.json({ message: "Session terminated" });
  } catch (err) {
    console.error("Error terminating session:", err);
    res.status(500).json({ error: "Server error terminating session" });
  }
};

// Terminate all other sessions
exports.terminateAllOtherSessions = async (req, res) => {
  const userId = req.user.userId;
  try {
    const result = await db.query(
      `DELETE FROM login_sessions WHERE user_id = $1 AND is_current = false`,
      [userId],
    );
    res.json({ message: `Terminated ${result.rowCount} other session(s)` });
  } catch (err) {
    console.error("Error terminating other sessions:", err);
    res.status(500).json({ error: "Server error terminating sessions" });
  }
};
