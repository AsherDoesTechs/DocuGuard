# DocuGuard — Final Pre-Build Checklist

**Objective:** Determine whether DocuGuard is ready to authorize its first APK build.

**Strict restriction observed during this review:** No APK was built, installed, distributed, or tested. No EAS/native build command was run. No device or emulator test was performed. No production deployment or production database change was made. No real email or push notification was sent. This review is a checklist and evidence assessment only.

---

## Verdict

**NOT READY — PRE-BUILD BLOCKERS REMAIN**

### Confirmed automated test baseline

| Check | Command | Result |
|---|---|---|
| TypeScript typecheck | `npm run typecheck` | clean, 0 errors |
| Client unit tests | `npm test` (`node --test "tests/*.test.js"`) | 163 tests, 163 pass, 0 fail |
| Server unit tests + syntax | `npm run check:server` | 69 tests, 69 pass, 0 fail |
| Combined | `npm run check` | all green |

### Unresolved pre-build blockers

| # | Blocker | Severity | Blocks first APK? |
|---|---------|----------|-------------------|
| B1 | Android exact-alarm / Google Play policy decision unresolved | High | Yes (for Play) |
| B2 | Backend deployment/readiness not verified in target environment — safe read-only GET to `https://docuguard-api-onoj.onrender.com/health/ready` returned HTTP 503 (not ready) | High | Yes (functional at runtime) |
| B3 | Offline token-removal residual risk — device stays registered for a signed-out/deleted account until next successful sign-in | Medium | No (mitigated by user warning) |

### Decisions awaiting the project owner

1. **Exact-alarm / first-APK distribution decision** (B1): The first APK distribution method is NOT yet set. `DIRECT/INTERNAL CAPSTONE TESTING` is the recommended option pending explicit project-owner approval. Whether the first APK retains `android.permission.SCHEDULE_EXACT_ALARM` (declared in `app.json:33`) depends on that decision. See Section 8.5.
2. **Google Play eligibility** (separate future release decision): keep `SCHEDULE_EXACT_ALARM` + justify/accept rejection risk, or remove it + accept inexact (delayed) alert delivery. Not decided; do not submit to Play until resolved.
3. **Backend deployment** (B2): Confirm the Render backend is deployed and `/health/ready` passes before the first APK can function end-to-end. Live readiness check returned HTTP 503.

### Post-build manual test plan

Listed in Section 9. None of these can be truthfully marked complete before a build/device/deployed environment exists. Their existence is not a reason to build before the pre-build gates are complete.

### Confirmation

No APK build, native build, device test, production deployment, or production data change was performed during this review.

---

## 1. Authentication and account security

| # | Requirement | Status | Evidence | Why it matters | Next action / responsible |
|---|-------------|--------|----------|----------------|---------------------------|
| 1.1 | Registration accepts 8+ char complex password; login accepts 6+ char; legacy accounts keep working | VERIFIED | `shared/validation/schemas.ts` (`registrationPasswordSchema`, `passwordSchema`); `DocuGuard-Server/tests/validationSchemas.test.js`; PHASE4 §2 batch P4; PHASE4 §5 S10 | Password policy drift between client and server would reject valid logins or accept weak passwords | None — verified by tests |
| 1.2 | Email verification flow (register → verify-email → login) | VERIFIED | `services/api.ts` (`auth.register`, `auth.verifyEmail`, `auth.resendVerification`); server `DocuGuard-Server/routes/auth.js`; PHASE4 | Unverified accounts must not reach the vault | None — verified by tests |
| 1.3 | Login writes token through API client (memory + SecureStore), switches local user, registers push token | VERIFIED | `app/(auth)/login.tsx:52-86` (`completeLogin`); `services/api.ts:21-28` (`setAuthToken`); `hooks/usePushNotifications.ts:168` (`registerPushTokenWithBackend`) | Prevents stale-token cross-account requests and ensures the new account receives notifications | None — verified by code inspection |
| 1.4 | Logout clears local vault + user id + token; does not strand user in signed-in state | VERIFIED | `services/api.ts:185-198` (`auth.logout`); `services/localDatabase.ts:485` (`clearLocalSession`); PHASE4 §5 S8 | Deleting only the token left documents readable by the next account | None — verified by code inspection |
| 1.5 | Password reset (forgot/reset) | VERIFIED | `services/api.ts:153-171` (`auth.forgotPassword`, `auth.resetPassword`); server routes/auth.js | Core account recovery path | None — verified by code inspection |
| 1.6 | 2FA setup/enrollment staged: secret stored only after verification; TOTP 6-digit code | VERIFIED | `DocuGuard-Server/controllers/profileController.js:146-189` (`verify2FA`, setup); `DocuGuard-Server/tests/` | Prevents self-lockout; enforces code format | None — verified by code inspection |
| 1.7 | Session expiry clears in-memory token; app lock after 30 min | VERIFIED | `hooks/useAppLock.tsx` (`expireSession`, `SESSION_TIMEOUT_MS`); `services/api.ts:21-28` | Stale sessions must not keep the vault accessible | None — verified by code inspection |
| 1.8 | Biometric availability rechecked on every login-screen focus | VERIFIED | `hooks/useAppLock.tsx` (`checkBiometricSupport`); PHASE4 §5 "biometric button evaluated only once" fix | Avoids offering an unavailable unlock method | None — verified by code inspection |

