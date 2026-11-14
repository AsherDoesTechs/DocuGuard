const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

// Load server env reliably regardless of current working directory.
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
require("dotenv").config();

let connectionString = process.env.DATABASE_URL;

if (!connectionString && process.env.DB_HOST) {
  const sslEnabled = process.env.DB_SSL !== "false";
  connectionString = `postgresql://${encodeURIComponent(process.env.DB_USER || "")}:${encodeURIComponent(process.env.DB_PASSWORD || "")}@${process.env.DB_HOST}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || "postgres"}?sslmode=${sslEnabled ? "require" : "disable"}`;
}

const caPath = path.join(__dirname, "..", "certs", "supabase-ca.crt");

function resolveSsl() {
  if (process.env.DB_SSL === "false") return false;
  if (connectionString && /sslmode=disable/i.test(connectionString)) return false;

  if (process.env.DB_SSL === "true" || (connectionString && /sslmode=(require|verify-ca|verify-full)/i.test(connectionString))) {
    if (fs.existsSync(caPath)) {
      return { ca: fs.readFileSync(caPath, "utf8"), rejectUnauthorized: true };
    }
    return { rejectUnauthorized: false };
  }

  // Default: prefer SSL when a CA bundle is present (e.g. Supabase); otherwise
  // allow non-SSL connections for local/dev databases.
  if (fs.existsSync(caPath)) {
    return { ca: fs.readFileSync(caPath, "utf8"), rejectUnauthorized: true };
  }
  return false;
}

const pool = new Pool({
  connectionString,
  ssl: resolveSsl(),
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
