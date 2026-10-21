"use strict";

/**
 * Normalises a server row id into a positive safe integer.
 *
 * PostgreSQL `BIGSERIAL` columns come back from node-postgres as strings:
 * `pg-types` registers `int8` (OID 20) with `parseBigInteger`, which keeps
 * the value as text so it cannot silently lose precision. The mobile client
 * compared those ids with `typeof id === "number"` in several places, so a
 * perfectly valid id such as "42" was treated as "no id at all".
 *
 * The consequence was severe: `cloud_id` was never persisted. The OCR draft
 * link was dropped, the compensating delete after a failed local insert never
 * ran, a deleted document was hard-deleted locally instead of tombstoned, and
 * every reminder retry inserted a second server row.
 *
 * The rule is deliberately strict. Only a positive integer - given as a
 * number, a numeric string or a bigint - is accepted. Everything else (null,
 * undefined, NaN, Infinity, a float, a negative value, a value beyond
 * `Number.MAX_SAFE_INTEGER`, a string with surrounding junk) is rejected and
 * reported as "no id", because a wrong id is worse than a missing one: it
 * would address the wrong server row.
 */

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function normalizeCloudId(value) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }

  if (typeof value === "bigint") {
    if (value <= 0n) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();

    // Only plain digits. "42.0", "4e2", "0x2a", "-1" and "42abc" are all
    // rejected rather than coerced.
    if (!/^\d+$/.test(trimmed)) return null;

    const parsed = Number(trimmed);

    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }

  return null;
}

/**
 * True when the value is a usable server id.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function hasCloudId(value) {
  return normalizeCloudId(value) !== null;
}

module.exports = {
  normalizeCloudId,
  hasCloudId,
};