## 2. Documents, OCR, storage, and ownership

| # | Requirement | Status | Evidence | Why it matters | Next action / responsible |
|---|-------------|--------|----------|----------------|---------------------------|
| 2.1 | Object-level ownership: all document/reminder reads/writes scoped by user_id | VERIFIED | `services/localDatabase.ts` (all queries scoped); `DocuGuard-Server/controllers/documentController.js` (WHERE user_id); PHASE4 §5 S8 | Cross-account data leakage is the highest-severity privacy risk | None — verified by code inspection |
| 2.2 | Document revision conflicts detected; local copy kept; user decides | VERIFIED | `shared/sync/documentSyncCore.js` (conflict outcome); `services/syncService.ts` (`SyncResult.conflicts`); `app/(tabs)/sync.tsx`; PHASE4 §5 S3; `tests/documentSyncResolver.test.js` | Silent overwrites would destroy data | None — verified by tests |
| 2.3 | Upload failure recovery: file kept locally, compensating delete only for this save's draft | VERIFIED | `services/documentSaveService.ts`; `shared/sync/documentFileUpload.js`; `app/add-document.tsx`; PHASE4 §2 batch P3, §5 S2 | Failed uploads must not lose the document or delete unrelated objects | None — verified by tests |
| 2.4 | OCR failure recovery: OCR draft processed; processing_status moves pending→completed | VERIFIED | `shared/sync/syncPolicy.js` (`completed` when file stored); `services/localDatabase.ts` (`markDocumentSyncedWithCloud`); PHASE4 §5 D3 | A "processing" document that never completes leaves the user waiting | None — verified by tests |
| 2.5 | Signed storage URLs; upload-then-create ordering; storage key reused | VERIFIED | `services/api.ts` (`getUploadUrl`, `uploadToS3`, `deleteUploadedObject`); `app/add-document.tsx`; PHASE4 §5 D4 | Picker-added files must reach the cloud with correct metadata | None — verified by tests |
| 2.6 | Dead duplicate `documentPipeline.ts` removed; single save path via `documentSaveService.ts` | VERIFIED | `services/documentPipeline.ts` deleted (git status); `services/documentSaveService.ts`; PHASE4 §5 D8 | Divergent duplicate save paths caused D1-class defects | None — verified |
| 2.7 | Cloud export endpoint and client `cloud.exportData()` | VERIFIED | `DocuGuard-Server/routes/export.js`; `services/api.ts:311-316`; `services/syncService.ts:494-500` | Data portability / account export | None — verified by code inspection |

## 3. Offline-first database and synchronization

