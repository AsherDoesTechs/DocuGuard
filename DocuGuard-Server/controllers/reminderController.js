const db = require("../config/db");

// Get all reminders for the user
exports.getReminders = async (req, res) => {
  const userId = req.user.userId;
  try {
    const result = await db.query(
      `SELECT id, title, description, due_date AS "dueDate", severity, is_read AS "read" 
       FROM reminders WHERE user_id = $1 ORDER BY due_date ASC`,
      [userId],
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching reminders:", err);
    res.status(500).json({ error: "Server error fetching reminders" });
  }
};

// Update notification preferences / store FCM token
exports.updateNotificationPrefs = async (req, res) => {
  const userId = req.user.userId;
  const { notificationsEnabled, fcmToken } = req.body;

  try {
    await db.query(
      `UPDATE users SET notifications_enabled = $1, fcm_token = COALESCE($2, fcm_token) WHERE id = $3`,
      [notificationsEnabled, fcmToken, userId],
    );
    res.json({ message: "Notification preferences updated successfully" });
  } catch (err) {
    console.error("Error updating preferences:", err);
    res.status(500).json({ error: "Server error updating preferences" });
  }
};
