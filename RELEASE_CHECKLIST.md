# DocuGuard Release Checklist

## Release: v1.0.1 — Compliance & Security Hardening

### Pre-Release Verification

#### Tests
- [ ] Client test suite: `npm test` — 163 tests, 0 failures
- [ ] Server test suite: `npm test` (in `DocuGuard-Server/`) — 105 tests (93 existing + 12 new), 0 failures
- [ ] Server syntax check: `npm run check:syntax` — 63 files parsed
- [ ] Client TypeScript typecheck: `npm run typecheck` — no errors

#### New Code Reviewed
- [ ] `DocuGuard-Server/migrations/002_add_audit_log_and_retention.sql` — audit_log, data_retention tables, `deleted_at` column, default retention backfill
- [ ] `DocuGuard-Server/services/auditService.js` — immutable audit log writer with best-effort failure handling
- [ ] `DocuGuard-Server/middleware/audit.js` — Express middleware capturing request outcomes for audit
- [ ] `DocuGuard-Server/middleware/audit.js` registered in `app.js` after routes, before 404 handler
- [ ] `DocuGuard-Server/jobs/dataRetention.js` — weekly cron cleanup for expired/deleted documents and audit log
- [ ] `DocuGuard-Server/jobs/dataRetention.js` registered in `app.js`
- [ ] `DocuGuard-Server/controllers/documentController.js` — soft-delete sets `deleted_at`, `needs_sync`, `sync_status`; excludes deleted docs from `getDocumentById`
- [ ] `DocuGuard-Server/tests/auditService.test.js` — 6 tests
- [ ] `DocuGuard-Server/tests/dataRetention.test.js` — 6 tests

#### Database Migration
- [ ] Migration `002_add_audit_log_and_retention.sql` reviewed and tested against a staging database
- [ ] Migration is idempotent (uses `IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `ON CONFLICT DO NOTHING`)
- [ ] Rollback plan documented (drop `audit_log`, `data_retention`; drop `deleted_at` column)

### ISO/IEC 27001 Compliance Items

#### Access Control (A.9)
- [ ] Per-user row-level scoping verified on all document routes (`WHERE user_id = $1`)
- [ ] `getDocumentById` excludes `status = 'deleted'` documents
- [ ] JWT auth middleware enforced on all protected routes
- [ ] Rate limiting: per-user (300/15min), per-IP auth (10/hour), upload (60/hour)

#### Cryptography (A.10)
- [ ] JWT_SECRET ≥ 32 characters (enforced at startup via `env.js`)
- [ ] Password hashing with bcrypt (10-12 salt rounds)
- [ ] TOTP 2FA implemented (profile routes)
- [ ] Signed URLs with 15-minute TTL for document access
- [ ] HTTPS-only file URL validation (SSRF protection)

#### Operations Security (A.12)
- [ ] Audit log table captures: auth events, data access/modification/deletion, 2FA, sessions, export
- [ ] Audit log entries are immutable (no UPDATE/DELETE by application code)
- [ ] Data retention job runs weekly (Sundays 02:00) to purge expired/deleted documents and old audit entries
- [ ] Per-user retention TTL settings with defaults (90 days expired, 30 days deleted, 365 days audit)
- [ ] `/health/ready` readiness probe validates database connectivity

#### Communications Security (A.13)
- [ ] CORS allowlist configured (fail-closed in production)
- [ ] Helmet security headers enabled
- [ ] File type allow-list (PDF, JPEG, PNG, WebP, HEIC/HEIF only)
- [ ] 15 MB max file size

#### Incident Management (A.16)
- [ ] Audit log captures security events (failed logins, permission denials, rate limit exceeds, invalid tokens)
- [ ] Error logging sanitized (no connection strings, passwords, or stack traces)

### ISO/IEC 25010 Quality Items

#### Reliability
- [ ] Retry budget: max 5 sync attempts with exponential backoff (30s base, 30min cap)
- [ ] Permanent failures parked (conflicts, auth, validation errors)
- [ ] Mirror failures never fail primary writes (best-effort Supabase mirror)
- [ ] Cloud draft compensation on failed local insert

#### Maintainability
- [ ] Pure logic modules (`localDate.js`, `syncPolicy.js`, `schemas.js`) shared between client and server
- [ ] Dependency injection in `documentSaveCore` and `documentSyncCore` for testability
- [ ] DebugLogger with sanitized diagnostic output

#### Performance Efficiency
- [ ] Database indexes on `expiry_date`, `needs_sync`, `user_id`, `cloud_id`, `deleted_at`
- [ ] Single aggregate dashboard query (replaces N+1 round trips)
- [ ] Bounded concurrency (5) in expiration checker and retention cleanup

### Security Review

#### Authentication
- [ ] Login/register rate-limited per IP (10/hour)
- [ ] Password enumeration resistance (forgot-password always returns success)
- [ ] 2FA enforced at login when `two_factor_secret` and `two_factor_enabled_at` are set
- [ ] Token revocation on sign-out (FCM token cleared)

#### Authorization
- [ ] Every document query scoped by `user_id`
- [ ] Storage key ownership validated (`ownsStorageKey`)
- [ ] OCR draft key format validated (`userId/<UUID>.<ext>`)
- [ ] Deleted documents excluded from reads

#### Data Protection
- [ ] Soft deletes preserve tombstones for sync; retention job purges after TTL
- [ ] Signed URLs are short-lived (15 min), never persisted as source of truth
- [ ] File upload paths are server-generated UUIDs (no user-supplied path components)
- [ ] PII fields not yet encrypted at rest (known gap — see backlog)

### Known Gaps (Deferred to v1.0.2+)

| Gap | Impact | Plan |
|-----|--------|------|
| Field-level encryption for PII at rest | Medium | Add `crypto` column-level encryption for document_number, issuer |
| Immutable append-only audit log | Medium | Add WAL-style immutable audit table or write-once storage |
| Data classification scheme | Low | Document classification labels on document rows |
| Key rotation for JWT_SECRET | Medium | Automated rotation with overlap period |
| Full-text search on document content | Low | PostgreSQL `tsvector` index on OCR text |
| Notification delivery receipts | Low | Track push/email delivery status |
| Backup & disaster recovery procedures | Medium | Document backup strategy and RTO/RPO |
| Incident response plan | Low | Document security incident handling procedures |
| OpenAPI/Swagger API documentation | Low | Generate API spec from route definitions |

### Release Sign-Off

- [ ] All tests pass (client + server + typecheck + syntax)
- [ ] Migration reviewed for staging database
- [ ] Security review completed (access control, cryptography, operations)
- [ ] Compliance matrix updated (`COMPLIANCE_MATRIX.md`)
- [ ] Release notes drafted

### Post-Release

- [ ] Monitor `/health/ready` endpoint for database connectivity
- [ ] Monitor audit log volume and retention job execution
- [ ] Review first weekly retention cleanup run
- [ ] Monitor error logs for audit write failures (should be rare)
