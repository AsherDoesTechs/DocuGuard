# DocuGuard Compliance Matrix

## Status Legend

| Label | Meaning |
|-------|---------|
| **Implemented** | Code exists in the repository and is wired into running paths. |
| **Tested** | Unit/integration tests exist and pass (verified by test run). |
| **Blocked** | Cannot be verified without production access, explicit approval, or infrastructure changes. |
| **Documented, not implemented** | Described in documentation or planned, but no code exists yet. |

## Scope

This matrix maps the DocuGuard implementation to:

1. **Study objectives** - secure document management, expiration tracking, notifications/reminders, search/retrieval, storage/access control/audit, backend processing/data integrity
2. **ISO/IEC 25010:2023** - Systems and software Quality Requirements and Evaluation (SQuaRE) quality model
3. **ISO/IEC 27001:2022** - Information security management

## Test Results (Baseline)

| Suite | Tests | Passing | Failing | Exit Code |
|-------|-------|---------|---------|-----------|
| Server | 145 | 145 | 0 | 0 |
| Client | 168 | 168 | 0 | 0 |
| TypeScript typecheck | — | Pass | — | 0 |
| Syntax check (73 files) | — | Pass | — | 0 |
| `git diff --check` | — | Clean | — | 0 |

## Study Objective Coverage

| Objective | Status | Implementation Evidence | Gaps |
|-----------|--------|------------------------|------|
| Secure document management | Implemented + Tested | Per-user row scoping (`documents.user_id`), JWT auth middleware, ownership checks on every route, rate limiting (per-user + per-IP), CORS allowlist, helmet headers, file type allow-list, signed URLs with 15-min TTL, storage key ownership validation, **field-level AES-256-GCM encryption for PII (`document_number`, `issuer`) at rest** (`services/cryptoService.js`), fail-safe when `DOCUMENT_ENCRYPTION_KEY` unavailable | None |
| Expiration tracking | Implemented + Tested | Local calendar-date anchoring (`localDate.js`), per-user `reminder_before_days` window, 30-day default, `getExpiringDocuments`/`getExpiredDocuments`, dashboard summary with valid/expiring/expired counts, server-side expiration checker cron job (daily 08:00), `sendExpirationReminder` with severity tiers | No retention policy for expired documents; no automatic archival |
| Notifications/reminders | Implemented + Tested | Push notifications (Expo + FCM), email templates (verification, reset, expiration), notification preferences (`notifications_enabled`, `notify_email`, `notify_expiry`), local reminder scheduling (`notificationScheduler.ts`), reminder intervals per document (30/7/1 default), milestone date resolution, **configurable per-user schedules** (`reminder_before_days`, `reminder_30days/7days/1day/on_day` from `user_settings`), `expiry_alerts` opt-out, bounded concurrency (5) in expiration checker | No delivery receipt tracking; no escalation path for unacknowledged critical alerts |
| Search/retrieval | Implemented + Tested | Document queries by category, tags, status, expiry date ordering, **full-text search via PostgreSQL `tsvector` + GIN index** (`migrations/003_add_search_vector.sql`), `/api/search` endpoint (`controllers/searchController.js`, `routes/search.js`) with `plainto_tsquery` ranking, OCR extraction (`logicEngine.js`), dashboard statistics with `byCategory` breakdown, **client-side search UI** (`app/(tabs)/documents.tsx` with debounce, loading/empty/error/retry states, stale-response prevention) | No fuzzy search; no client-side offline OCR search |
| Storage/access control/audit | Implemented + Tested | Supabase storage bucket with signed URLs, `ownsStorageKey` ownership validation, `document_history` audit table, `login_sessions` tracking, `user_settings` per-user, soft deletes (`status='deleted'`), tombstone filtering from reads, **append-only audit log with REVOKE UPDATE/DELETE** (`migrations/002_add_audit_log_and_retention.sql`), audit middleware wrapping all route responses (`middleware/audit.js`) | Audit-log immutability depends on DB connection role not being table owner/superuser (see §27001 A.12.4 below) |
| Backend processing/data integrity | Implemented + Tested | Azure Document Intelligence OCR with confidence scoring (min 0.6), conditional sync updates with revision tracking (microsecond precision), conflict detection (409), idempotent retries with exponential backoff (max 5 attempts), Supabase mirror upsert, real-time reconciliation with needsSync guards, **data retention job** (`jobs/dataRetention.js`) with per-user TTL for soft-deleted/expired documents | No checksum verification of stored files; no integrity attestation |
| Backup and recovery | Documented, not implemented | Backup service (`services/backupService.js`) provides `verifyPrerequisites()`, `generateManifest()`, `buildBackupCommand()`, `buildSchemaCommand()`, `getRestoreRunbook()` — **readiness checking and orchestration helpers only**. No `pg_dump` or `pg_restore` is executed by application code. No backup has been created or restored in any environment. | No automated backup execution; no offsite storage; no restore verification |

