# DocuGuard — Backend Readiness Investigation

**Target:** `https://docuguard-api-onoj.onrender.com/health/ready` (Render deployment)

**Strict restrictions observed:** No APK build/install. No EAS/native builds or device tests. No deploy, restart, or modification of the production service. No database changes or migrations. No secrets, tokens, or credentials printed. No application code modified during this investigation. All checks were safe, read-only GET requests only.

---

## 1. Readiness-route behavior and code locations

### `/health` (liveness) — `DocuGuard-Server/app.js:46-48`
```js
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});
```
Returns HTTP 200 immediately. Does **not** touch the database. Registered before rate limiters so probes are not throttled.

### `/health/ready` (readiness) — `DocuGuard-Server/app.js:58-75`
```js
app.get("/health/ready", async (req, res) => {
  try {
    await db.query("SELECT 1");
    res.json({
      status: "ready",
      database: "ok",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Readiness check failed:", error.message);
    res.status(503).json({
      status: "not_ready",
      database: "unavailable",
      error: "The database did not answer the readiness check.",
      timestamp: new Date().toISOString(),
    });
  }
});
```
**Exact conditions producing HTTP 503:** `db.query("SELECT 1")` throws (any error: connection refused, timeout, DNS failure, auth failure, pool exhaustion, etc.). The catch block returns 503 with `database: "unavailable"`. The route is working as designed — it correctly reports not-ready when the database cannot answer.

**Error information logged:** The catch block (`app.js:67`) logs only `error.message` via `console.error("Readiness check failed:", error.message)`. It does **not** log `error.code`, `error.errno`, `error.detail`, or the full error object. The `pool.on("error")` handler (`db.js:23-25`) logs the full `err` object, but only for unexpected pool-level errors (e.g., idle-client backend disconnects), not for a readiness-query failure, which is caught by the route's try/catch. Therefore the only diagnostic signal available in logs for a `/health/ready` failure is the error message string (e.g., "connect ECONNREFUSED <host>:<port>", "connect ETIMEDOUT", "password authentication failed for user", "getaddrinfo ENOTFOUND", or a pg error message such as "no pg_hba.conf entry").

### Database pool — `DocuGuard-Server/config/db.js:1-21`
- Uses `process.env.DATABASE_URL`, or builds a connection string from discrete `DB_HOST`/`DB_USER`/`DB_PASSWORD`/`DB_NAME`/`DB_PORT`/`DB_SSL`.
- `connectionTimeoutMillis: 10000` (10 s).
- `ssl.rejectUnauthorized: false` when no connection string.

### Environment validation — `DocuGuard-Server/config/env.js:10-57`
Boot-time `assertEnvOrExit()` requires `JWT_SECRET` (≥32 chars), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and either `DATABASE_URL` or `DB_HOST`. If any are missing, `process.exit(1)` — the service would not boot at all.

---

## 2. Evidence collected

| Check | Method | Result | Timestamp (UTC) |
|---|---|---|---|
| `/health` (liveness) | Safe read-only GET | **HTTP 200** `{"status":"ok","timestamp":"2026-10-21T08:22:47.147Z"}` | 2026-10-21T08:22:47Z |
| `/health/ready` (readiness) | Safe read-only GET | **HTTP 503** (non-2xx; body not retrievable by fetch tool) | 2026-10-21T08:22:xxZ |
| Render logs | — | Not available through authorized access; could not inspect | — |

**Interpretation:**
- The service **is running** — `/health` returns 200 and env validation passed at boot (otherwise `process.exit(1)` would have prevented the process from serving).
- `/health/ready` returns 503 because `db.query("SELECT 1")` throws at query time.
- This is **not** a boot-time config defect (env validation passed) and **not** a readiness-route implementation defect (the route behaves exactly as designed).

---

## 3. `/health` vs `/health/ready`

| Endpoint | Status | Meaning |
|---|---|---|
| `/health` | 200 OK | Process alive; env config valid at boot |
| `/health/ready` | 503 | Database query `SELECT 1` threw; DB not reachable from this instance |

The two endpoints respond differently, as designed: `/health` proves liveness, `/health/ready` proves database connectivity.

---

## 4. Root cause assessment

### Confirmed facts

