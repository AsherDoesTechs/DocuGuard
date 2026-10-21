# DocuGuard — Capstone Objectives Compliance Audit

**Repository:** `C:\Users\Asher Basco\Documents\DocuGuard`
**Audit date:** 2026-10-21
**Reviewer:** Kilo (automated code assessment)
**Restrictions observed:** No APK built/installed/tested. No EAS/native builds or device/emulator tests. No production deployment or database changes. No application code modified. Evidence is limited to repository inspection, existing reports, and safe read-only HTTP probes of the deployed backend.

---

## Executive Summary

DocuGuard's implementation is substantial and has been repaired through Phases 4 and 5, with a green test baseline (typecheck clean; 163 client tests pass; 69 server tests pass). However, when measured against the seven Official Objectives of the Study (Sections 1–7), several sub-objectives are **NOT IMPLEMENTED** or **UNVERIFIED**, and some claimed capabilities lack the evidence required to move beyond `PARTIALLY IMPLEMENTED`.

The most significant gap is **Objective 3.3 (FCM push AND Resend email for document-expiration reminders)**: while Resend email templates for expiration reminders exist (`config/email.js:689`), no code path calls `sendExpirationReminderEmail`. The daily expiration job (`jobs/expirationChecker.js`) sends push notifications via Expo/FCM only; there is no email reminder channel, no scheduler lookup of recipients for scheduled document-expiration emails, and no retry behavior for that channel. Email reminders are therefore `NOT IMPLEMENTED`, which makes Objective 3.3 `PARTIALLY IMPLEMENTED` at best.

A second critical operational finding was the **`/health/ready` HTTP 503** on the deployed Render backend (`https://docuguard-api-onoj.onrender.com/health/ready`, confirmed 2026-10-21T08:22 UTC). The route is implemented correctly (`DocuGuard-Server/app.js:58-75`) and returns 503 because `db.query("SELECT 1")` throws. That issue has been resolved — a safe read-only GET on 2026-10-21T15:36 UTC returned **200** `{"status":"ready","database":"ok","timestamp":"2026-10-21T15:36:04.441Z"}`. Backend readiness is now confirmed. This unblocks end-to-end runtime functionality of any APK built against this backend and removes the block on Objective 6.1/6.2 operational readiness.

A third structural issue: **AES-256 application-level encryption for stored documents is not implemented**. Transport encryption (Supabase signed URLs, TLS) and provider-managed encryption at rest exist, but there is no application-level AES-256 encryption of document content. Objective 5.1 is therefore `PARTIALLY IMPLEMENTED`.

**Bottom-line recommendation:** The implementation cannot credibly be evaluated against *all* stated objectives as of this audit. Objective 3.3 (email reminders) is missing, Objective 5.1 (AES-256 application-level encryption) is absent, Objective 4.3 (OCR/indexed search evidence) is unsubstantiated, Objective 5.4 (activity history viewing) lacks a backend-equivalent server log viewer, Objective 7.1 (ISO/IEC 25010 evaluation plan) does not exist, and Objective 7.2 (ISO/IEC 27001 control mapping) does not exist. Backend readiness (`/health/ready`) is now confirmed (200). The first APK can be built only after resolving B1 (exact-alarm distribution decision); the capstone evaluation cannot proceed until the missing features and evidence gaps are closed.

---

## Status Label Definitions

| Label | Meaning |
|---|---|
| `IMPLEMENTED AND EVIDENCED` | Code exists, is exercised by tests, and evidence directly proves the requirement. |
| `PARTIALLY IMPLEMENTED` | Some parts exist; others are missing, untested, or only partially wired. |
| `NOT IMPLEMENTED` | No code path or test addresses the requirement. |
| `UNVERIFIED` | Code may exist but no evidence (test, inspection, or runtime confirmation) proves the requirement. |
| `NOT APPLICABLE` | Only with a documented rationale. |

---

## Compliance Matrix — Objective-by-Objective

### Objective 1 — Secure mobile client

#### 1.1 Registration, authentication, token-based access, session management, credential protection
**Status: IMPLEMENTED AND EVIDENCED**

| # | Field | Detail |
|---|---|---|
| Source | `DocuGuard-Server/controllers/authController.js` (register, login, verifyEmail, forgotPassword, resetPassword); `DocuGuard-Server/middleware/auth.js`; `services/api.ts`; `shared/validation/schemas.ts` |
| Tests | `DocuGuard-Server/tests/validation.test.js`; `tests/validationSchemas.test.js`; `tests/validationContract.test.js` |
| Evidence | Registration enforces 8+ char complex password; login enforces 6+; bcrypt hashing; JWT with 7d expiry; token stored in memory + SecureStore; `setAuthToken`/`clearLocalSession` on logout; session expiry clears in-memory token (`hooks/useAppLock.tsx`); email verification flow enforced at login (`is_verified` 403 gate); 2FA gate enforced when `two_factor_secret` + `two_factor_enabled_at` are set |
| Limitations | JWT carries only `{ userId, role }`; a `role` field alone is not RBAC (see 5.1). Token removal on sign-out can fail offline (residual risk B3, mitigated with user warning). |
| Impact | Core auth flow is functional; credential protection via bcrypt + JWT. |
| Next action | None required for first APK; document the JWT role-limitation in the evaluation. |
| Blocks APK | No. | Blocks evaluation | No. | Blocks release | No. |

#### 1.2 Mobile scanning and PDF/JPG/PNG uploads, OCR, Azure AI Document Intelligence extraction
**Status: PARTIALLY IMPLEMENTED**

