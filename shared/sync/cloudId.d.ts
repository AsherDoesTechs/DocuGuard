/**
 * Normalises a server row id into a positive safe integer.
 *
 * PostgreSQL `BIGSERIAL` columns are returned as strings by node-postgres, so
 * a valid id arrives as `"42"` rather than `42`.
 */
export declare function normalizeCloudId(value: unknown): number | null;

/** True when the value is a usable server id. */
export declare function hasCloudId(value: unknown): boolean;
