const db = require("../config/db");

exports.getDashboardData = async (req, res) => {
  const userId = req.user.userId; // Extracted from your auth middleware

  try {
    // 1. Fetch user's documents
    const docsResult = await db.query(
      "SELECT * FROM documents WHERE user_id = $1 ORDER BY expiry_date ASC",
      [userId],
    );
    const documents = docsResult.rows;

    // 2. Fetch user's reminders
    const remindersResult = await db.query(
      "SELECT * FROM reminders WHERE user_id = $1 AND is_read = FALSE ORDER BY due_date ASC",
      [userId],
    );
    const reminders = remindersResult.rows;

    // 3. Calculate summary metrics & safety score
    const totalDocuments = documents.length;
    let validDocuments = 0;
    let expiringDocuments = 0;
    let expiredDocuments = 0;

    const today = new Date();

    documents.forEach((doc) => {
      const expiry = new Date(doc.expiry_date);
      const diffTime = expiry - today;
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays < 0) {
        expiredDocuments++;
      } else if (diffDays <= 30) {
        expiringDocuments++; // Expiring within 30 days
      } else {
        validDocuments++;
      }
    });

    // Simple Safety Score Algorithm: (Valid / Total) * 100
    let safetyScore = 100;
    if (totalDocuments > 0) {
      const penalty =
        (expiringDocuments * 0.5 + expiredDocuments * 1.0) / totalDocuments;
      safetyScore = Math.max(0, Math.min(100, Math.round((1 - penalty) * 100)));
    }

    res.json({
      summary: {
        safetyScore,
        totalDocuments,
        validDocuments,
        expiringDocuments,
        expiredDocuments,
      },
      documents,
      reminders,
    });
  } catch (err) {
    console.error("Dashboard fetch error:", err);
    res.status(500).json({ error: "Server error fetching dashboard data" });
  }
};
