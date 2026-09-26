const { supabaseAdmin } = require("../config/supabase");

const STORAGE_BUCKET = "documents";

exports.generatePresignedUploadUrl = async (userId, fileName, fileType) => {
  if (!userId) {
    throw new Error("User ID is required");
  }

  if (!fileName) {
    throw new Error("File name is required");
  }

  const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");

  const storagePath = `${userId}/${Date.now()}_${safeFileName}`;

  const { data, error } = await supabaseAdmin.storage
    .from(STORAGE_BUCKET)
    .createSignedUploadUrl(storagePath, {
      upsert: false,
    });

  if (error) {
    throw new Error(`Supabase signed URL error: ${error.message}`);
  }

  if (!data?.signedUrl) {
    throw new Error("Supabase did not return a signed upload URL");
  }

  const fileUrl =
    `${process.env.SUPABASE_URL}` +
    `/storage/v1/object/public/${STORAGE_BUCKET}/${storagePath}`;

  return {
    uploadUrl: data.signedUrl,
    fileUrl,
    storagePath,
    s3Key: storagePath, // legacy compatibility with existing DB/controller code
    fileType: fileType || "application/octet-stream",
  };
};