| # | Requirement | Status | Evidence | Why it matters | Next action / responsible |
|---|-------------|--------|----------|----------------|---------------------------|
| 3.1 | createDocument refuses to queue without a signed-in owner (no NULL user_id) | VERIFIED | `services/localDatabase.ts:511-512` (`createDocument`); `claimUnownedRows`; PHASE4 §5 S1 | Ownerless rows would be invisible and sync under the wrong account | None — verified by code inspection |
| 3.2 | Sync worker and "Sync now" share a mutex; no overlapping runs | VERIFIED | `shared/sync/syncMutex.js`; `services/syncService.ts`; `services/syncWorker.ts`; PHASE4 §5 D6 | Concurrent passes could push the same document twice | None — verified by tests |
| 3.3 | Retry backoff (30s → 30min), attempt budget, parked records; auth failures released on re-login | VERIFIED | `services/syncRetryStore.ts`; `services/syncPolicy.ts`; `tests/syncRetryStore.test.js`; PHASE4 §5 D5, S5, S9 | Permanent parking of retryable failures strands user data | None — verified by tests |
| 3.4 | Sync request scope merging; no document dropped or pushed early | VERIFIED | `services/syncWorker.ts` (`mergeSyncRequest`); PHASE4 §5 S7 | Unrelated saves must not disturb queued backoffs | None — verified by tests |
| 3.5 | Deleted documents tombstoned (status='deleted'), not hard-deleted locally until server confirms | VERIFIED | `services/localDatabase.ts` (tombstone handling); `tests/localDatabase.sqlite.test.js` ("a tombstone is hidden…"); `DocuGuard-Server/jobs/expirationChecker.js` (skips deleted) | Hard-deleted local docs could resurrect or lose the deletion signal | None — verified by tests |
| 3.6 | Server revision format microsecond-precise; legacy millisecond revisions still match | VERIFIED | `DocuGuard-Server/controllers/documentController.js` (`UPDATED_AT_ISO_SQL`); `shared/sync/serverRevision.js`; PHASE4 §5 D2 | Deployment-order 409s would block sync after first sync | None — verified by tests |
| 3.7 | `getAllDocuments` uses same projection as other reads (no missing revision column) | VERIFIED | `services/localDatabase.ts` (`DOC_COLUMNS`); PHASE4 §5 D7 | Missing revision → unconditional overwrite on next push | None — verified by tests |
| 3.8 | Realtime path implemented but not mounted; sync worker is the only server→device path | VERIFIED | `hooks/useRealtime.ts`; PHASE4 §5 D9 | Mounting it now is a behaviour change; out of scope for first APK | None — documented gap |

## 4. Reminders, local notifications, and push notifications

| # | Requirement | Status | Evidence | Why it matters | Next action / responsible |
|---|-------------|--------|----------|----------------|---------------------------|
| 4.1 | Local expiry alerts at 09:00; 7/14/30/60/90-day lead times; milestone-morning delivery | VERIFIED | `services/notificationScheduler.ts` (`REMINDER_HOUR=9`, `REMINDER_MINUTE=0`); `shared/dates/localDate.js` (`getReminderIntervals`, `getMilestoneDate`); `tests/reminderSchedule.test.js` | Core reminder behavior; users rely on expiry notices | None — verified by tests |
| 4.2 | Notification cancellation when switch turned off; duplicate prevention | VERIFIED | `services/notificationScheduler.ts` (`cancelAllNotifications`, `checkAndScheduleAlerts`); PHASE4 §5 "alerts of a document with the alerts switched off are withdrawn" | Turned-off alerts must stop firing | None — verified by code inspection |
| 4.3 | Push-token registration detached from every previous account (`WHERE id <> $1`) | VERIFIED | `DocuGuard-Server/routes/notification.js:20-32`; `hooks/usePushNotifications.ts:168`; `app/(auth)/login.tsx:86` | A token registered for account A must not push account B's documents | None — verified by code inspection + server tests |
| 4.4 | Push-token removal on sign-out and account deletion; warned on failure | VERIFIED | `app/(tabs)/profile.tsx:723-728, 824-838`; `hooks/usePushNotifications.ts:199-211`; `DocuGuard-Server/tests/notificationDelivery.test.js` | Removal failure leaves the device registered for the old account | Residual risk accepted with user warning (B3) |
| 4.5 | Offline preference changes marked `preferencesDirty: true`; retried by sync; flag cleared only after success | VERIFIED | `app/(tabs)/profile.tsx:619-626`; `services/notificationPreferences.ts:51-55`; `services/localDatabase.ts:1866-1871`; `services/syncService.ts:474-482` | Offline changes must eventually reach the server; stale server values must not overwrite newer local ones | None — verified by code inspection + sqlite test |

