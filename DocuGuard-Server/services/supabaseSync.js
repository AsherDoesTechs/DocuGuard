const { supabaseAdmin } = require("../config/supabase");
const db = require("../config/db");
const { authoritativeDocumentRow } = require("./dataSyncService");

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

  const { error } = await supabaseAdmin
    .from("exports")
    .insert([{ user_id: userId, data: exportData }]);

  if (error) {
    throw new Error(`Supabase export failed: ${error.message}`);
  }

  return exportData;
}

/**
 * Writes a document to the mirror.
 *
 * The payload is mapped as a stored row rather than as a request payload: an
 * upsert writes every column it is given, so a column the payload does not
 * carry is left alone, and a column that is NULL stays NULL. The previous
 * payload named only some of the columns and replaced the revision with a
 * freshly minted timestamp, so a document that was written here could have
 * its expiry date and its notes cleared.
 */
async function syncDocumentToCloud(userId, document) {
  const { error } = await supabaseAdmin
    .from("documents")
    .upsert(authoritativeDocumentRow(document, userId));

  if (error) {
    throw new Error(`Supabase sync failed: ${error.message}`);
  }
}

module.exports = {
  exportUserData,
  syncDocumentToCloud,
};