| # | Fact | Evidence |
|---|------|----------|
| F1 | `GET /health` returns HTTP 200 `{"status":"ok"}` | Safe read-only GET, 2026-10-21T08:22:47Z |
| F2 | `GET /health/ready` returns HTTP 503 | Safe read-only GET, 2026-10-21T08:22:xxZ |
| F3 | The service boots successfully (env validation passed; `/health` serves) | `config/env.js:42-57` calls `assertEnvOrExit()` which `process.exit(1)` on missing config; `/health` returns 200 |
| F4 | `/health/ready` returns 503 because `db.query("SELECT 1")` throws | `app.js:58-75` catch block |
| F5 | The readiness route logs only `error.message` (not `error.code`, `error.errno`, `error.detail`, or the full error object) | `app.js:67` `console.error("Readiness check failed:", error.message)` |
| F6 | `connectionTimeoutMillis: 10000` (10 s); pool max 10 connections | `config/db.js:11-21` |

### Hypotheses (unconfirmed — do not claim as root cause)

- **Database unavailable / paused** (e.g., Render managed PostgreSQL on free tier suspended)
- **Invalid host or port** (`DB_HOST`/`DB_PORT` or `DATABASE_URL` pointing to a non-listening endpoint)
- **Incorrect credentials** (env presence validated, not correctness — `env.js:27-31` checks presence only)
- **TLS configuration mismatch** (`ssl.rejectUnauthorized: false` when built from discrete vars; `undefined` when `DATABASE_URL` is set)
- **DNS or network restriction** (Render outbound IPs not allowed to reach the database host; `getaddrinfo` failure)
- **Connection timeout** (10 s `connectionTimeoutMillis` exceeded)
- **Pool exhaustion** (all 10 pool connections in use)

None of these can be confirmed without the exact `error.message` from Render logs. The readiness-route behavior itself is not a defect — it correctly reports not-ready when the database cannot answer.

### Root cause: UNCONFIRMED

The specific underlying database error has not been confirmed. Render logs were not available through authorized access during this investigation, and the readiness route logs only `error.message`, so the precise failure mode (connection refused, timeout, auth failure, DNS, TLS, pool exhaustion) is unknown.

### Single most useful next diagnostic action

**Inspect the Render dashboard logs for the `Readiness check failed:` line** and capture the exact `error.message`. Because the route logs `error.message` (app.js:67), that single log line will identify the specific failure mode (e.g., `connect ECONNREFUSED host:port`, `connect ETIMEDOUT`, `password authentication failed for user`, `getaddrinfo ENOTFOUND hostname`, or a pg server error message). Redact any credentials before sharing. No code or config change is needed to perform this step.

### Manual steps to retrieve Render logs (if no direct access)

1. Open the Render dashboard → select the `docuguard-api-onoj` service.
2. Navigate to the **Logs** tab.
3. Filter by the time window around the `/health/ready` 503 response (2026-10-21T08:22 UTC).
4. Search for `Readiness check failed:`.
5. Copy the `error.message` portion only; redact any credentials, hostnames, or credentials-containing connection strings before sharing.

---

## 5. Recommended remediation (do NOT apply automatically)

1. **Inspect Render dashboard logs** for the `Readiness check failed:` line to capture the exact `error.message`. This is the single most useful next diagnostic step and requires no code or config change. Redact any credentials before sharing.
2. Based on the logged `error.message`, take the matching safe action:
   - `connect ECONNREFUSED` / `connect ETIMEDOUT` → verify the database service is running in the Render dashboard (not paused/suspended, especially on the free tier) and that the host/port are reachable.
   - `password authentication failed` / pg auth error → confirm `DATABASE_URL` / `DB_USER` / `DB_PASSWORD` env var values match the database (presence only — do not print values).
   - `getaddrinfo ENOTFOUND` → confirm the database hostname resolves from Render's outbound network.
   - pg server error message → inspect the database server logs/config for the stated reason.
3. **Verify Render's outbound IPs are allowed** to connect to the database if the DB is hosted externally (e.g., Supabase/Postgres with IP allow-listing).
4. Only if logs confirm pool exhaustion/timeout: consider raising `connectionTimeoutMillis` or adding pool monitoring — via the normal Render deploy flow, with ability to revert.

**Rollback considerations:** No code or config changes are being applied as part of this investigation, so there is nothing to roll back. Any future env or `db.js` change should be made via the normal Render deploy flow with the ability to revert the env var / redeploy the previous build.

**Do not:** change the readiness route to return HTTP 200 when the database is unavailable; restart or redeploy the service without diagnosing; modify database configuration or contents; print or commit secrets.

---

## 6. Explicit confirmation

No production changes were made during this investigation:
- No APK built, installed, distributed, or tested.
- No EAS/native build or device/emulator test run.
- No deploy, restart, or modification of the production service.
- No database changes, migrations, inserts, updates, deletes, or data-modifying connection tests.
- No secrets, tokens, database credentials, or full env-var values printed.
- No application code modified.
- Only two safe, read-only GET requests were made: `/health` (200) and `/health/ready` (503).

