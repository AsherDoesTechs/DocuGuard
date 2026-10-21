/**
 * The server revision of a document row and the format rules around it.
 */
export declare const SERVER_REVISION_PATTERN: RegExp;

/** The millisecond revision format a pre-upgrade server produced. */
export declare const LEGACY_REVISION_PATTERN: RegExp;

/**
 * The precision of a revision.
 *
 * `"microsecond"` for the canonical format, `"millisecond"` for the format a
 * pre-upgrade server produced, `null` when the value is not a revision.
 */
export declare function revisionPrecision(
  value: unknown,
): "microsecond" | "millisecond" | null;

/**
 * Normalises a revision into the canonical format, or returns null when the
 * value cannot be used as a revision.
 */
export declare function canonicalizeServerRevision(
  value: unknown,
): string | null;

/**
 * True when two revisions describe the same instant.
 *
 * Two canonical revisions are compared exactly; a legacy millisecond revision
 * on either side limits the comparison to milliseconds.
 */
export declare function revisionsMatch(left: unknown, right: unknown): boolean;

/**
 * True when a stored revision still describes the revision a client saw.
 *
 * The comparison uses the precision of the incoming revision.
 */
export declare function revisionMatches(
  stored: unknown,
  incoming: unknown,
): boolean;