### Notification content exposure on a locked device (finding)

Push notification payloads include sensitive document details:

- Expiry: title `"Document Expired"`, body `${doc.title} expired on ${doc.expiryDate}. Please review.` (`services/notificationScheduler.ts:143-144`), `data: { documentId, type: "expired" }`
- Expiring soon: title `"Document Expiring Soon"`, body `${doc.title} expires on ${doc.expiryDate}. Time to renew.` (`services/notificationScheduler.ts:177-178`)
- Reminders: title `reminder.title`, body `reminder.description` (`services/notificationScheduler.ts:218-219, 232-233`)

On both Android and iOS, notification content (title/body) can appear on the lock screen / notification shade unless the user disables lock-screen previews in OS settings or the app configures a private/secret visibility. DocuGuard does not set a notification visibility/category that suppresses lock-screen content. Therefore a push notification **can expose document titles, expiry dates, and reminder descriptions on a locked device**. This is an OS-level user-controlled setting, not a code defect, but it should be disclosed to users and considered in the privacy/acceptance decision.


## 5. Profile, preferences, privacy, biometrics, and account deletion

| # | Requirement | Status | Evidence | Why it matters | Next action / responsible |
|---|-------------|--------|----------|----------------|---------------------------|
| 5.1 | Partial preference updates write only sent fields (no NULL-ing unrelated prefs) | VERIFIED | `DocuGuard-Server/controllers/profileController.js:192-219`; `DocuGuard-Server/controllers/reminderController.js:81-140`; `DocuGuard-Server/tests/preferences.test.js` | Writing all columns turned unset prefs into NULL → notifications silently stopped | None — verified by tests |
| 5.2 | `PATCH /profile` accepts only {name,email}; preferences go to `PATCH /profile/preferences` | VERIFIED | `services/syncService.ts:451-491` comment; `DocuGuard-Server/routes/profile.js`; PHASE4 §5 "profile notification flags were silently dropped" | Preferences sent to /profile were stripped by schema despite 200 | None — verified by code inspection |
| 5.3 | Account deletion server-side: all-or-nothing transaction, scoped to userId | VERIFIED | `DocuGuard-Server/controllers/profileController.js:754-777` (`deleteAccount`); `DocuGuard-Server/routes/profile.js:25` | Partial deletion leaves orphaned children / half-deleted accounts | None — verified by code inspection |
| 5.4 | Account deletion client-side: remove push token → delete account → purge local → clear session → null token | VERIFIED | `app/(tabs)/profile.tsx:704-804` (`handleConfirmAccountDeletion`); `services/localDatabase.ts:537` (`purgeLocalDataForUser`); `services/api.ts:185-198` | Deleted-account data must not stay readable or sync under another account | None — verified by code inspection + sqlite test |
| 5.5 | Local purge atomic + scoped; session closes even if purge fails; queued docs can't sync under another account | VERIFIED | `services/localDatabase.ts:546` (`withExclusiveTransactionAsync`); `app/(tabs)/profile.tsx:779-780`; `switchLocalUser` purges previous owner | Data loss or cross-account visibility after deletion | None — verified by tests |
| 5.6 | App lock / biometrics: lock after timeout, unlock paths, fail-closed on verification failure | VERIFIED | `hooks/useAppLock.tsx` (entire hook); `app.json` local-authentication plugin | Vault must not be exposed without authentication | None — verified by code inspection |
| 5.7 | Encryption at rest flag declared (`ITSAppUsesNonExemptEncryption=false`) | VERIFIED | `app.json:17-19` | iOS App Store encryption declaration | None — verified |

## 6. Backend and production configuration