---

**Conclusion:** `/health/ready` returns HTTP 503 because `db.query("SELECT 1")` throws at runtime (`DocuGuard-Server/app.js:58-75`). The service is up and configured to boot (`/health` returns 200; boot-time env validation passed), but cannot reach its database. The readiness route itself is not defective — it correctly reports not-ready when the database cannot answer, and logs only `error.message` (`app.js:67`).

**Root cause: UNCONFIRMED.** The specific database error (connection refused, timeout, auth failure, DNS, TLS, pool exhaustion) has not been confirmed because Render logs were unavailable and the route logs only `error.message`.

**Single most useful next diagnostic action:** Inspect Render dashboard logs for the `Readiness check failed:` line and capture the exact `error.message`. That single line identifies the specific failure mode and determines the correct safe remediation. No code or config change is required to retrieve it.

---

## 7. Why the readiness error log may not appear in Render logs

### Confirmed facts about the logging path

| # | Fact | Evidence |
|---|------|----------|
| L1 | The readiness catch block logs via raw `console.error("Readiness check failed:", error.message)` | `app.js:67` |
| L2 | `console.error` writes to `stderr`, which Render captures and surfaces in the service's Logs tab | Render platform behavior |
| L3 | The route does **not** use the `debugLogger` utility (`utils/debugLogger.js`), so it bypasses `LOG_LEVEL` filtering, structured formatting, and `DEBUG_LOG_FILE` writing | `app.js` does not import `debugLogger`; `debugLogger.js:20-44` defines the logging path |
| L4 | `debugLogger.log()` suppresses any level below `LOG_LEVEL` (default `"info"`), but `error` (level 3) always passes since it is the maximum level | `debugLogger.js:11,21` |
| L5 | The centralized `errorHandler` (`utils/errors.js:14-38`) logs errors with structured context, but the readiness catch block handles its own errors and never calls `next(err)`, so `errorHandler` is **not** involved in readiness failures | `app.js:66-74` catch block returns a response directly; `errorHandler` registered at `app.js:115` |
| L6 | `/health` returns 200, so the readiness request reaches the same Express application and route table | Safe read-only GET |

### Hypotheses for the missing log entry (unconfirmed)

- **H1 — Deployed commit does not match inspected source.** The local `app.js` may contain the `console.error` line while the deployed Render build runs an older or different version that lacks it, logs differently, or has a different readiness implementation. This cannot be confirmed without comparing the deployed build's git SHA or source to the local tree.
- **H2 — Wrong Render log stream or time window.** `console.error` writes to `stderr`; if the user is viewing only `stdout` or a filtered/narrowed time window in the Render dashboard, the entry may not be visible.
- **H3 — Log retention/pagination.** Render retains logs for a limited window; if the readiness check occurred outside the visible window or was paginated out, the entry would not appear.
- **H4 — The `console.error` call itself is throwing.** Extremely unlikely, but if `error.message` access threw synchronously, no log would be emitted. There is no try/catch around the `console.error` call to guard against this.

None of H1–H4 can be confirmed from the available evidence. H1 (source/commit mismatch) is the most plausible explanation for a completely absent log entry, since `/health` confirms the service is reachable and running.

### Logger configuration analysis

There is **no logger filtering, redirection, or suppression** in the readiness path that would hide `console.error` output from Render:

- The readiness route uses raw `console.error`, bypassing `debugLogger` entirely, so `LOG_LEVEL`, `DEBUG_LOG_FILE`, and production prefix logic do not apply.
- `console.error` output goes to `stderr`, which Render captures unconditionally for the service.
- No custom `console.error` override or transport is configured anywhere in the codebase.

Therefore, if the readiness request is reaching the deployed service running the inspected source, the log entry **should** appear in Render's `stderr` log stream. Its absence most likely indicates either a source/commit mismatch (H1) or a log-viewing issue (H2/H3).

---

## 8. Implemented diagnostic improvement

### Status

The patch has been implemented in `DocuGuard-Server/app.js` but **not deployed**. It is ready for review and deployment.

### Change

Added a `sanitizeErrorMessage()` helper and replaced the catch block's `console.error("Readiness check failed:", error.message)` with structured logging of `error.name`, `error.code`, `error.errno`, and a sanitized `error.message`.

### Diff (`DocuGuard-Server/app.js`)