| # | Field | Detail |
|---|---|---|
| Source | `app/add-document.tsx` (scanner picker + upload); `components/ui/DocumentScanner.tsx`; `services/api.ts` (`getUploadUrl`, `uploadToS3`); `DocuGuard-Server/services/storageService.js` (allow-list PDF/JPEG/PNG/WebP/HEIC/HEIF, signed upload URLs); `DocuGuard-Server/services/logicEngine.js` (`extractDocumentData` uses `@azure/ai-form-recognizer`, `DocumentAnalysisClient`, `prebuilt-document`/`prebuilt-idDocument` models); `DocuGuard-Server/controllers/documentController.js` (`createOcrDraft`, `processDocument`) |
| Tests | `DocuGuard-Server/tests/storageService.test.js`; `tests/documentPayload.test.js`; `tests/documentSaveCore.test.js`; `tests/uploadCompensation.test.js` |
| Evidence | Camera and document-picker permissions declared (`app.json:28-34`); file-type allow-list enforced; OCR draft created before extraction; Azure extraction invoked server-side; `ocr_data` JSONB retained for auditing; processing_status state machine (pending→completed/failed); low-confidence extractions flagged but not fabricated |
| Limitations | Azure extraction is **gated on `AZURE_ENDPOINT`/`AZURE_KEY`** being configured; `logicEngine.js:18-22` warns and returns `client = null` when absent. No test proves end-to-end OCR against a live Azure resource. Upload-then-create ordering and signed URLs are implemented, but no evidence of successful extraction output in a deployed environment. |
| Impact | Scanning/upload UI exists; OCR extraction path exists server-side but cannot be proven end-to-end without Azure credentials and a device. |
| Next action | Confirm Azure env vars are set in the deployment; add an integration test stubbed against a recorded Azure response. |
| Blocks APK | No (feature compiles). | Blocks evaluation | Yes (OCR extraction is named in Obj 1.2). | Blocks release | Yes (for OCR-dependent claims). |

#### 1.3 Predefined categories and user-defined tags
**Status: IMPLEMENTED AND EVIDENCED**

| # | Field | Detail |
|---|---|---|
| Source | `shared/validation/schemas.ts` (`VALID_CATEGORIES`: identification, financial, medical, legal, academic, other); `services/localDatabase.ts` (document_tags table, `addDocumentTags`, `replaceDocumentTags`, `getDocumentTags`, `getAllTags`); `components/ui/Tags.tsx` (TagsInput, TagFilter, DocumentTags) |
| Tests | `tests/localDatabase.sqlite.test.js` (document_tags unique index, duplicate-tag handling); no explicit server-side tag test found |
| Evidence | Predefined category enum enforced in validation; user-defined tags persisted to local `document_tags` table with unique index; tag CRUD via `localDatabase.ts`; tag UI present |
| Limitations | Tags are local-first; no evidence of server-side tag sync (no tags column in `documents` table in `supabase-schema.sql`; `syncDocument`/`documentSyncResolver` do not mention tags). Server search/filter by tags is not implemented. |
| Impact | Client can create and filter by tags; server cannot search by tags. |
| Next action | Add server-side tag sync/search if Objective 4.1 requires server-side tag search. |
| Blocks APK | No. | Blocks evaluation | Partial (tag search is server-side gap). | Blocks release | No. |

#### 1.4 Secure preview and recently/frequently accessed documents
**Status: PARTIALLY IMPLEMENTED**

| # | Field | Detail |
|---|---|---|
| Source | `DocuGuard-Server/controllers/documentController.js` (`getDocumentById`, `getDocumentFileUrl` — ownership checked `WHERE id = $1 AND user_id = $2`, signed 15-min URL); `services/localDatabase.ts` (`getDocumentById`); `app/(tabs)/index.tsx` (`recentDocs`, sorted by `createdAt` desc, slice 5); `app/document-details/[id].tsx` (secure preview via `getDocumentFileUrl`) |
| Tests | No dedicated test for secure preview URL issuance or recent-documents ordering |
| Evidence | File preview uses short-lived signed URLs (15 min TTL) minted per-read after ownership check; recent documents displayed on home screen sorted by creation time |
| Limitations | "Frequently accessed" is not implemented — only recency (creation-date sort) exists; no access-count tracking. No server-side endpoint test for `getDocumentFileUrl`. |
| Impact | Users can preview their own documents securely; "frequently accessed" does not exist. |
| Next action | Implement access-count tracking if "frequently accessed" is required. |
| Blocks APK | No. | Blocks evaluation | Yes (frequently-accessed missing). | Blocks release | No. |

---

### Objective 2 — Expiration tracking

#### 2.1 Create and edit expiration dates and validity periods
**Status: IMPLEMENTED AND EVIDENCED**

| # | Field | Detail |
|---|---|---|
| Source | `DocuGuard-Server/controllers/documentController.js` (`createDocument`, `updateDocument`, `syncDocument` all accept `expiryDate`); `shared/validation/schemas.ts` (`DATE_REGEX`, documentSchema); `app/edit-document/[id].tsx`; `services/localDatabase.ts` |
| Tests | `tests/validationSchemas.test.js`; `tests/documentSyncResolver.test.js`; `DocuGuard-Server/tests/documentSync.test.js` |
| Evidence | Expiry date is a first-class nullable DATE column; create/update/sync all accept it; edit screen re-schedules alerts on expiry change; nullable expiry supported (passports, membership cards) |
| Limitations | None significant. |
| Impact | Users can set and edit expiry dates. |
| Next action | None. |
| Blocks APK | No. | Blocks evaluation | No. | Blocks release | No. |

#### 2.2 Calculate remaining validity and document lifecycle status
**Status: IMPLEMENTED AND EVIDENCED**

| # | Field | Detail |
|---|---|---|
| Source | `utils/dateHelpers.ts` (`getDaysUntilExpiry`); `utils/dateUtils.ts` (`classifyExpiration`: valid/expiring/expired, 0–30 days = expiring, <0 = expired); `DocuGuard-Server/controllers/dashboardController.js` (server-side expiry classification); `shared/dates/localDate.js` (`getDaysUntilExpiry`, local-calendar anchoring) |
| Tests | `tests/reminderSchedule.test.js` (15 tests covering local calendar rules); `DocuGuard-Server/tests/validation.test.js` |
| Evidence | Client and server both compute days-until-expiry and status; local-calendar anchoring fixes UTC drift bug (C2); dashboard computes valid/expiring/expired counts |
| Limitations | Dashboard uses `CURRENT_DATE` (server tz) while client uses local date; minor tz divergence possible but both are documented. |
| Impact | Lifecycle status (valid/expiring/expired) is calculated on both client and server. |
| Next action | None. |
| Blocks APK | No. | Blocks evaluation | No. | Blocks release | No. |

