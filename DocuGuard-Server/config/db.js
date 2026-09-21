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
};