## ISO/IEC 25010 Quality Model Coverage

| Characteristic | Sub-characteristic | Status | Evidence |
|---------------|-------------------|--------|----------|
| Functional suitability | Functional completeness | Implemented | All study objectives covered above |
| | Functional correctness | Implemented + Tested | 145 server tests + 168 client tests passing; validation schemas reject invalid input |
| | Functional appropriateness | Implemented | Purpose-specific features (OCR drafts, expiration alerts, document verification, full-text search, client search UI) |
| Performance efficiency | Time behaviour | Implemented | Single aggregate dashboard query, bounded concurrency (5) in expiration checker, indexes on `expiry_date`, `needs_sync`, `user_id`, `cloud_id`, GIN index on `search_vector` |
| | Resource utilization | Implemented | Connection pool (max 10), WAL journal mode, memoized DB handle, short-lived signed URLs |
| | Capacity | Implemented | 15MB max file size, rate limits (300/15min general, 10/hour auth, 60/hour upload) |
| Compatibility | Co-existence | Implemented | CommonJS server + ESM client, shared modules usable by both |
| | Interoperability | Implemented | Supabase mirror, Firebase Admin, Azure OCR, Expo push, Resend email, PostgreSQL |
| Usability | User error protection | Implemented | Validation schemas with clear messages, compensation on failed saves, conflict detection prevents lost updates, debounced search with clear/reset |
| | User interface aesthetics | Not assessed | Native UI not in scope of this matrix |
| | Accessibility | Not assessed | Not assessed |
| Reliability | Maturity | Implemented + Tested | Retry budget (5 attempts), backoff, permanent failure parking, best-effort mirror |
| | Availability | Implemented | `/health/ready` readiness probe, `/api/backup/status` backup readiness endpoint, offline-first local queue, sync worker with mutex |
| | Fault tolerance | Implemented + Tested | Cloud draft compensation on failed local insert, mirror failures don't fail primary writes, tombstone preservation, cron jobs gated behind `NODE_ENV !== 'test'`, cron `stop()` export for tests |
| Security | Confidentiality | Implemented + Tested | Per-user scoping, JWT auth, signed URLs, CORS allowlist, rate limiting, file type allow-list, SSRF protection on file URLs, **AES-256-GCM field-level encryption for PII at rest**, fail-safe when key unavailable |
| | Integrity | Implemented + Tested | Revision-based conflict detection, atomic transactions, `needsSync` guards on realtime reconciliation, **append-only audit log (REVOKE UPDATE/DELETE)** |
| | Non-repudiation | Implemented | JWT tokens, login sessions, document history, audit log with `user_id` scoping |
| | Accountability | Implemented | `document_history`, `login_sessions`, audit log write path audited by middleware |
| | Authenticity | Implemented | JWT verification, password hashing (bcrypt), TOTP 2FA |
| Maintainability | Modularity | Implemented | Separated controllers/services/routes/middleware, shared sync modules, injected dependencies |
| | Reusability | Implemented | Pure functions in `localDate.js`, `syncPolicy.js`, `schemas.js` usable by client and server |
| | Analysability | Implemented | DebugLogger with sanitized error messages, no secrets in logs |
| | Modifiability | Implemented | Migration pattern (`001_add_settings_tables.sql`, `002_add_audit_log_and_retention.sql`, `003_add_search_vector.sql`), feature flags via `preferences_dirty` |
| | Testability | Implemented + Tested | **145 server unit tests + 168 client unit tests**, pure logic modules, dependency injection, cron jobs stoppable via `stop()` export |
| Portability | Adaptability | Implemented | Environment-based config (`env.js` with fail-fast, `DOCUMENT_ENCRYPTION_KEY` required), platform-agnostic push (Expo + FCM) |
| | Installability | Implemented | EAS build, OTA updates to preview channel |
| | Replaceability | Implemented | SQL + Supabase abstraction, no vendor lock-in on business logic |