```diff
 app.get("/health/ready", async (req, res) => {
   try {
     await db.query("SELECT 1");
     res.json({
       status: "ready",
       database: "ok",
       timestamp: new Date().toISOString(),
     });
   } catch (error) {
-    console.error("Readiness check failed:", error.message);
+    console.error("Readiness check failed:", {
+      name: error.name,
+      code: error.code,
+      errno: error.errno,
+      message: sanitizeErrorMessage(error.message),
+    });
     res.status(503).json({
       status: "not_ready",
       database: "unavailable",
       error: "The database did not answer the readiness check.",
       timestamp: new Date().toISOString(),
     });
   }
 });
```

Plus the helper added above the readiness route:

```js
// Redact connection URLs and password fragments from log output. pg error
// messages may contain a connection string or username but never the password;
// this is a defensive measure only.
const CONNECTION_STRING_RE =
  /(postgresql|postgres):\/\/[^\s"']+|(?:password|pwd|secret)=[^\s&;]+/gi;

function sanitizeErrorMessage(message) {
  return String(message ?? "").replace(CONNECTION_STRING_RE, "[REDACTED]");
}
```

### Why this is safe

- Logs only `name`, `code`, `errno`, and a redacted `message` — none of these contain database credentials or connection strings.
- The regex redacts `postgresql://...`/`postgres://...` URLs and `password=...`/`pwd=...`/`secret=...` fragments if they ever appear in a pg error message.
- Does not log `error.stack` in production (avoids leaking file paths/line numbers).
- Does not change the HTTP response (still 503, still `database: "unavailable"`).
- Does not modify the readiness route to return 200 on failure.
- Uses raw `console.error` (unchanged transport), so Render log capture behavior is identical — only the payload is richer.

### Validation steps (after deploy, not before)

1. Deploy the patched build to Render via the normal deploy flow.
2. Trigger `/health/ready` while the database is unreachable (or wait for the next failure).
3. Inspect Render dashboard logs (stderr stream) for the structured `Readiness check failed:` entry.
4. Confirm the logged `code`/`errno`/`name` identifies the failure mode (e.g., `ECONNREFUSED`, `ETIMEDOUT`, `ENOTFOUND`, `28P01` for auth failure).
5. Redact any credentials before sharing the log output.
6. Correlate the code with the remediation guidance in Section 5 (step 2).

### Rollback considerations

- Revert the `app.js` patch via the normal Render deploy flow (redeploy the previous build). No environment-variable or database changes are involved, so there is no state to roll back.
- The patch does not alter the HTTP contract of `/health/ready`, so no client-side changes are needed.

### Tests

New test file `DocuGuard-Server/tests/healthReady.test.js` covers:

| Test | Assertion |
|---|---|
| readiness failure returns 503 | HTTP 503, `status: "not_ready"`, `database: "unavailable"`, logs `{name, code, errno, message}` |
| readiness success returns 200 | HTTP 200, `status: "ready"`, `database: "ok"` |
| diagnostic log does not expose connection strings or passwords | `postgresql://` and password redacted to `[REDACTED]` |
| diagnostic log omits stack traces | No `stack` property in logged detail |
| logs missing code and errno as undefined | `code`/`errno` are `undefined` when absent on the error object |

All 5 tests pass. Typecheck is clean.

---

## 9. Explicit confirmation

No production changes were made during this investigation:
- No APK built, installed, distributed, or tested.
- No EAS/native build or device/emulator test run.
- No deploy, restart, or modification of the production service.
- No database changes, migrations, inserts, updates, deletes, or data-modifying connection tests.
- No secrets, tokens, database credentials, or full env-var values printed.
- Application code modified: `DocuGuard-Server/app.js` (diagnostic logging patch, not deployed).
- Only two safe, read-only GET requests were made: `/health` (200) and `/health/ready` (503).

---

**Conclusion:** `/health/ready` returns HTTP 503 because `db.query("SELECT 1")` throws at runtime (`DocuGuard-Server/app.js:58-75`). The service is up and configured to boot (`/health` returns 200; boot-time env validation passed), but cannot reach its database. The readiness route itself is not defective — it correctly reports not-ready when the database cannot answer.

**Root cause: UNCONFIRMED.** The specific database error (connection refused, timeout, auth failure, DNS, TLS, pool exhaustion) has not been confirmed because Render logs were unavailable and the route previously logged only `error.message`.

**Single most useful next diagnostic action:** Deploy the patch in Section 8, then inspect Render dashboard logs for the `Readiness check failed:` line. The logged `error.code`/`error.errno`/`error.name` will identify the specific failure mode and determine the correct safe remediation. No further code changes are required to retrieve this information.


