const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
require("dotenv").config();
const fs = require("fs");
const db = require("../config/db");

async function main() {
  const migrationPath = path.join(
    __dirname,
    "..",
    "migrations",
    "015_ensure_user_email_verification_columns.sql",
  );
  const sql = fs.readFileSync(migrationPath, "utf8").replace(/^\uFEFF/, "");

  console.log("Applying email verification columns migration to configured database...");
  await db.query(sql);

  const check = await db.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name IN ('verification_token', 'verification_expires_at')
    ORDER BY column_name
  `);

  console.log("Verified columns:", check.rows.map((r) => r.column_name).join(", ") || "(none)");

  if (check.rows.length !== 2) {
    throw new Error(
      "verification_token/verification_expires_at are still missing after migration.",
    );
  }

  console.log("Email verification columns are present.");
}

main()
  .catch((err) => {
    console.error("Failed to ensure email verification columns:", err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await db.pool.end();
    } catch {}
  });