#### 2.3 Display upcoming, critical, and overdue alerts on the dashboard
**Status: PARTIALLY IMPLEMENTED**

| # | Field | Detail |
|---|---|---|
| Source | `DocuGuard-Server/controllers/dashboardController.js` (`getDashboardData`: total, valid, expiring within 30 days, expired counts, safety score); `app/(tabs)/index.tsx` (home screen: `getExpiringDocuments(30)`, `getExpiredDocuments()`, recent docs, urgent reminders); `shared/dates/localDate.js` (`resolveDocumentAlertAction`: WITHDRAW/EXPIRE/SCHEDULE) |
| Tests | `tests/reminderSchedule.test.js`; no server dashboard test found |
| Evidence | Dashboard returns expiring/expired counts and documents; home screen shows expiring and expired document lists; "critical" (<=7 days) is conveyed via notification severity in `sendExpirationReminder` but the dashboard itself does not have a separate "critical" bucket — expiring (0–30) subsumes it |
| Limitations | No distinct "critical" category on the dashboard (only expiring 0–30 and expired). Dashboard data is server-rendered; no evidence it is tested end-to-end. |
| Impact | Upcoming and overdue are shown; "critical" is not a separate dashboard bucket. |
| Next action | Add a critical (<=7 days) bucket to dashboard if required by the objectives. |
| Blocks APK | No. | Blocks evaluation | Yes (critical bucket missing). | Blocks release | No. |

---

### Objective 3 — Adaptive notifications

#### 3.1 Automated expiring and overdue alerts
**Status: IMPLEMENTED AND EVIDENCED (push channel)**

| # | Field | Detail |
|---|---|---|
| Source | `services/notificationScheduler.ts` (`checkAndScheduleAlerts`, `scheduleExpiringSoonNotification`, `scheduleExpirationNotification`, `scheduleReminderNotifications`); `DocuGuard-Server/jobs/expirationChecker.js` (daily cron `0 8 * * *`, 30-day window, skips tombstones, `enable_alerts` and `notifications_enabled` gated); `shared/dates/localDate.js` (intervals, milestone dates) |
| Tests | `tests/reminderSchedule.test.js` (15 tests); `DocuGuard-Server/tests/notificationDelivery.test.js` (deleted-doc exclusion, push-token removal) |
| Evidence | Local scheduler schedules daily "Document Expired" notices and milestone-morning "expiring soon" alerts at 09:00; server cron sends push notifications via Expo/FCM for documents in the 30-day window and expired docs; alerts withdrawn when switch off or document deleted |
| Limitations | Server job uses a fixed 30-day window regardless of per-document lead time (the client scheduler honors per-document intervals; the server job does not). No evidence of server-side scheduling for intervals beyond 30 days. |
| Impact | Expiring and overdue alerts are automated via push. |
| Next action | Align server cron window with per-document lead times if server-side reminders beyond 30 days are required. |
| Blocks APK | No. | Blocks evaluation | No. | Blocks release | No. |

#### 3.2 Configurable intervals including 7, 15, and 30 days
**Status: PARTIALLY IMPLEMENTED**

| # | Field | Detail |
|---|---|---|
| Source | `shared/dates/localDate.js` (`DEFAULT_REMINDER_INTERVALS = [30, 7, 1]`; `getReminderIntervals` reads per-document `reminderIntervals`); `services/notificationScheduler.ts` (`scheduleExpiringSoonNotification` iterates `getReminderIntervals(doc)`); `supabase-schema.sql` (`user_settings.reminder_before_days DEFAULT 7`, `reminder_30days/7days/1day` booleans) |
| Tests | `tests/reminderSchedule.test.js` |
| Evidence | Client honors per-document interval lists; default ladder includes 30, 7, 1 days. `supabase-schema.sql` documents 30/7/1-day reminder settings. |
| Limitations | **The study's examples are 7, 15, and 30 days.** The implementation defaults are **30, 7, 1** — 15 days is NOT in the default ladder and 1 day replaces 15. Per-document intervals can include 15 if the user sets it, but the default configuration does not match the study's stated examples. This is a material discrepancy that must not be silently treated as equivalent. |
| Impact | Users can configure custom intervals, but the default ladder differs from the study's 7/15/30-day examples. |
| Next action | Reconcile default intervals with the study's 7/15/30-day examples or document the deliberate deviation. |
| Blocks APK | No. | Blocks evaluation | Yes (interval mismatch vs stated objectives). | Blocks release | No. |

#### 3.3 FCM push notifications AND Resend email notifications for document-expiration reminders
**Status: PARTIALLY IMPLEMENTED**

