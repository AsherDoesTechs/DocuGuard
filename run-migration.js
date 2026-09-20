require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function runMigration() {
  try {
    console.log("Running migration: Add processing_status column...");
    
    const result = await pool.query(`
      ALTER TABLE documents ADD COLUMN IF NOT EXISTS processing_status TEXT DEFAULT 'completed';
    `);
    
    console.log("Migration completed successfully!");
    console.log("Result:", result);
    
    // Verify the column exists
    const checkResult = await pool.query(`
      SELECT column_name, data_type, column_default 
      FROM information_schema.columns 
      WHERE table_name = 'documents' AND column_name = 'processing_status';
    `);
    
    console.log("Column verification:", checkResult.rows);
    
  } catch (err) {
    console.error("Migration failed:", err.message);
    console.error(err.stack);
  } finally {
    await pool.end();
  }
}

runMigration();