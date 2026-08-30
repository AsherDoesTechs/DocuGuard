const db = require("../config/db");
const bcrypt = require("bcryptjs");

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
  const { currentPassword, newPassword, twoFactor } = req.body;

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
        "UPDATE users SET password = $1, two_factor = $2 WHERE id = $1",
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
  const { notifyEmail, notifyPush, notifyExpiry } = req.body;

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
  const { message } = req.body;

  if (!message)
    return res.status(400).json({ error: "Message cannot be empty" });

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
  const { name, serial, card, expiry } = req.body;

  if (!name || !serial || !card || !expiry) {
    return res
      .status(400)
      .json({ error: "All checkout and verification fields are required." });
  }

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