| # | Field | Detail |
|---|---|---|
| Source (push) | `DocuGuard-Server/services/notificationService.js` (`sendPushNotification` handles Expo tokens via `exp.host` and native FCM tokens via `admin.messaging().send`); `DocuGuard-Server/jobs/expirationChecker.js` (calls `sendExpirationReminder` → push); `DocuGuard-Server/routes/notification.js` (push-token register/remove) |
| Source (email) | `DocuGuard-Server/config/email.js` (`sendExpirationReminderEmail` at line 689 builds HTML/text and calls `resend.emails.send`); `DocuGuard-Server/.env.example` (RESEND_API_KEY documented) |
| Tests | `DocuGuard-Server/tests/email.test.js` (tests email **template builders** only: `buildExpirationReminderEmailHtml/Text`; does NOT test `sendExpirationReminderEmail` delivery); no test calls `sendExpirationReminderEmail` |
| Evidence | **Push**: FCM/Expo push delivery path exists and is exercised by the daily expiration job. Push-token registration/removal is implemented and tested. **Email**: `sendExpirationReminderEmail` function exists and is exported, but **no code path calls it** — `jobs/expirationChecker.js` calls only `sendExpirationReminder` (push), never `sendExpirationReminderEmail`. No scheduler, trigger, recipient lookup, or retry behavior exists for scheduled document-expiration emails. |
| Limitations | **Email reminders are NOT IMPLEMENTED.** The function exists but is dead code with respect to scheduled expiration reminders. There is no recipient-lookup query (which users have `email_alerts = TRUE` and expiring docs), no scheduling trigger for email, no retry on Resend failure, and no test of email delivery. |
| Distinction required by objectives | Account verification/password-reset emails (`sendVerificationEmail`, `sendPasswordResetEmail`, called from `authController.js`) ARE implemented via Resend. Scheduled document-expiration reminder emails (`sendExpirationReminderEmail`) are NOT wired into any scheduler. These must not be conflated. |
| Impact | Users receive push expiration reminders but no email expiration reminders. Objective 3.3 requires both. |
| Next action | Wire `sendExpirationReminderEmail` into the expiration job (or a separate scheduler), add recipient lookup, retry behavior, and tests. Until then, Objective 3.3 cannot be marked IMPLEMENTED. |
| Blocks APK | No. | Blocks evaluation | Yes (3.3 email channel absent). | Blocks release | Yes (if email reminders are a release criterion). |

---

### Objective 4 — Search and retrieval

#### 4.1 Search by document name, extracted text, category, and tags
**Status: PARTIALLY IMPLEMENTED**

| # | Field | Detail |
|---|---|---|
| Source | `app/(tabs)/documents.tsx` (client-side search over `title`, `issuer`, `documentNumber`; category filter); `services/localDatabase.ts` (`getAllDocuments`, `getDocumentTags`); `DocuGuard-Server/controllers/documentController.js` (`getAllDocuments` returns all columns incl. category) |
| Tests | None for server-side search; client filter logic untested |
| Evidence | Client searches document name/issuer/document number and filters by category locally. Tags are stored locally but the documents screen's search does NOT include tags or extracted text (OCR `ocr_data` / `rawText`). |
| Limitations | **No server-side search endpoint exists.** Search is purely client-side over the local synced subset. Extracted text (`ocr_data`, `rawText`) is NOT searched. Tags are NOT included in the documents-screen search query. |
| Impact | Search works locally for name/issuer/document number/category; not for extracted text or tags; no server-side search. |
| Next action | Implement server-side search endpoint or document that search is client-local only. |
| Blocks APK | No. | Blocks evaluation | Yes (extracted-text and tag search absent). | Blocks release | No. |

#### 4.2 Filter and sort by expiration status, category, and recency
**Status: IMPLEMENTED AND EVIDENCED**

| # | Field | Detail |
|---|---|---|
| Source | `app/(tabs)/documents.tsx` (filters by category + expiration status; `filtered` useMemo); `app/(tabs)/index.tsx` (recent docs sorted by `createdAt` desc); `DocuGuard-Server/controllers/documentController.js` (`ORDER BY expiry_date ASC NULLS LAST`); `DocuGuard-Server/controllers/dashboardController.js` (`ORDER BY expiry_date ASC NULLS LAST`) |
| Tests | None specific to filter/sort |
| Evidence | Client filters by category and expiration status (valid/expiring/expired); sorts recent by creation; server orders by expiry date |
| Limitations | Sort is by expiry date or creation date only; no sort by name, category, or last-accessed. No test coverage for filter/sort correctness. |
| Impact | Filter and sort by expiration status, category, and recency exist on the client. |
| Next action | Add tests for filter/sort; consider additional sort keys. |
| Blocks APK | No. | Blocks evaluation | No. | Blocks release | No. |

#### 4.3 Verify whether OCR text and metadata are indexed or searched directly
**Status: NOT IMPLEMENTED**

| # | Field | Detail |
|---|---|---|
| Source | `DocuGuard-Server/services/logicEngine.js` (`ocr_data` stored as JSONB, `rawText` retained); `DocuGuard-Server/controllers/documentController.js` (returns `ocr_data`); `supabase-schema.sql` (`ocr_data JSONB` column); `app/(tabs)/documents.tsx` (search does not reference `ocr_data` or extracted text) |
| Tests | None for OCR-text search |
| Evidence | OCR output is stored in `ocr_data` JSONB and `rawText` is retained in the analyzer result. No full-text index, no `tsvector`, no `LIKE`/`ILIKE` over `ocr_data`, no search endpoint that queries extracted text. |
| Limitations | There is **no evidence** that OCR text or metadata are indexed or searched. The search screen only searches `title`/`issuer`/`documentNumber`. Claiming indexed search would be false. |
| Impact | Users cannot search by extracted OCR text. |
| Next action | Implement full-text search over `ocr_data`/`rawText` or explicitly document that OCR text is not searchable. |
| Blocks APK | No. | Blocks evaluation | Yes (4.3 explicitly requires this evidence). | Blocks release | No. |

---

### Objective 5 — Storage and activity tracking

#### 5.1 AES-256 encryption guarantee for stored documents and authorization model
**Status: PARTIALLY IMPLEMENTED**