| # | Requirement | Status | Evidence | Why it matters | Next action / responsible |
|---|-------------|--------|----------|----------------|---------------------------|
| 6.1 | Boot-time env assertion (JWT_SECRET ≥32, DATABASE_URL, SUPABASE vars) | VERIFIED | `DocuGuard-Server/config/env.js:42-57` (`assertEnvOrExit`); `app.js:30` | Missing config causes cryptic 401s or late query failures | None — verified by code inspection |
| 6.2 | `/health` (liveness) before rate limiters; `/health/ready` (DB-backed, 503 when unavailable) — live readiness NOT yet confirmed | PENDING | `DocuGuard-Server/app.js:46-75` (implementation); safe read-only GET to `https://docuguard-api-onoj.onrender.com/health/ready` returned HTTP 503, so deployed readiness is not confirmed | Platform readiness probes must not mark an unhealthy instance ready | Deploy Render backend; re-run `/health/ready` until it returns 200 ready | Project owner / DevOps |
| 6.3 | Rate limiters applied to all API routes (not just /api) | VERIFIED | `DocuGuard-Server/app.js:77-80` comment; `DocuGuard-Server/middleware/security.js` | Unthrottled routes enable brute force / abuse | None — verified by code inspection |
| 6.4 | Required env vars documented without exposing secrets | VERIFIED | `DocuGuard-Server/.env.example` inspected; all names required by `config/env.js` (JWT_SECRET, DATABASE_URL or DB_HOST/DB_USER/DB_PASSWORD/DB_NAME/DB_PORT/DB_SSL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, plus SUPABASE_ANON_KEY) are documented; no secret values revealed | Operators need to know what to set | None — verified by inspection |
| 6.5 | Backend deployment order: server first, then client | PENDING | PHASE4 §5 deployment notes (revision format change is server-side); Render backend not yet confirmed deployed/ready (see 6.2, HTTP 503) | Old client vs new server revision mismatch causes 409s | Deploy server before client build; confirm `/health/ready` passes | Project owner / DevOps |
| 6.6 | API base URL configured (`apiBaseUrl` in app.json extra) | VERIFIED | `app.json:82` (`https://docuguard-api-onoj.onrender.com`) | Points client at the production backend | Confirm URL is the intended production target | Project owner |

## 7. UI, navigation, accessibility, and user feedback

| # | Requirement | Status | Evidence | Why it matters | Next action / responsible |
|---|-------------|--------|----------|----------------|---------------------------|
| 7.1 | Expo Router navigation; document/reminder/screens | VERIFIED | `app/` directory (expo-router/entry); `app/(tabs)/`, `app/(auth)/`, `app/edit-document/[id].tsx` | Core user flows | None — verified by code inspection |
| 7.2 | Feedback service (toast/error/warning/success) | VERIFIED | `services/feedbackService.ts`; used throughout `profile.tsx` | Users must be informed of success/failure | None — verified by code inspection |
| 7.3 | Sync screen: conflicts reported by name + server revision; force sync option | VERIFIED | `app/(tabs)/sync.tsx`; `services/syncService.ts` (`SyncResult.conflicts`); PHASE4 §5 S3 | Conflicts must be actionable, not silent | None — verified by code inspection |
| 7.4 | Camera + document picker permissions declared | VERIFIED | `app.json` plugins (expo-camera, document-scanner-plugin); permissions CAMERA, RECORD_AUDIO | Scanning is a core feature | None — verified |
| 7.5 | Splash screen, status bar, safe area, orientation portrait | VERIFIED | `app.json` plugins (expo-splash-screen, expo-status-bar, safe-area-context) | Basic app polish | None — verified |

## 8. Build configuration and distribution readiness

