const supabase = require("../config/supabase");
const db = require("../config/db");

async function exportUserData(userId) {
  const documents = await db.query(
    "SELECT * FROM documents WHERE user_id = $1",
    [userId]
  );

  const reminders = await db.query(
    "SELECT * FROM reminders WHERE user_id = $1",
    [userId]
  );

  const user = await db.query(
    "SELECT id, name, email, security_level, created_at FROM users WHERE id = $1",
    [userId]
  );

  const exportData = {
    user: user.rows[0],
    documents: documents.rows,
    reminders: reminders.rows,
    exportedAt: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("exports")
    .insert([{ user_id: userId, data: exportData }]);

  if (error) {
    throw new Error(`Supabase export failed: ${error.message}`);
  }

  return exportData;
}

async function syncDocumentToCloud(userId, document) {
  const { error } = await supabase
    .from("documents")
    .upsert({
      id: document.id,
      user_id: userId,
      title: document.title,
      category: document.category,
      issuer: document.issuer,
      document_number: document.documentNumber,
      issue_date: document.issueDate,
      expiry_date: document.expiryDate,
      notes: document.notes,
      status: document.status,
      updated_at: new Date().toISOString(),
    });

  if (error) {
    throw new Error(`Supabase sync failed: ${error.message}`);
  }
}

module.exports = {
  exportUserData,
  syncDocumentToCloud,
};