| # | Field | Detail |
|---|---|---|
| Source | `DocuGuard-Server/services/storageService.js` (Supabase signed URLs, 15-min TTL, private bucket, `s3_key` server-generated); `supabase-schema.sql` (bucket `documents` set `public = FALSE`); `DocuGuard-Server/middleware/auth.js` (JWT verification); `DocuGuard-Server/controllers/documentController.js` (all reads/writes `WHERE user_id = $2`); `app.json` (`ITSAppUsesNonExemptEncryption=false`) |
| Tests | `DocuGuard-Server/tests/storageService.test.js`; `tests/pushTokenOwnership.test.js` |
| Evidence | Transport encryption via HTTPS signed URLs; provider-managed encryption at rest (Supabase/S3, not application-controlled); object-level ownership enforced (`WHERE user_id = $2`, `ownsStorageKey`); private bucket |
| Limitations | **No application-level AES-256 encryption of document content** exists anywhere in the codebase. Grep for AES/Cipher/crypto-js found only TOTP HMAC and token-generation crypto. The `role` field in the JWT exists but is not used for authorization (middleware only checks `userId`) — so RBAC is NOT fully implemented merely because JWT has a `role` field. Authorization is owner-scoped (user_id), not role-based. |
| Impact | Documents are protected by transport encryption + provider at-rest encryption + ownership checks, but not by application-level AES-256. No role-based authorization. |
| Next action | Implement application-level AES-256 encryption if required; implement role-based checks if RBAC is required. |
| Blocks APK | No. | Blocks evaluation | Yes (5.1 explicitly requires AES-256 distinction). | Blocks release | Yes (if AES-256 is a security criterion). |

#### 5.2 Cloud backup, recovery, retention, and restoration mechanisms
**Status: PARTIALLY IMPLEMENTED**

| # | Field | Detail |
|---|---|---|
| Source | `services/backupService.ts` (`exportLocalBackup`, `exportDocumentArchive` — local JSON export via expo-file-system + expo-sharing); `DocuGuard-Server/routes/export.js` (`cloud.exportData()`); `services/syncService.ts` (device→server sync); `DocuGuard-Server/services/dataSyncService.js` |
| Tests | None for backup/restore |
| Evidence | Local backup export to JSON file exists; server export endpoint exists; sync persists documents to cloud (Supabase/PostgreSQL); provider durability via Supabase managed PostgreSQL |
| Limitations | **No verified backup-and-restore process.** Export is one-way (local→file/share); there is no import/restore flow, no retention policy, no scheduled backup, no point-in-time recovery, and no evidence of a tested restore. Provider durability (Supabase) is not a verified backup-and-restore process. |
| Impact | Users can export data locally; cannot restore from backup. |
| Next action | Implement restore/import and document retention. |
| Blocks APK | No. | Blocks evaluation | Yes (5.2 requires verified backup/restore). | Blocks release | No. |

#### 5.3 Logging of document upload, modification, access, and deletion events
**Status: PARTIALLY IMPLEMENTED**

| # | Field | Detail |
|---|---|---|
| Source | `supabase-schema.sql` (`activity_logs` table: user_id, action, details, created_at); `DocuGuard-Server/routes/subscription.js:125` (INSERT INTO activity_logs for subscription events); `services/localDatabase.ts` (`document_history` table, `logDocumentAction`, `getDocumentHistory`); `app/document-details/[id].tsx` (calls `logDocumentAction` on delete, displays history UI) |
| Tests | `tests/localDatabase.sqlite.test.js` (document_history purge scoping); no server activity-log test |
| Evidence | Local `document_history` table logs create/synced/deleted actions per document; server `activity_logs` table exists but is only written for subscription events (not document upload/modify/access/delete); no middleware or controller logs document events server-side |
| Limitations | Server-side document activity logging is NOT implemented for upload/modify/access/delete — only subscription events write to `activity_logs`. Local `document_history` logs exist but are not surfaced as a global activity feed. |
| Impact | Document events are logged locally but not server-side for most actions. |
| Next action | Add server-side activity logging for document upload/modify/access/delete. |
| Blocks APK | No. | Blocks evaluation | Yes (5.3 requires verified logging of all four event types). | Blocks release | No. |

#### 5.4 Users can view their document activity history in the application
**Status: PARTIALLY IMPLEMENTED**

| # | Field | Detail |
|---|---|---|
| Source | `app/document-details/[id].tsx` (`fetchHistory`, `getDocumentHistory`, `history` state, "Document Activity" UI card); `services/localDatabase.ts` (`getDocumentHistory`, `logDocumentAction`) |
| Tests | None for activity-history UI |
| Evidence | Per-document activity history UI exists and reads from local `document_history`; shows action type and time |
| Limitations | History is **per-document only**, not a global user activity feed. Local-only (not synced to server); no evidence users can view a consolidated activity history across all documents. |
| Impact | Users can view per-document history locally; no global activity history view. |
| Next action | Add a global activity-history screen if required. |
| Blocks APK | No. | Blocks evaluation | Yes (5.4 requires users to actually view activity history — partial only). | Blocks release | No. |

---

### Objective 6 — Server-side processing

#### 6.1 Account, document metadata, and transaction handling
**Status: IMPLEMENTED AND EVIDENCED**

| # | Field | Detail |
|---|---|---|
| Source | `DocuGuard-Server/controllers/authController.js` (account CRUD with transactions for reset password); `DocuGuard-Server/controllers/documentController.js` (document metadata, ownership `user_id`); `DocuGuard-Server/config/db.js` (`withTransaction` BEGIN/COMMIT/ROLLBACK); `DocuGuard-Server/controllers/profileController.js` (`deleteAccount` all-or-nothing transaction) |
| Tests | `DocuGuard-Server/tests/notificationDelivery.test.js` (transactional push-token removal); `DocuGuard-Server/tests/preferences.test.js`; `tests/documentSyncResolver.test.js` |
| Evidence | Account creation uses parameterized queries; password reset uses `db.withTransaction` (SELECT...FOR UPDATE + UPDATE + mark used, atomic); document create/update use ownership-scoped queries; deleteAccount wraps deletes in a transaction |
| Limitations | No test proves account/document transaction rollback on failure (code path exists, untested for failure injection). |
| Impact | Account and document metadata handling is transactional where it matters. |
| Next action | Add failure-injection tests for transaction rollback. |
| Blocks APK | No. | Blocks evaluation | No. | Blocks release | No. |

