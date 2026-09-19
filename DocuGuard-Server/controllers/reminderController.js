const db = require("../config/db");
const { ErrorCodes } = require("../utils/errorCodes");
const { debug, info, warn, error: logError } = require("../utils/debugLogger");

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
    logError("Reminders", "Error fetching reminders", {
      error: err.message, stack: err.stack, userId,
    }, ErrorCodes.DB_QUERY_FAILED);
    res.status(500).json({
      error: "Server error fetching reminders",
      code: ErrorCodes.DB_QUERY_FAILED,
    });
  }
};

// Create a new reminder
exports.createReminder = async (req, res) => {
  const userId = req.user.userId;
  const { title, description, dueDate, severity, isRead } = req.body;

  if (!title || !dueDate) {
    return res.status(400).json({
      error: "Title and dueDate are required",
      code: ErrorCodes.DOC_VALIDATION,
    });
  }

  try {
    const result = await db.query(
      `INSERT INTO reminders (user_id, title, description, due_date, severity, is_read)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, title, description, due_date AS "dueDate", severity, is_read AS "read"`,
      [userId, title, description || "", dueDate, severity || "medium", isRead || false],
    );

    info("Reminders", "Reminder created", { userId, reminderId: result.rows[0].id });
    res.status(201).json(result.rows[0]);
  } catch (err) {
    logError("Reminders", "Error creating reminder", {
      error: err.message, stack: err.stack, userId,
    }, ErrorCodes.DOC_CREATE_FAILED);
    res.status(500).json({
      error: "Server error creating reminder",
      code: ErrorCodes.DOC_CREATE_FAILED,
      details: err.message,
    });
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
    logError("Reminders", "Error updating preferences", {
      error: err.message, stack: err.stack, userId,
    }, ErrorCodes.PROFILE_UPDATE_FAILED);
    res.status(500).json({
      error: "Server error updating preferences",
      code: ErrorCodes.PROFILE_UPDATE_FAILED,
    });
  }
};

// Update a reminder
exports.updateReminder = async (req, res) => {
  const userId = req.user.userId;
  const reminderId = req.params.id;
  const { title, description, dueDate, severity, isRead } = req.body;

  try {
    const result = await db.query(
      `UPDATE reminders 
       SET title = COALESCE($1, title), 
           description = COALESCE($2, description), 
           due_date = COALESCE($3, due_date), 
           severity = COALESCE($4, severity), 
           is_read = COALESCE($5, is_read)
       WHERE id = $1 AND user_id = $2
       RETURNING id, title, description, due_date AS "dueDate", severity, is_read AS "read"`,
      [title, description, dueDate, severity, isRead, reminderId, userId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Reminder not found or unauthorized",
        code: ErrorCodes.DOC_NOT_FOUND,
      });
    }

    info("Reminders", "Reminder updated", { userId, reminderId });
    res.json(result.rows[0]);
  } catch (err) {
    logError("Reminders", "Error updating reminder", {
      error: err.message, stack: err.stack, userId, reminderId,
    }, ErrorCodes.DOC_UPDATE_FAILED);
    res.status(500).json({
      error: "Server error updating reminder",
      code: ErrorCodes.DOC_UPDATE_FAILED,
    });
  }
};

// Delete a reminder
exports.deleteReminder = async (req, res) => {
  const userId = req.user.userId;
  const reminderId = req.params.id;

  try {
    const result = await db.query(
      `DELETE FROM reminders WHERE id = $1 AND user_id = $2 RETURNING id`,
      [reminderId, userId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Reminder not found or unauthorized",
        code: ErrorCodes.DOC_NOT_FOUND,
      });
    }

    info("Reminders", "Reminder deleted", { userId, reminderId });
    res.json({ message: "Reminder deleted successfully" });
  } catch (err) {
    logError("Reminders", "Error deleting reminder", {
      error: err.message, stack: err.stack, userId, reminderId,
    }, ErrorCodes.DOC_DELETE_FAILED);
    res.status(500).json({
      error: "Server error deleting reminder",
      code: ErrorCodes.DOC_DELETE_FAILED,
    });
  }
};