## ISO/IEC 27001:2022 Control Coverage

| Control Domain | Control | Status | Evidence | Gap |
|---------------|---------|--------|----------|-----|
| A.5 Organizational | Information security policy | Documented, not implemented | env.js fail-fast, security middleware | No documented security policy |
| | Roles and responsibilities | Not implemented | - | No responsibility matrix |
| A.6 Organization | Internal organization | Not implemented | - | No org structure defined |
| A.7 People management | Screening, terms, responsibilities | Not implemented | - | HR controls not applicable to codebase |
| A.8 Asset management | Responsibility for assets | Implemented | `ownsStorageKey`, per-user scoping | Data classification scheme not defined |
| | Information classification | Partial | Document categories (identification, etc.) | No formal classification labels |
| | Media handling | Not implemented | - | No removable media controls |
| A.9 Access control | User registration/de-registration | Implemented | Auth routes, sign-out purges local data | - |
| | User access provisioning | Implemented | `authMiddleware`, `user_id` scoping on every query | - |
| | Removal of access rights | Implemented | `switchLocalUser` purges previous account data on login | - |
| | Authentication information | Implemented | bcrypt password hashing, JWT, TOTP 2FA | - |
| | Access control policy | Implemented | Per-user row-level security via SQL WHERE clauses | No formal access control policy document |
| | Information access restriction | Implemented | Every route scoped by `req.user.userId`, `scopeClause` returns `1=0` when signed out | - |
| | Sensitive system isolation | Partial | Supabase storage bucket separate from app logic | No network segmentation documentation |
| A.10 Cryptography | Use of cryptographic controls | Implemented + Tested | Signed URLs, JWT signing, bcrypt, **AES-256-GCM field-level encryption for PII** (`services/cryptoService.js`, 15 tests) | - |
| | Key management | Implemented + Tested | **`DOCUMENT_ENCRYPTION_KEY` env var (SHA-256 derived, min 16 chars), key derivation, fail-safe when key unavailable** (`config/env.js:14,27-32`, `services/cryptoService.js:28-34,47-54,80-85`) | No key rotation schedule; no key recovery mechanism |
| A.11 Physical/environmental | Not applicable | Not implemented | - | Infrastructure managed by hosting provider |
| A.12 Operations | Operational procedures | Implemented + Tested | Expiration checker cron, **data retention cron with per-user TTL**, cron jobs gated behind `NODE_ENV !== 'test'`, `stop()` export for tests | No documented runbooks |
| | Change management | Not implemented | - | No change approval process |
| | Capacity management | Implemented | Rate limits, connection pool, file size limits | - |
| | Development security | Partial | Input validation, SSRF protection, file type allow-list | No secure coding standard |
| | Test data | Not implemented | - | No sanitized test data policy |
| A.13 Communications | Network security | Partial | CORS allowlist, TLS implied by hosting | No network security policy |
| | Information transfer | Implemented | Signed URLs (15-min TTL), HTTPS-only file URLs | - |
| A.14 Acquisition/development | Secure development | Partial | Validation, parameterized queries, error sanitization | No threat modeling |
| | Secure system engineering | Partial | Transactional writes, atomic operations | No formal SDLC |
| | Supplier relationships | Not implemented | - | Third-party service risk assessment missing |
| A.16 Incident management | Responsibilities/procedures | Not implemented | - | No incident response plan |
| | Reporting security events | Partial | Error logging (sanitized) | No security event reporting channel |
| A.17 Business continuity | Availability | Implemented + Tested | `/health/ready`, offline-first queue, **`/api/backup/status` readiness endpoint**, `verifyPrerequisites()`, `generateManifest()`, `buildBackupCommand()`, `buildSchemaCommand()`, `getRestoreRunbook()` | No automated backup execution; no offsite storage; no restore verification |
| | ICT continuity | Partial | Connection pool, retry logic, **backup prerequisites verification** | No disaster recovery plan; no tested restore |

## Critical Security Findings

### A.12.4 / A.16.1 — Audit-log immutability: BLOCKED

The migration `002_add_audit_log_and_retention.sql` enforces:

- `REVOKE UPDATE, DELETE ON audit_log FROM PUBLIC` — application code cannot modify or delete audit rows
- `GRANT INSERT ON audit_log TO PUBLIC` — application can write new audit rows
- No RLS/GUC policies (session GUCs are not authorization boundaries)