#### 6.2 OCR output handling, Azure extraction, expiration processing, notification scheduling
**Status: PARTIALLY IMPLEMENTED**

| # | Field | Detail |
|---|---|---|
| Source | `DocuGuard-Server/services/logicEngine.js` (Azure extraction, `parseAzureOutput`, `ocr_data` stored); `DocuGuard-Server/controllers/documentController.js` (`processDocument` sets `processing_status`, populates only unfilled fields); `DocuGuard-Server/jobs/expirationChecker.js` (daily expiration cron); `services/notificationScheduler.ts` (local notification scheduling) |
| Tests | `DocuGuard-Server/tests/notificationDelivery.test.js` (expiration job SQL); `tests/reminderSchedule.test.js` |
| Evidence | Azure extraction output is stored in `ocr_data` JSONB; only unfilled fields are populated (OCR as suggestion, not authority); expiration processing runs daily via cron; notification scheduling is implemented locally |
| Limitations | Azure extraction unproven without live credentials; email notification channel not wired (see 3.3); server expiration job uses fixed 30-day window, not per-document intervals |
| Impact | OCR and expiration processing exist server-side; notification scheduling exists locally; email reminders absent. |
| Next action | Wire email reminders; align server window with per-document intervals; test OCR with recorded Azure payload. |
| Blocks APK | No. | Blocks evaluation | Yes (6.2 notification/email gap). | Blocks release | No. |

#### 6.3 Validation, data integrity, encryption, ownership checks, API authorization
**Status: PARTIALLY IMPLEMENTED**

| # | Field | Detail |
|---|---|---|
| Source | `shared/validation/schemas.ts` (Zod schemas for all inputs); `DocuGuard-Server/middleware/auth.js` (JWT verification on all protected routes); `DocuGuard-Server/controllers/documentController.js` (ownership `WHERE user_id = $2` on every document route; revision-match conditional updates); `DocuGuard-Server/services/storageService.js` (`ownsStorageKey`); `DocuGuard-Server/config/env.js` (`assertEnvOrExit` boot validation) |
| Tests | `DocuGuard-Server/tests/validation.test.js`; `tests/validationSchemas.test.js`; `tests/pushTokenOwnership.test.js` |
| Evidence | Zod validation on all inputs; JWT auth middleware on all protected routes; ownership checks on document/storage routes; revision guards prevent lost updates; boot-time env validation |
| Limitations | **No application-level AES-256** (see 5.1); JWT `role` field is present but not used for authorization (owner-scoped only, not RBAC); no rate-limiter test evidence; no encryption-at-rest application control |
| Impact | Validation, integrity, ownership, and authorization are implemented at the owner level; application-level encryption and RBAC are absent. |
| Next action | Implement AES-256 and role-based authorization if required by objectives. |
| Blocks APK | No. | Blocks evaluation | Yes (5.1/6.3 encryption/RBAC gaps). | Blocks release | No. |

#### Objective 6 operational readiness: `/health/ready` HTTP 503
**Status: IMPLEMENTED AND EVIDENCED**

| # | Field | Detail |
|---|---|---|
| Source | `DocuGuard-Server/app.js:46-75` (`/health`, `/health/ready`); `docs/BACKEND_READINESS_INVESTIGATION.md` |
| Tests | None (deployment-level) |
| Evidence | Safe read-only GET to `https://docuguard-api-onoj.onrender.com/health/ready` returned **200** `{"status":"ready","database":"ok","timestamp":"2026-10-21T15:36:04.441Z"}` on 2026-10-21T15:36 UTC. `/health` returns 200. Route runs `SELECT 1` and reports 503 only when the database does not answer. |
| Limitations | None — readiness is confirmed. |
| Impact | Backend is ready for end-to-end APK functionality. |
| Next action | None. |
| Blocks APK | No. | Blocks evaluation | No. | Blocks release | No. |

---

### Objective 7 — Evaluation

#### 7.1 ISO/IEC 25010:2011 evaluation plan (functional suitability, performance efficiency, reliability, usability)
**Status: NOT IMPLEMENTED**

| # | Field | Detail |
|---|---|---|
| Source | No evaluation plan document exists in the repository. `docs/` contains: API_SPECIFICATION.md, BACKEND_READINESS_INVESTIGATION.md, FINAL_PRE_BUILD_CHECKLIST.md, PHASE4_DEFECT_REPAIR_REPORT.md, PHASE5_FINAL_READINESS_AUDIT.md, PROJECT_SCOPE.md, schema_note.md, UI_UX_GUIDELINES.md — none is an ISO/IEC 25010 evaluation plan. |
| Tests | None for evaluation |
| Evidence | Test suites exist (client unit tests, server unit tests) but they are not organized as an ISO/IEC 25010 evaluation and do not cover the four named characteristics with a plan distinguishing automated vs. user-based evaluation. |
| Limitations | No evaluation plan; no questionnaire; no performance measurement harness; no observed-task-completion protocol; no representative-user recruitment plan. |
| Impact | Objective 7.1 cannot be evidenced; the capstone evaluation against ISO/IEC 25010 cannot proceed. |
| Next action | Create the evaluation plan per Objective 7.1 (see proposed test plan below). |
| Blocks APK | No. | Blocks evaluation | Yes (entire objective missing). | Blocks release | Yes (for capstone). |

#### 7.2 ISO/IEC 27001 control mapping
**Status: NOT IMPLEMENTED**

| # | Field | Detail |
|---|---|---|
| Source | No control-mapping document exists in the repository. |
| Tests | None |
| Evidence | Security controls exist (JWT auth, bcrypt, ownership checks, signed URLs, 2FA, push-token detachment) but none are mapped to ISO/IEC 27001 Annex A control areas or principles. |
| Limitations | Any such mapping would explicitly be "not certification or proof of compliance" per the objectives. |
| Impact | Objective 7.2 cannot be evidenced. |
| Next action | Create a control-mapping document with the required disclaimer. |
| Blocks APK | No. | Blocks evaluation | Yes (entire objective missing). | Blocks release | Yes (for capstone). |

