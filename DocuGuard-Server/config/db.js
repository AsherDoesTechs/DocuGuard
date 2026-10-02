const { Pool } = require("pg");
require("dotenv").config();

let connectionString = process.env.DATABASE_URL;

if (!connectionString && process.env.DB_HOST) {
  const ssl = process.env.DB_SSL === "false" ? false : { rejectUnauthorized: false };
  connectionString = `postgresql://${encodeURIComponent(process.env.DB_USER)}:${encodeURIComponent(process.env.DB_PASSWORD)}@${process.env.DB_HOST}:${process.env.DB_PORT || 5432}/${process.env.DB_NAME || "postgres"}?sslmode=${ssl ? "require" : "disable"}`;
}

const pool = new Pool({
  connectionString,

  ssl: connectionString ? undefined : {
    rejectUnauthorized: false,
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
  /**
   * Check out a dedicated client so callers can run BEGIN/COMMIT/ROLLBACK.
   * Without this, multi-statement writes were running as independent autocommit
   * statements even when the code looked transactional.
   * The caller is responsible for releasing the client.
   */
  getClient: () => pool.connect(),
  /**
   * Run `fn` inside a transaction, rolling back on any throw and always
   * releasing the client.
   */
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