"use strict";

/**
 * The rules around a server revision.
 *
 * A revision names the moment a row was last written. The client sends the
 * revision it last saw back with every push, and the server refuses the write
 * when the row has moved on. These tests cover the rule itself, which is the
 * part that decides whether a concurrent edit is detected or silently
 * overwritten.
 *
 * The comparison the server runs in SQL is expressed here as well, so the rule
 * can be checked without a database.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  revisionPrecision,
  canonicalizeServerRevision,
  revisionMatches,
  revisionsMatch,
} = require("../shared/sync/serverRevision");

const CANONICAL = "2026-10-20T15:27:11.123456Z";
const LEGACY = "2026-10-20T15:27:11.123Z";

test("the precision of a revision is recognised", () => {
  assert.equal(revisionPrecision(CANONICAL), "microsecond");
  assert.equal(revisionPrecision(LEGACY), "millisecond");
  assert.equal(revisionPrecision("2026-10-20T15:27:11Z"), null);
  assert.equal(revisionPrecision("nonsense"), null);
  assert.equal(revisionPrecision(null), null);
  assert.equal(revisionPrecision(42), null);
});

test("a legacy revision is normalised into the canonical format", () => {
  assert.equal(canonicalizeServerRevision(CANONICAL), CANONICAL);
  assert.equal(canonicalizeServerRevision(LEGACY), "2026-10-20T15:27:11.123000Z");
  assert.equal(canonicalizeServerRevision("nonsense"), null);
});

test("two updates in the same millisecond are two different revisions", () => {
  /*
   * The row was written at .123456 and a second write moved it to .123789.
   * Both are in the same millisecond, so a comparison that truncates to
   * milliseconds would call them the same revision - and a client that had
   * seen the first one would be told that nothing had changed while its write
   * was accepted over the newer edit.
   */
  const moved = "2026-10-20T15:27:11.123789Z";

  assert.equal(revisionMatches(moved, CANONICAL), false);
  assert.equal(revisionsMatch(moved, CANONICAL), false);
  assert.equal(revisionMatches(CANONICAL, CANONICAL), true);
});

test("a revision that has not moved is still the same revision", () => {
  assert.equal(revisionMatches(CANONICAL, CANONICAL), true);
  assert.equal(
    revisionMatches("2026-10-20T15:27:12.123456Z", "2026-10-20T15:27:11.123456Z"),
    false,
    "a second later is a different revision",
  );
});

test("a legacy revision can only be compared with millisecond precision", () => {
  /*
   * A client written against the previous server format holds a revision that
   * lost the sub-millisecond part of the instant. The row it came from is
   * still the same row, so the comparison has to accept it - otherwise every
   * document that was synced before the upgrade would be reported as changed
   * on another device.
   */
  assert.equal(revisionMatches("2026-10-20T15:27:11.123456Z", LEGACY), true);
  assert.equal(revisionMatches("2026-10-20T15:27:11.123789Z", LEGACY), true);
  assert.equal(revisionMatches("2026-10-20T15:27:12.123456Z", LEGACY), false);
});

test("a padded legacy revision is not the same thing as an exact revision", () => {
  /*
   * A legacy revision is rewritten with the fractional digits it lost, so
   * "...11.123Z" becomes "...11.123000Z". That rewritten value does not name
   * the microsecond the row actually has, and it must not be treated as if it
   * did: the exact comparison of "...11.123000Z" against a row that is at
   * "...11.123456Z" has to fail.
   */
  assert.equal(
    revisionMatches("2026-10-20T15:27:11.123456Z", "2026-10-20T15:27:11.123000Z"),
    false,
    "the exact comparison names one instant and nothing else",
  );

  assert.equal(
    revisionMatches("2026-10-20T15:27:11.123000Z", LEGACY),
    true,
    "the same value is accepted when the request only claims milliseconds",
  );
});

test("a value that is not a revision never matches", () => {
  assert.equal(revisionMatches(CANONICAL, "nonsense"), false);
  assert.equal(revisionMatches("nonsense", CANONICAL), false);
  assert.equal(revisionMatches(null, null), false);
  assert.equal(revisionMatches(CANONICAL, undefined), false);
});