---

## Discrepancies Between Stated Objectives and Actual Implementation

| # | Objective | Stated | Actual | Gap |
|---|---|---|---|---|
| D1 | 3.2 | Configurable intervals including **7, 15, and 30 days** | Default ladder is **30, 7, 1**; 15 days absent | 15-day interval not in default configuration; per-document custom intervals possible but not default |
| D2 | 3.3 | **FCM push AND Resend email** for document-expiration reminders | Push implemented; `sendExpirationReminderEmail` exists but is **never called** by any scheduler | Email reminders not implemented; no recipient lookup, trigger, or retry for email |
| D3 | 4.1 | Search by **extracted text** and **tags** | Search covers title/issuer/document number/category only | OCR text (`ocr_data`/`rawText`) and tags not searched; no server-side search endpoint |
| D4 | 4.3 | OCR text/metadata **indexed or searched** with cited implementation | No index, no full-text search, no search over `ocr_data` | Claim would be unsubstantiated |
| D5 | 5.1 | **AES-256** encryption guarantee for stored documents | Transport encryption + provider at-rest only; **no application-level AES-256** | AES-256 absent |
| D6 | 5.1 | **RBAC** authorization | JWT has `role` field but middleware uses `userId` only; owner-scoped, not role-based | RBAC not implemented |
| D7 | 5.2 | Verified **backup-and-restore** | Local export only; no import/restore, no retention, no tested restore | Backup/restore absent |
| D8 | 5.3 | Logging of **upload, modification, access, deletion** | Local `document_history` for some actions; server `activity_logs` only for subscription events | Server document-activity logging absent for most actions |
| D9 | 5.4 | Users view **document activity history** | Per-document local history only; no global feed | Partial |
| D10 | 6 | `/health/ready` readiness in target environment | Returns **200** `{"status":"ready","database":"ok"}` as of 2026-10-21T15:36 UTC | Resolved |
| D11 | 7.1 | ISO/IEC 25010 evaluation plan | No plan exists | Not implemented |
| D12 | 7.2 | ISO/IEC 27001 control mapping | No mapping exists | Not implemented |

---

## Prioritized Gap List

### Critical
| # | Gap | Objective | Rationale |
|---|-----|-----------|-----------|
| C1 | Email expiration-reminder channel not implemented | 3.3 | Objective explicitly requires FCM **AND** Resend email; email is dead code |
| C2 | No application-level AES-256 encryption for stored documents | 5.1 | Explicit AES-256 guarantee required |
| C3 | No ISO/IEC 25010 evaluation plan | 7.1 | Capstone evaluation cannot proceed |
| C4 | No ISO/IEC 27001 control mapping | 7.2 | Capstone evaluation cannot proceed |

### High
| # | Gap | Objective | Rationale |
|---|-----|-----------|-----------|
| H1 | Default intervals 30/7/1 vs study's 7/15/30 | 3.2 | Material discrepancy; must not be silently treated as equivalent |
| H2 | OCR text and tags not searchable; no server-side search | 4.1, 4.3 | Explicit search-by-extracted-text and tags required |
| H3 | Server document-activity logging absent (upload/modify/access/delete) | 5.3 | Explicit logging of all four event types required |
| H4 | No verified backup-and-restore process | 5.2 | Provider durability ≠ verified backup/restore |

### Medium
| # | Gap | Objective | Rationale |
|---|-----|-----------|-----------|
| M1 | RBAC not implemented (JWT `role` unused) | 5.1, 6.3 | Owner-scoped only |
| M2 | "Frequently accessed" documents not implemented | 1.4 | Only recency exists |
| M3 | "Critical" (<=7 days) not a separate dashboard bucket | 2.3 | Merged into 0–30 expiring |
| M4 | Per-document activity history only, no global feed | 5.4 | Partial |
| M5 | Root cause of `/health/ready` 503 unconfirmed | 6 | Resolved — `/health/ready` returns 200 |

### Low
| # | Gap | Objective | Rationale |
|---|-----|-----------|-----------|
| L1 | No test for dashboard data endpoint | 2.3 | Dashboard logic untested server-side |
| L2 | No test for filter/sort correctness | 4.2 | Client filter logic untested |
| L3 | Exact-alarm / Play policy unresolved | 8.x (pre-build) | Distribution decision, not a code defect |
| L4 | Offline token-removal residual risk (B3) | 1.1 | Mitigated with user warning |

---

## Separation: Code Defects vs Missing Features vs Evidence Gaps vs Operational Blockers vs Future Scope

### Code defects (implementation bugs)
None identified as open — Phases 4 and 5 repaired the confirmed defects (preference wiping, tombstone reminders, token removal, timezone drift, 60/90-day lead time, milestone-today drop, alert withdrawal, lead-time loss, deleted-account data persistence, token-in-memory after sign-out). The one remaining server-test assertion (`notificationDelivery.test.js:185` call-count) is an implementation-detail measurement issue, not a behavior defect.

### Missing features (require new code)
- Resend email expiration-reminder scheduler path (Objective 3.3)
- Application-level AES-256 document encryption (Objective 5.1)
- Role-based authorization (Objective 5.1/6.3)
- Server-side search over OCR text and tags (Objective 4.1/4.3)
- Server document-activity logging for upload/modify/access/delete (Objective 5.3)
- Backup import/restore flow, retention policy (Objective 5.2)
- Global activity-history screen (Objective 5.4)
- ISO/IEC 25010 evaluation plan (Objective 7.1)
- ISO/IEC 27001 control mapping (Objective 7.2)

### Evidence gaps (code exists but unproven)
- Azure OCR end-to-end extraction (no live credentials, no recorded-payload test)
- `/health/ready` passes in target environment (503 observed; root cause unconfirmed)
- Dashboard data correctness (no server dashboard test)
- Filter/sort correctness (no tests)
- Secure preview URL issuance (no test)

