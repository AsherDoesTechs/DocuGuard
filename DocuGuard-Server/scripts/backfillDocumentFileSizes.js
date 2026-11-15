require("dotenv").config();
const { Pool } = require("pg");
const { getObjectMetadata } = require("../services/storageService");

async function main() {
  const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    console.error("Missing DATABASE_URL (or SUPABASE_DB_URL).");
    process.exit(1);
  }

  const pool = new Pool({
    connectionString,
    ssl: connectionString.includes("localhost") ? false : { rejectUnauthorized: false },
  });

  try {
    const res = await pool.query(
      `SELECT id, s3_key
       FROM public.documents
       WHERE (file_size IS NULL OR file_size = 0)
         AND s3_key IS NOT NULL
         AND s3_key <> ''
         AND COALESCE(status, 'active') <> 'deleted'
       ORDER BY id ASC
       LIMIT 500`
    );
    console.log(`Found ${res.rows.length} documents to backfill (up to 500).`);

    let updated = 0;
    let failed = 0;
    for (const row of res.rows) {
      try {
        const meta = await getObjectMetadata(row.s3_key);
        const size = meta && typeof meta.size === "number" && Number.isFinite(meta.size) ? Math.max(0, Math.floor(meta.size)) : null;
        if (size == null) {
          failed++;
          console.warn(`No size for doc ${row.id} (s3_key=${row.s3_key})`);
          continue;
        }
        await pool.query(`UPDATE public.documents SET file_size = $1, updated_at = NOW() WHERE id = $2`, [size, row.id]);
        updated++;
        console.log(`Updated doc ${row.id}: ${size} bytes`);
      } catch (e) {
        failed++;
        console.warn(`Failed doc ${row.id}:`, e?.message || e);
      }
    }
    console.log(`Done. updated=${updated} failed=${failed}`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
