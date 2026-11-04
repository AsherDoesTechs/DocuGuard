"use strict";

const db = require("../config/db");

/**
 * Check whether an administrator JWT still belongs to an authorized device.
 * The caller must first verify the JWT signature and expiry.
 */
async function isAdminDeviceActive({ userId, deviceId }) {
  if (
    userId === undefined ||
    userId === null ||
    deviceId === undefined ||
    deviceId === null ||
    !/^[1-9]\d*$/.test(String(deviceId))
  ) {
    return false;
  }

  const result = await db.query(
    `
SELECT d.id
FROM public.admin_devices AS d
JOIN public.users AS u ON u.id = d.user_id
WHERE d.id = $1
  AND d.user_id = $2
  AND d.revoked_at IS NULL
  AND u.role = 'admin'
LIMIT 1
`,
    [String(deviceId), userId],
  );

  return result.rows.length > 0;
}

module.exports = { isAdminDeviceActive };