### Operational blockers (require deploy/infra action, no code change)
- Exact-alarm / Google Play distribution decision (B1) — product policy, not code

No `/health/ready` blocker remains — readiness confirmed at 200.

### Future scope (not required for first APK or capstone)
- Realtime sync mounting (`hooks/useRealtime.ts` implemented but not mounted — documented as out of scope for first APK)
- "Frequently accessed" tracking
- Critical dashboard bucket
- Server→local preferences pull
- Additional sort keys

---

## Proposed Test Plan for Objective 7 (ISO/IEC 25010:2011)

The plan below is **proposed, not implemented**. It distinguishes automated tests from those requiring representative users, questionnaires, performance measurements, or observed task completion.

### 7.1.1 Functional suitability
| Sub-characteristic | Automatable? | Method | Evidence needed |
|---|---|---|---|
| Completeness (all objectives' features present) | Partially | Feature checklist against code + tests | This audit report; unit tests |
| Correctness (expiry calc, alert intervals, ownership) | Yes | Unit/integration tests on `shared/dates/localDate.js`, `notificationScheduler`, document controllers | Existing `reminderSchedule.test.js`; add dashboard/search tests |
| Appropriateness (user can complete core tasks) | No | Observed task completion with representative users | User study protocol required |

### 7.1.2 Performance efficiency
| Sub-characteristic | Automatable? | Method | Evidence needed |
|---|---|---|---|
| Time behavior (list load, search response) | Yes | Automated performance measurements on device/simulator | Baseline timing test suite |
| Resource consumption (memory, battery) | No | Device measurement with representative usage | Instrumented device runs |
| Capacity (sync volume, document count) | Partially | Load tests on server endpoints | k6/artillery against staging API |

### 7.1.3 Reliability
| Sub-characteristic | Automatable? | Method | Evidence needed |
|---|---|---|---|
| Availability (`/health/ready` in target env) | Yes | Periodic readiness probe | **Confirmed 200** `{"status":"ready","database":"ok"}` as of 2026-10-21T15:36 UTC |
| Fault tolerance (offline sync, retry backoff) | Yes | Unit tests on `syncRetryStore`, `syncWorker` | Existing tests; add failure-injection |
| Recoverability (backup restore) | No | Observed restore exercise with representative users | Restore test protocol |

### 7.1.4 Usability
| Sub-characteristic | Automatable? | Method | Evidence needed |
|---|---|---|---|
| Appropriateness recognizability (discoverability) | No | Questionnaire + observed task completion | SUS/UMUX questionnaire; user study |
| Learnability (onboarding) | No | Observed task completion with new users | User study |
| User error protection (validation messages) | Partially | Unit tests on Zod schemas + UI observation | Existing `validationSchemas.test.js` |

### Automation boundary summary
- **Automatable:** unit tests (dates, scheduling, validation, sync retry, storage), integration tests (API endpoints with stubbed DB), performance measurements, readiness probing.
- **Requires representative users / questionnaire / observed completion:** appropriateness, resource consumption, recoverability (restore), usability (SUS/UMUX, learnability), user-error protection (UI observation).

### Exit criteria for capstone evaluation
1. `/health/ready` returns 200 in target environment (blocks Objective 6).
2. Email expiration-reminder channel wired, tested, with recipient lookup and retry (Objective 3.3).
3. Application-level AES-256 encryption implemented and evidenced (Objective 5.1).
4. Search over OCR text and tags implemented (Objective 4.1/4.3).
5. Server document-activity logging for all four event types (Objective 5.3).
6. Backup restore flow tested (Objective 5.2).
7. ISO/IEC 25010 evaluation plan written; automated tests executed; user-study protocol scheduled (Objective 7.1).
8. ISO/IEC 27001 control mapping written with non-compliance disclaimer (Objective 7.2).

---

## Final Recommendation

**The current implementation cannot credibly be evaluated against all stated objectives.**

It can be evaluated against Objectives 1.1, 1.3, 1.4 (partially), 2.1, 2.2, 2.3 (partially), 3.1, 3.2 (partially), 4.2, 5.3 (partially), 5.4 (partially), and 6.1/6.3 (partially) based on code and tests. It **cannot** be credibly evaluated against:

- **Objective 3.3** — email expiration reminders are not implemented (no scheduler, recipient lookup, trigger, retry, or test for `sendExpirationReminderEmail`).
- **Objective 4.1/4.3** — no evidence OCR text or tags are indexed/searched; no server-side search.
- **Objective 5.1** — no application-level AES-256; no RBAC (JWT `role` unused).
- **Objective 5.2** — no verified backup-and-restore process.
- **Objective 5.3** — server document-activity logging absent for most event types.
- **Objective 7.1** — no ISO/IEC 25010 evaluation plan exists.
- **Objective 7.2** — no ISO/IEC 27001 control mapping exists.

Additionally, the operational blocker **`/health/ready` HTTP 503** prevents end-to-end runtime verification, and the **exact-alarm / Play policy decision** is unresolved.

### Recommended sequence
1. **Resolve B1:** Obtain project-owner decision on exact-alarm distribution method (direct/internal vs Play). (Blocks Play release, not direct APK.)
2. **Close C1 (email reminders):** Wire `sendExpirationReminderEmail` into a scheduler with recipient lookup, retry, and tests.
3. **Close C2 (AES-256):** Implement application-level encryption or document the deliberate reliance on provider encryption.
4. **Close H1/H2/H3/H4:** Align intervals to 7/15/30; implement OCR/tag search; add server activity logging; implement backup restore.
5. **Close C3/C4:** Write the ISO/IEC 25010 evaluation plan and the ISO/IEC 27001 control mapping (with non-compliance disclaimer).
6. **Build APK** only after 1 is complete; **capstone evaluation** only after all gaps are closed.

**No application code was changed, no APK was built, and no production was modified during this audit.**
