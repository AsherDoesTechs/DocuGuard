"use strict";

// LOCAL-ONLY utility.
// Generates an enrollment grant and draft SQL; never connects to a database.

const crypto = require("node:crypto");

const adminId = process.argv[2];

if (
  typeof adminId !== "string" ||
  adminId.trim().length === 0 ||
  adminId.trim().length > 100
) {
  console.error(
    "Usage: node scripts/generate-admin-enrollment-grant.js <adminId>",
  );
  process.exit(1);
}

const normalizedAdminId = adminId.trim();
const token = crypto.randomBytes(32).toString("base64url");
const tokenHash = crypto
  .createHash("sha256")
  .update(token, "utf8")
  .digest("hex");

// Escape a value before embedding it as a SQL string literal.
const sqlLiteral = (value) => "'" + value.replace(/'/g, "''") + "'";

const adminIdLiteral = sqlLiteral(normalizedAdminId);
const hashLiteral = sqlLiteral(tokenHash);

console.log("\n=== ONE-TIME ENROLLMENT GRANT ===");
console.log("Transfer this token securely to the intended administrator.");
console.log("Treat this token as a secret. Do not commit it, log it,");
console.log("or include it in the SQL draft.\n");
console.log(token);

console.log("\n=== DRAFT SQL — REVIEW ONLY; NOT EXECUTED ===\n");
console.log(
  `WITH matching_admins AS MATERIALIZED (
     SELECT u.id
       FROM public.users AS u
      WHERE u.role = 'admin'
        AND LOWER(BTRIM(u.admin_id)) = LOWER(${adminIdLiteral})
        AND u.is_verified IS TRUE
        AND BTRIM(u.admin_id) <> ''
   ),
   unique_admin AS (
     SELECT MIN(id) AS user_id
       FROM matching_admins
      HAVING COUNT(*) = 1
   )
   INSERT INTO public.admin_device_enrollment_tokens
     (user_id, token_hash, expires_at)
   SELECT user_id, ${hashLiteral}, NOW() + INTERVAL '5 minutes'
     FROM unique_admin
   RETURNING id, user_id, expires_at;`,
);

console.log("\nSafety behavior:");
console.log("- Exactly one eligible administrator must match.");
console.log("- Zero matches or multiple matches insert no grant.");
console.log("- The token hash, not the raw token, is included in the SQL.");
console.log("- The grant expires five minutes after SQL execution.");
console.log(
  "\nReview the target administrator and the SQL before any future manual use.",
);
console.log("This utility did not execute SQL or connect to any service.");
