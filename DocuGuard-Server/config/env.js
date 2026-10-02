const { ErrorCodes } = require("./errorCodes");

/**
 * Fail fast on missing configuration.
 *
 * Without this, a missing JWT_SECRET makes every single request 401 with no
 * diagnostic, and a missing DATABASE_URL fails later inside the first query.
 * A boot-time assertion turns both into one clear startup error.
 */
const REQUIRED = [
  { name: "JWT_SECRET", minLength: 32 },
  { name: "SUPABASE_URL" },
  { name: "SUPABASE_SERVICE_ROLE_KEY" },
];

function validateEnv() {
  const problems = [];

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    problems.push("JWT_SECRET is not set");
  } else if (jwtSecret.length < 32) {
    problems.push("JWT_SECRET must be at least 32 characters");
  }

  // The pool accepts either a connection string or the discrete DB_* vars.
  const hasConnectionString = Boolean(process.env.DATABASE_URL);
  const hasDiscrete = Boolean(process.env.DB_HOST);
  if (!hasConnectionString && !hasDiscrete) {
    problems.push("DATABASE_URL or DB_HOST must be set");
  }

  for (const key of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
    if (!process.env[key]) {
      problems.push(`${key} is not set`);
    }
  }

  return problems;
}

function assertEnvOrExit() {
  const problems = validateEnv();

  if (problems.length === 0) {
    return;
  }

  const message = [
    "DocuGuard server cannot start. Configuration problems:",
    ...problems.map((problem) => `  - ${problem}`),
    "See DocuGuard-Server/.env.example for the expected variables.",
  ].join("\n");

  console.error(message);
  process.exit(1);
}

module.exports = { validateEnv, assertEnvOrExit, ErrorCodes };
