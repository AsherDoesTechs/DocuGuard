"use strict";

/**
 * The server revision of a document row, and the format rules around it.
 *
 * `documents.updated_at` is a `timestamptz` with microsecond precision. The
 * server renders it as `YYYY-MM-DDTHH:MM:SS.ffffffZ` so the value survives a
 * JSON round trip unchanged, and the client sends the revision it last saw
 * back with every update so the server can refuse to overwrite a document
 * that was changed somewhere else.
 *
 * This module is the single definition of that format. The client and the
 * server both use it, so "the format the server expects" is never a guess.
 */

/**
 * The canonical revision format: six fractional digits and a literal `Z`.
 */
const SERVER_REVISION_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

/**
 * The revision format a pre-upgrade server produced.
 *
 * `updated_at` was serialised as a JSON date, so it carried milliseconds and
 * lost the sub-millisecond part of the revision.
 */
const LEGACY_REVISION_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * The precision of a revision.
 *
 * `"microsecond"` - the canonical format. The value identifies one exact
 * instant, so the server can compare it with the stored revision exactly.
 *
 * `"millisecond"` - the format a pre-upgrade server produced. The value lost
 * the sub-millisecond part of the instant, so it can only be compared with
 * millisecond precision.
 *
 * `null` - the value is not a revision at all.
 *
 * @param {unknown} value
 * @returns {"microsecond" | "millisecond" | null}
 */
function revisionPrecision(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  if (SERVER_REVISION_PATTERN.test(trimmed)) {
    return "microsecond";
  }

  if (LEGACY_REVISION_PATTERN.test(trimmed)) {
    return "millisecond";
  }

  return null;
}

/**
 * Normalises a revision into the canonical format.
 *
 * A canonical revision is returned unchanged. A legacy millisecond revision is
 * rewritten with the fractional digits it lost, which is still a correct
 * statement about the row it was taken from because revisions are compared
 * with millisecond precision. Anything else is reported as "no revision",
 * because a revision the server cannot parse would either fail the request or
 * compare against the wrong instant.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
function canonicalizeServerRevision(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  if (SERVER_REVISION_PATTERN.test(trimmed)) {
    return trimmed;
  }

  if (LEGACY_REVISION_PATTERN.test(trimmed)) {
    return `${trimmed.slice(0, -1)}000Z`;
  }

  return null;
}

/**
 * The millisecond part of a revision.
 *
 * The canonical format is fixed width, so the millisecond is the first 23
 * characters: "YYYY-MM-DDTHH:MM:SS.mmm".
 */
function millisecondPart(value) {
  return String(value).trim().slice(0, 23);
}

/**
 * True when two revisions describe the same instant.
 *
 * Two canonical revisions are compared exactly. A canonical revision and a
 * legacy millisecond revision describe the same instant only when they fall
 * in the same millisecond, because the legacy revision lost the rest of the
 * information.
 *
 * Comparing two canonical revisions with millisecond precision would say that
 * "...11.123456Z" and "...11.123789Z" are the same revision, even though they
 * are two different moments. A client that saw the first one and had been
 * overwritten by the second would be told that nothing had changed, and its
 * write would be accepted over the newer edit.
 *
 * @param {unknown} left
 * @param {unknown} right
 * @returns {boolean}
 */
function revisionsMatch(left, right) {
  const leftPrecision = revisionPrecision(left);
  const rightPrecision = revisionPrecision(right);

  if (leftPrecision === null || rightPrecision === null) {
    return false;
  }

  // A legacy revision on either side limits the comparison to milliseconds.
  if (leftPrecision === "millisecond" || rightPrecision === "millisecond") {
    return millisecondPart(left) === millisecondPart(right);
  }

  return String(left).trim() === String(right).trim();
}

/**
 * True when a stored revision still describes the revision a client saw.
 *
 * This is the rule the server applies in SQL, expressed so it can be tested
 * without a database.
 *
 * The comparison uses the precision of the incoming revision, because that is
 * the most the request can say about the row:
 *
 *   - a canonical revision names one exact instant, so the stored revision has
 *     to be that exact instant. Two canonical revisions that fall in the same
 *     millisecond are two different moments, and a client that saw the older
 *     one must be told that the row moved on.
 *   - a legacy millisecond revision says nothing about the sub-millisecond
 *     part of the instant, so the stored revision is compared with millisecond
 *     precision.
 *
 * @param {unknown} stored The revision the server holds.
 * @param {unknown} incoming The revision the client sent.
 * @returns {boolean}
 */
function revisionMatches(stored, incoming) {
  const incomingPrecision = revisionPrecision(incoming);

  if (incomingPrecision === null || revisionPrecision(stored) === null) {
    return false;
  }

  if (incomingPrecision === "millisecond") {
    return millisecondPart(stored) === millisecondPart(incoming);
  }

  return String(stored).trim() === String(incoming).trim();
}

module.exports = {
  SERVER_REVISION_PATTERN,
  LEGACY_REVISION_PATTERN,
  revisionPrecision,
  canonicalizeServerRevision,
  revisionMatches,
  revisionsMatch,
};
