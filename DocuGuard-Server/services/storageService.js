const { supabaseAdmin } = require("../config/supabase");

const STORAGE_BUCKET = "documents";

exports.generatePresignedUploadUrl = async (userId, fileName, fileType) => {
  const storagePath = `${userId}/${Date.now()}_${fileName}`;

  const { data, error } = await supabaseAdmin.storage
    .from(STORAGE_BUCKET)
    .createSignedUploadUrl(storagePath);

  if (error) {
    throw new Error(`Supabase signed URL error: ${error.message}`);
  }

  const fileUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${storagePath}`;

  return { uploadUrl: data.signedUrl, fileUrl, s3Key: storagePath };
};
