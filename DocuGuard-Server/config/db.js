const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

let connectionString = process.env.DATABASE_URL;

if (!connectionString && process.env.DB_HOST) {
  const ssl =
    process.env.DB_SSL === "false" ? false : { rejectUnauthorized: false };
  connectionString = `postgresql://${encodeURIComponent(process.env.DB_USER)}:${encodeURIComponent(process.env.DB_PASSWORD)}@${process.env.DB_HOST}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || "postgres"}?sslmode=${ssl ? "require" : "disable"}`;
}

const caPath = path.join(__dirname, "..", "certs", "supabase-ca.crt");
const ca = fs.readFileSync(caPath, "utf8");

const pool = new Pool({
  connectionString,
  ssl: {
    ca,
    rejectUnauthorized: true,
  },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on("error", (err) => {
  console.error("Unexpected PostgreSQL pool error:", err);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  getClient: () => pool.connect(),
  withTransaction: async (fn) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackErr) {
        console.error("Transaction rollback failed:", rollbackErr);
      }
      throw err;
    } finally {
      client.release();
    }
  },
  pool,
};
