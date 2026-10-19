const { supabaseAdmin } = require("../config/supabase");
const {
  broadcastToUser,
} = require("./realtimeService");

function documentRow(document) {
  const title = (document.title && String(document.title).trim()) ? String(document.title).trim() : "Scanned Document";
  return {
    id: document.id,
    user_id: document.userId ?? document.user_id,
    title,
    category: document.category || "other",
    issuer: document.issuer || null,
    document_number: document.documentNumber ?? document.document_number ?? null,
    issue_date: document.issueDate ?? document.issue_date ?? null,
    expiry_date: document.expiryDate ?? document.expiry_date ?? null,
    notes: document.notes || "",
    status: document.status || "active",
    enable_alerts: document.enableAlerts ?? document.enable_alerts ?? true,
    file_url: document.fileUrl ?? document.file_url ?? null,
    file_type: document.fileType ?? document.file_type ?? null,
    s3_key: document.s3Key ?? document.s3_key ?? null,
    processing_status: document.processingStatus ?? document.processing_status ?? "completed",
    risk_score: document.riskScore ?? document.risk_score ?? null,
    risk_level: document.riskLevel ?? document.risk_level ?? null,
    updated_at: document.updatedAt ?? document.updated_at ?? new Date().toISOString(),
  };
}

function reminderRow(reminder, userId) {
  return {
    id: reminder.id,
    user_id: userId,
    title: reminder.title,
    description: reminder.description,
    due_date: reminder.dueDate,
    severity: reminder.severity,
    is_read: reminder.read,
    updated_at: reminder.updatedAt || new Date().toISOString(),
  };
}

async function mirror(table, row, userId, event) {
  const { error } = await supabaseAdmin.from(table).upsert(row);
  if (error) {
    console.error(`Supabase ${table} mirror failed`, {
      userId,
      recordId: row.id,
      error: error.message,
    });
  }

  // Broadcast immediately as well as through Supabase Realtime. This keeps
  // connected clients current when PostgreSQL is ahead of the mirror.
  broadcastToUser(userId, table, {
    eventType: event,
    new: event === "DELETE" ? null : row,
    old: event === "DELETE" ? row : null,
  });
}

async function syncDocument(userId, document, event = "UPDATE") {
  const row = documentRow({ ...document, userId });
  await mirror("documents", row, userId, event);
}

async function syncReminder(userId, reminder, event = "UPDATE") {
  const row = reminderRow(reminder, userId);
  await mirror("reminders", row, userId, event);
}

async function deleteRecord(table, id, userId, row = {}) {
  const { error } = await supabaseAdmin
    .from(table)
    .delete()
    .eq("id", id)
    .eq("user_id", userId);
  if (error) {
    console.error(`Supabase ${table} delete mirror failed`, {
      userId,
      recordId: id,
      error: error.message,
    });
  }
  broadcastToUser(userId, table, {
    eventType: "DELETE",
    new: null,
    old: { id, user_id: userId, ...row },
  });
}

async function syncProfile(userId, profile) {
  const { error } = await supabaseAdmin.from("profiles").upsert({
    id: userId,
    user_id: userId,
    name: profile.name,
    email: profile.email,
    notifications_enabled: profile.notifyPush,
    email_alerts: profile.notifyEmail,
    expiry_alerts: profile.notifyExpiry,
    updated_at: new Date().toISOString(),
  });
  if (error) {
    console.error("Supabase profile mirror failed", {
      userId,
      error: error.message,
    });
  }
  broadcastToUser(userId, "profiles", {
    eventType: "UPDATE",
    new: { user_id: userId, ...profile },
    old: null,
  });
}

module.exports = {
  syncDocument,
  syncReminder,
  syncProfile,
  deleteRecord,
};