| # | Requirement | Status | Evidence | Why it matters | Next action / responsible |
|---|-------------|--------|----------|----------------|---------------------------|
| 8.1 | `app.json`: name, slug, version 1.0.0, runtimeVersion 1.0.0, icon, package/bundleIdentifier | VERIFIED | `app.json:1-35` | Build identity; runtimeVersion governs OTA updates | None — verified |
| 8.2 | `eas.json`: development/preview/production build channels | VERIFIED | `eas.json:6-23` | EAS build configuration present | None — verified |
| 8.3 | Android permissions declared: CAMERA, RECORD_AUDIO, VIBRATE, RECEIVE_BOOT_COMPLETED, SCHEDULE_EXACT_ALARM | VERIFIED | `app.json:28-34` | Required for scanning, notifications, boot-rescheduled alerts | None — verified |
| 8.4 | `expo-notifications` plugin configured with icon/color/sounds | VERIFIED | `app.json:66-73` | Notification channel setup | None — verified |
| 8.5 | **Exact-alarm / distribution decision** — `SCHEDULE_EXACT_ALARM` declared; alerts target fixed 09:00; Play restricts this permission to alarm-clock/calendar apps; DocuGuard is a document vault | DECISION REQUIRED | `app.json:33`; `services/notificationScheduler.ts:1-30`; PHASE5 §9.4 | Declaring the permission does NOT establish Play eligibility. Two separate decisions: (a) first APK distribution method — DIRECT/INTERNAL CAPSTONE TESTING is the recommended option, but it is NOT yet set as decided pending explicit project-owner approval; (b) Google Play release — keep permission + justify/accept rejection risk, or remove it + accept inexact (delayed) alert delivery — a separate future release decision | Ask project owner: approve first-APK distribution method (DIRECT/INTERNAL CAPSTONE TESTING recommended) and record Play decision before any Play submission |

## 9. Post-build device and deployment verification (cannot be complete pre-build)

| # | Requirement | Status | Evidence / needed | Why it matters |
|---|-------------|--------|-------------------|----------------|
| 9.1 | APK compilation succeeds (EAS production build) | PENDING | Requires EAS build; not run per restriction | Confirms build config is valid |
| 9.2 | APK installs and launches on Android device | PENDING | Requires device/emulator | Confirms native modules link |
| 9.3 | Camera/scanner and file picker operation | PENDING | Requires device | Core scanning feature |
| 9.4 | Real notification permission prompt; scheduled 09:00 delivery; exact-alarm behavior | PENDING | Requires device + notification permission | Core reminder feature |
| 9.5 | Push-token registration, sign-out, account switching, account deletion round trips | PENDING | Requires device + backend | Privacy-critical paths |
| 9.6 | Real email verification and authentication round trips | PENDING | Requires device + deployed backend | Auth flow |
| 9.7 | Deployed `/health/ready` returns ready (DB reachable) | PENDING | Requires deployed backend | Runtime readiness |
| 9.8 | Offline synchronization and recovery on Android | PENDING | Requires device + offline simulation | Core offline-first behavior |
| 9.9 | App lock, biometrics, navigation, session-expiry on-device | PENDING | Requires device | Security-critical UX |

## 10. Risk acceptance

| # | Risk | Severity | User impact | Blocks first APK? | Mitigation | Owner approval needed? |
|---|------|----------|-------------|-------------------|------------|------------------------|
| R1 | Exact-alarm / Play policy unresolved | High | App may be rejected from Play or alerts may be delayed if permission removed | Yes (for Play) | Keep for direct/internal test APK; decide before Play submission | Yes |
| R2 | Offline token-removal failure leaves device registered for signed-out/deleted account | Medium | Deleted account's notices can still reach device until next sign-in | No | User warned on failure; token detached at next successful sign-in | Yes (accept residual risk) |
| R3 | Backend not yet deployed/verified in target environment | High | APK cannot reach server; all sync/auth fails | Yes (functional) | Deploy Render backend; verify `/health/ready` | Yes |

### Severity definitions
- **Critical:** Data loss, cross-account data exposure, or complete auth failure. None remain unresolved.
- **High:** Feature broken or release-blocking (R1 exact-alarm for Play, R3 backend deployment).
- **Medium:** Privacy leakage with user warning and automatic recovery (R2 offline token removal).

### Approval statement
No Critical or High risk is marked acceptable without explicit rationale and owner approval. R2 (Medium) is accepted with mitigation (user warning + automatic detachment on next sign-in). R1 and R2 block a Google Play release but do not block a direct/internal test APK provided the owner accepts the exact-alarm risk.

---

**Reviewer confirmation:** This review was a checklist and evidence assessment only. No APK was built, installed, distributed, or tested. No EAS/native build command, device/emulator test, production deployment, production database change, or real email/push send was performed. All test results were confirmed against the current repository (client 163/163, server 69/69, typecheck clean).