**Critical limitation:** `REVOKE ... FROM PUBLIC` does NOT restrict:
- The **table owner** (who always has full privileges on their own table)
- **Superusers** (who bypass all privilege checks)
- Roles with `BYPASSRLS` (if RLS were enabled)

The application connects via `DATABASE_URL` or `DB_USER/DB_PASSWORD`. If that role is the `audit_log` table owner or a superuser, it can UPDATE/DELETE audit rows despite the REVOKE.

**Verification status:** BLOCKED. Cannot verify the deployed connection role without access to the Render dashboard or production DATABASE_URL. The `.env.example` documents `DB_USER=your-db-user` (not `postgres`), suggesting a non-superuser role is intended, but this is unconfirmed.

**Recommended deployment:** Create a dedicated non-owner, non-superuser database role for the application. Set `audit_log` OWNER to a separate administrative role. Grant only INSERT to the application role on `audit_log`. Audit log retention is then performed by the administrative role, not the application role.

### A.17 — Backup and recovery: Documented, not implemented

The backup service provides:
- `verifyPrerequisites()` — checks `pg_dump` availability and `DATABASE_URL`
- `generateManifest()` — describes backup scope (16 tables + Supabase Storage bucket `documents`)
- `buildBackupCommand()` / `buildSchemaCommand()` — generates `pg_dump` commands (not executed)
- `getRestoreRunbook()` — documents the restore procedure (pg_restore + storage sync)

**Critical gap:** No code executes `pg_dump` or `pg_restore`. No backup has been created or restored in any environment. Disaster recovery is **not verified**.

**Backup scope:**
- PostgreSQL data: all tables in `public`
- PostgreSQL schema: full schema dump
- Stored document objects: Supabase Storage bucket `documents` (private)
- Database records and storage objects must be backed up at the same point in time for consistency

### A.10.2 — Key management

`DOCUMENT_ENCRYPTION_KEY` is required at startup (`config/env.js:14,27-32`). The server refuses to boot without it. The key is SHA-256 derived to 32 bytes for AES-256-GCM.

**Key rotation:** Not implemented. Rotation requires manual env var change and re-encryption of all stored values.
**Key recovery:** Not implemented. Lost key = lost access to encrypted PII fields.

## Gap Summary

### Critical (Security)
1. **Audit-log administrative bypass** — table owner or superuser can bypass REVOKE (BLOCKED: needs production role verification)
2. **No key rotation schedule** — manual rotation only; no re-encryption path
3. **No key recovery mechanism** — lost key = lost access to encrypted PII

### Critical (Compliance/Quality)
4. **No automated backup execution** — readiness checking only; no pg_dump/pg_restore execution
5. **No backup/restore verification** — no backup has been created or restored in any environment
6. **No offsite storage** for backups

### High (Quality)
7. **No fuzzy search** — document content indexed but no typo-tolerant search
8. **No checksum/integrity verification** of stored files
9. **No API documentation** (OpenAPI/Swagger)
10. **No monitoring/alerting** beyond `/health/ready`

## Verification Artifacts

| Artifact | Path | Status |
|----------|------|--------|
| Audit-log immutability migration | `DocuGuard-Server/migrations/002_add_audit_log_and_retention.sql` | Implemented + documented limitation |
| Audit-log authorization tests | `DocuGuard-Server/tests/dataRetention.test.js` | Tested (INSERT-only verified) |
| Encryption service | `DocuGuard-Server/services/cryptoService.js` | Implemented + Tested (15 tests) |
| Encryption env validation | `DocuGuard-Server/config/env.js:14,27-32` | Implemented + Tested |
| Backup service | `DocuGuard-Server/services/backupService.js` | Implemented (orchestration only) |
| Backup service tests | `DocuGuard-Server/tests/backupService.test.js` | Tested (8 tests) |
| Search migration | `DocuGuard-Server/migrations/003_add_search_vector.sql` | Implemented |
| Search controller/route | `DocuGuard-Server/controllers/searchController.js`, `routes/search.js` | Implemented + Tested (6 tests) |
| Client search UI | `app/(tabs)/documents.tsx` | Implemented + Tested (5 API tests) |
| Client search API | `services/api.ts` | Implemented + Tested |

## Production Deployment Status

**Deferred.** Production deployment and OTA publication remain deferred until:
1. Audit-log connection role is verified against production database
2. Backup/restore procedure is executed and verified in an isolated test environment
3. Key rotation procedure is documented and approved
