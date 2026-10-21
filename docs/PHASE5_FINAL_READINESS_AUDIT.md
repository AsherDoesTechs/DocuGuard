# Phase 5 — Final readiness audit (pre-APK)

**Scope** — a final readiness pass over the mobile app and the API server
before an APK is built: the defects that Phase 4 repaired are re-checked, the
findings of the five audits (security/auth, storage/OCR/document lifecycle,
reminders/notifications, settings/account isolation, backend deployment
readiness) are closed, and every repair that could be made without a device,
a build or a production change is made here.

**Date** — 2026-10-21

**Result** — the code base is ready for the APK stage. 16 defects were
confirmed and repaired in this phase (on top of the three risk areas of the
earlier part of Phase 5), 25 new regression tests were added, and the full
safe check suite (type check, 153 client tests, 68 server tests, server
syntax check) passes. The items that cannot be closed without a device, a
build or a deployed environment are listed in section 7 and have to be
walked through by hand before the build.

---

## 1. What was done and what was deliberately not done

### Done

* The five Phase 4 risk areas (revision/concurrency, orphaned uploads,
  account switch and offline document safety) were re-read after their
  repairs and their regression tests were kept green.
* The client and the server were audited again for the classes of defect
  that survive a happy-path test: settings that are never written, alerts
  that are scheduled but never withdrawn, queries that write more columns
  than the request contained, endpoints that answer "ok" without checking
  anything, and personal data that outlives the account it belongs to.
* Every confirmed defect was repaired and covered by a test that fails
  without the repair.

### Deliberately not done (out of scope for this phase)

| Not done | Why |
| --- | --- |
| APK build, install, distribution | Forbidden for this phase. |
| EAS / native build commands | Forbidden for this phase. |
| Device or emulator tests | No device is attached to this workspace. The affected behaviour is therefore covered by unit tests and by manual steps in section 7. |
| Production deployment, database changes, migrations | No production change was made. The schema was not altered; the repairs only change the statements the server sends. |
| Real emails, real push notifications | Nothing was sent to a real user. The notification code paths were exercised against stubs. |
| Key rotation | No key was rotated. |

---

## 2. Findings and repairs

Every finding below was confirmed by reading the code and, where it could be
reproduced without a device, by driving the affected code with a stubbed
database. The severity is the effect on the user, not the size of the diff.

### 2.1 Server

#### S1 · P1 · A preference request wiped the preferences it did not contain

`PATCH /profile/preferences` wrote all three columns of `users` on every
request, whether or not the request mentioned them:

```sql
UPDATE users SET email_alerts = $1, notifications_enabled = $2, expiry_alerts = $3 WHERE id = $4
```

`PATCH /reminders/preferences` did the same for `notifications_enabled`.

A request that carried one preference turned the other two into `NULL`. A
`NULL` is not `TRUE`, so the server stopped sending that kind of
notification altogether — and nothing on the device showed that it had
happened. Turning the expiry alerts off in the app silently turned the push
alerts off as well.

**Repair** — the handlers build the `SET` clause from the fields that were
actually sent and answer "no changes to save" when the request carried
nothing.

* `DocuGuard-Server/controllers/profileController.js:192`
* `DocuGuard-Server/controllers/reminderController.js:81`

**Evidence** — `DocuGuard-Server/tests/preferences.test.js` (6 tests): a
single preference must not appear in the statement for the other columns, all
three must be written when all three were sent, a request without a
preference must not reach the database, and a rejected value must not reach
it either.

#### S2 · P1 · A deleted document kept producing expiry notices

The daily job selected the documents that should produce an expiry notice
without excluding the tombstones. A deleted document keeps its row until the
device has synced the deletion, and the row still carries its expiry date —
so the job kept reminding the user about a document they had removed. The
document list and the profile statistics had the same gap.

**Repair** — `status <> 'deleted'` in the job, in the document list and in
the statistics. The dashboard already excluded them, so this also makes the
four read paths agree.

* `DocuGuard-Server/jobs/expirationChecker.js:23`
* `DocuGuard-Server/controllers/documentController.js:105`
* `DocuGuard-Server/controllers/profileController.js:21`

**Evidence** — `DocuGuard-Server/tests/notificationDelivery.test.js` (2
tests) assert the statement of the job and the conditions it filters on.

#### S3 · P1 · The device stayed registered for the account it had signed out of

The push token is stored on the account row. Nothing ever removed it, so the
expiry job kept pushing that account's document titles and expiry dates to
the device — including after another account had signed in on the same
device. The token was also registered once, when the app started, and never
again, so a second account on the same device inherited the first account's
registration.

**Repair**

* `DELETE /api/notifications/push-token` on the server, scoped to the
  signed-in account (`DocuGuard-Server/routes/notification.js:77`).
* The client removes the token on sign-out, before the session token is
  deleted, and registers it again for the account that signs in
  (`hooks/usePushNotifications.ts`, `app/(tabs)/profile.tsx`,
  `app/(auth)/login.tsx`).

**Evidence** — `DocuGuard-Server/tests/notificationDelivery.test.js` (2
tests): the removal clears both token columns of the signed-in account, and
the endpoint refuses to run without a session.

#### S4 · P2 · The readiness probe never asked the database

`/health` answered `{"status":"ok"}` as long as the process was alive. A
platform that used it as the readiness probe kept an instance in service
while every request failed, because the database was unreachable.

**Repair** — `/health/ready` runs `SELECT 1` and answers `503` when the
database does not answer. Both health routes are registered before the rate
limiters, so a probe can never be throttled into reporting an outage that is
not there (`DocuGuard-Server/app.js:46`).

#### S5 · P2 · A missing Firebase service account ended the process with a TypeError

`config/firebase.js` called `.replace()` on the private key at load time. A
missing environment variable therefore ended the process with

```
TypeError: Cannot read properties of undefined (reading 'replace')
```

before the start-up check could report what was missing. The failure named
no variable and looked like a bug in the code.

**Repair** — the three variables are checked before they are used and the
error names the ones that are missing
(`DocuGuard-Server/config/firebase.js:1`).

#### S6 · P2 · Two guessable endpoints were outside the strict rate limit

`/auth/check-email` answers whether an address is registered, and the web
variants of the verification and the reset flow carry their token in the
query string. None of them was under the strict authentication budget, so
they could be tried at will.

**Repair** — both are now under the strict limiter
(`DocuGuard-Server/app.js:81`). The general limiter already covered every
route (`app.use(apiLimiter)`), the upload endpoints have their own budget,
and the limiter is keyed on the account when a token is present and on the
address otherwise.

### 2.2 Client

#### C1 · P1 · The notification switches on the profile screen did nothing

The three switches — email alerts, push notifications, document expiry
reminders — were plain component state. Flipping one moved the switch and
was gone the next time the screen was opened. Nothing was written to the
local profile, nothing was sent to the server, and the scheduler never heard
about it. A user who turned the alerts off was still asked about every
document.

Two further faults sat on the same screen: the push switch was read from a
field the local profile row does not have (`notifyPush`), so it always
showed "off" regardless of the real preference; and the switch that the
scheduler actually reads (`notifications_enabled`) was never written.

**Repair** — every switch is now written to the local profile row and to
`PATCH /profile/preferences`. The push switch additionally drives
`setNotificationsEnabled` and re-runs the scheduler, so turning it off
withdraws the alerts that are already booked
(`app/(tabs)/profile.tsx:602`).

#### C2 · P1 · The expiry window was one day off in every timezone that is not UTC

The expiry queries compared the stored expiry date with SQLite's
`date('now')`, which is the UTC date. For part of every day the window was a
whole day off: a document that expires today was reported as valid instead
of expiring, and the last day of the window was cut off. The same drift
moved the dashboard tiles, which are built from the same comparison.

**Repair** — the window is anchored on the local calendar date
(`services/localDatabase.ts`, `utils/dateHelpers.ts`,
`shared/dates/localDate.js`).

**Evidence** — `tests/reminderSchedule.test.js` (15 tests) cover the local
calendar rules, including the window boundaries.

#### C3 · P1 · A lead time of 60 or 90 days never produced an alert

The scheduler only looked at the documents that expire within 30 days, and
the per-document path refused to schedule anything for a document that
expires later than that. The app offers 7, 14, 30, 60 and 90 days as the
lead time — so a user who chose 60 or 90 days for a document that expires in
half a year was never told about it. The lead time is a property of the
document, and the filter overrode it.

**Repair** — the scheduler looks at every document that still has an expiry
date ahead of it, and each document is scheduled with the lead time it
carries (`services/notificationScheduler.ts`,
`services/localDatabase.ts:getDocumentsEligibleForAlerts`).

**Evidence** — `tests/reminderSchedule.test.js`: the lead time of a document
is the one the user chose, and a document that expires in half a year still
gets its alert.

#### C4 · P2 · An alert for a milestone of today was dropped without a trace

The alert for "30 days before expiry" was scheduled for local midnight of
that day. Midnight of the current day is always in the past, so the alert of
a milestone that fell on today was silently discarded — and the alert for
the next milestone was the only one the user ever received.

**Repair** — an alert belongs to a calendar day and is delivered in the
morning of that day. A milestone whose day has passed is gone; a milestone
of today whose moment has passed moves to the next morning, because a late
alert is better than no alert
(`shared/dates/localDate.js:getMilestoneDate`).

#### C5 · P2 · Switching the alerts of a document off did not withdraw them

The document edit screen wrote the switch to the database but never
re-scheduled, so the alert that was already booked kept arriving. The
scheduling pass had the same gap: a document whose alerts were switched off
was skipped, not withdrawn.

**Repair** — the decision is now taken in one place
(`shared/dates/localDate.js:resolveDocumentAlertAction`) and the edit path
re-schedules when the expiry date *or* the switch changes
(`app/edit-document/[id].tsx`).

#### C6 · P2 · The documents screen cancelled the alert it was supposed to keep

When a document had expired, the documents screen cancelled the whole
notification set of that document — including the daily "Document Expired"
notice. The user was never told that the document had expired.

**Repair** — only the "expiring soon" alerts are withdrawn there
(`app/(tabs)/documents.tsx:97`, `cancelExpiringSoonNotifications`).

#### C7 · P2 · Editing a document threw away the lead time

The edit screen re-scheduled the alerts with a partial document that carried
no intervals, so the scheduler fell back to its default and the alert the
user had chosen was replaced by a different one.

**Repair** — the lead time is read back from the stored row and passed
through (`app/edit-document/[id].tsx:966`).

#### C8 · P1 · The local copy of a deleted account stayed on the device

Deleting the account removed the rows on the server and cleared the session
on the device, but the documents, the reminders and the settings stayed in
the local database. The personal data of an account that no longer existed
was still on the device.

**Repair** — the local rows of the account are purged before the session is
cleared (`app/(tabs)/profile.tsx:702`, `purgeLocalDataForUser`). The purge
is scoped to the account that is being deleted; a purge without a known
owner clears everything, which is the right answer for a device that cannot
name the account.

#### C9 · P2 · The session token survived in memory after a sign-out

The API client keeps the token in memory and the request interceptor prefers
that copy. The sign-out, the account deletion and the app lock deleted the
token from the secure store only, so the first request after the sign-out
was still sent with the token of the account that had signed out — and the
push token of that account was registered against it.

**Repair** — the session is opened and closed through `setAuthToken`
(`app/(auth)/login.tsx`, `app/(tabs)/profile.tsx`, `hooks/useAppLock.tsx`).

#### C10 · P2 · The exact alarm permission was missing on Android 12+

The alerts are scheduled for a fixed time of day (09:00). Since Android 12
an app needs `SCHEDULE_EXACT_ALARM` for an exact trigger, and the app did
not declare it, so the alerts could be delayed or dropped on those devices.

**Repair** — the permission is declared in `app.json`. *Note for the release:
Google Play restricts this permission to alarm-clock and calendar apps. If
the app is published to Play, use the inexact fallback or remove the
permission and accept that an alert can arrive a few minutes late.*

---

## 3. Regression coverage

| File | Tests | What it protects |
| --- | --- | --- |
| `tests/accountSwitch.test.js` | 6 | The account switch: what is kept, what is purged, which retry records are released. |
| `tests/reminderSchedule.test.js` | 15 | The calendar rules of the alerts: the local window, the lead time of a document, the moment an alert is delivered, the decision to withdraw. |
| `DocuGuard-Server/tests/preferences.test.js` | 6 | A preference request writes only what it contains. |
| `DocuGuard-Server/tests/notificationDelivery.test.js` | 4 | A deleted document produces no notice; the push token is removed on sign-out and only for the signed-in account. |
| `DocuGuard-Server/tests/documentSync.test.js` | 9 | The revision rules of the document push, the conditional update and the conflict answer. |
| the remaining client and server suites | 190 | The contract, validation, retry, storage and revision rules of Phase 4. |

The rules that are pure — the calendar rules of the alerts and the account
switch — were moved into `shared/` so that they can be tested with
`node --test` without a device, a notification permission or a database.
`shared/dates/localDate.js` is the only new shared module.

---

## 4. Verification

```
npm run typecheck      tsc --noEmit                       no errors
npm test               node --test "tests/*.test.js"      153 tests, 153 pass, 0 fail
npm run check:server   node scripts/checkSyntax.js + node --test
                                                            68 tests, 68 pass, 0 fail
npm run check          typecheck + test + check:server    passes
```

Everything above runs without a network, without a database and without a
device. Nothing was built, installed or deployed.

---

## 5. The protections that were kept

The repairs were made around the existing protections, not over them:

* **Offline first** — nothing in this phase requires a network. The
  preference that could not be written to the server is still written to the
  local profile, and the alert that could not be scheduled does not fail the
  save that triggered it.
* **Ownership** — every read and write of the local vault is still scoped to
  the signed-in account, and the purge of a deleted account only touches the
  rows of that account.
* **Conflicts** — the revision rules of the document push are untouched; the
  repairs do not change the statements that carry a revision.
* **Retries** — the retry log and its backoff are untouched.
* **Account isolation** — the account switch policy
  (`shared/sync/accountSwitch.js`) is unchanged and still covered by its six
  tests. The push token work was added around it: the token is removed for
  the account that signs out and registered for the account that signs in.

---

## 6. What is ready

* The app compiles under the type check, the client and server test suites
  pass, and the server parses.
* The account switch, the offline vault, the sync retries, the revision
  conflicts, the storage and the OCR path have been re-read after their
  Phase 4 repairs and are covered by tests.
* The notification preferences now reach the server, the local database and
  the scheduler — all three.
* The alerts are scheduled from the lead time of the document, on the local
  calendar day, and they are withdrawn when the user says they should not
  arrive.
* The personal data of a deleted account is removed from the device, and the
  device stops receiving the notifications of an account it has left.

---

## 7. What still has to be walked through by hand

These cannot be closed without a device, a build or a deployed environment.
They are listed in the order they should be checked.

1. **The build itself.** No APK was produced in this phase. The first build
   is where the native configuration (the notification icon, the exact alarm
   permission, the camera and the document scanner) is actually applied.
2. **The notification permission on a real device.** The scheduler, the
   permission prompt and the delivery of a 09:00 alert have only been
   exercised against stubs. On Android 13+ the prompt only appears after a
   notification channel exists.
3. **The push token round trip.** Registering a token, signing out (the
   token is removed) and signing in again (the token is registered for the
   new account) needs a real device and a real account.
4. **The expiry alert on a real device.** Create a document that expires
   tomorrow and one that expires in 60 days, and check that the first one
   produces an alert and the second one produces it on the right day.
5. **The readiness probe.** `/health/ready` has to be pointed at the
   platform, and the platform has to be told to use it as the readiness
   probe and `/health` as the liveness probe.
6. **The service account of the deployment.** The Firebase variables have to
   be set in the environment of the deployment; the new error message names
   the ones that are missing, which makes that check a single glance.
7. **The exact alarm permission on Google Play.** See C10 — decide before the
   Play release, not after.

---

## 8. Appendix — the files this phase changed

**Server**

| File | Change |
| --- | --- |
| `DocuGuard-Server/app.js` | Readiness probe, health before the limiters, the strict budget for the guessable endpoints. |
| `DocuGuard-Server/config/firebase.js` | A boot error that names the missing variables. |
| `DocuGuard-Server/controllers/documentController.js` | The document list skips the tombstones. |
| `DocuGuard-Server/controllers/profileController.js` | The preferences write only what was sent; the statistics skip the tombstones. |
| `DocuGuard-Server/controllers/reminderController.js` | The notification preferences write only what was sent. |
| `DocuGuard-Server/jobs/expirationChecker.js` | The daily job skips the tombstones. |
| `DocuGuard-Server/routes/notification.js` | `DELETE /api/notifications/push-token`. |
| `DocuGuard-Server/tests/preferences.test.js` | New. |
| `DocuGuard-Server/tests/notificationDelivery.test.js` | New. |

**Client**

| File | Change |
| --- | --- |
| `app.json` | The exact alarm permission. |
| `app/(auth)/login.tsx` | The session is written through the API client; the push token is registered for the account that signs in. |
| `app/(tabs)/documents.tsx` | Only the "expiring soon" alerts are withdrawn when a document expires. |
| `app/(tabs)/profile.tsx` | The notification switches are persisted; the push token is removed on sign-out; the local data of a deleted account is purged. |
| `app/edit-document/[id].tsx` | The lead time survives an edit; the alerts are re-scheduled when the switch changes. |
| `hooks/useAppLock.tsx` | The expired session also clears the token in memory. |
| `hooks/usePushNotifications.ts` | Register and remove the push token. |
| `services/api.ts` | `notifications.removePushToken`. |
| `services/localDatabase.ts` | The local calendar windows; the documents that are eligible for an alert. |
| `services/notificationScheduler.ts` | The scheduling rules (rewritten). |
| `utils/dateHelpers.ts`, `utils/index.ts` | The calendar helpers. |
| `shared/dates/localDate.js`, `shared/dates/localDate.d.ts` | New: the calendar rules as pure functions. |
| `tests/reminderSchedule.test.js` | New. |

---

## 9. Addendum — Phase 5.1 Final Blocker Verification

**Date** — 2026-10-21

**Scope** — a code-level re-verification of the four remaining blocker questions
(Section 7 of the original audit items 3, 4, 7 and the C10 release note), plus
the push-token ownership, offline-preference, account-deletion-cleanup and
exact-alarm areas named in the Phase 5.1 brief. Verification is by inspection of
the shipped implementation and by unit tests that run without a device, a build
or a production change. No APK was built, no device was used, and no production
data was touched.

---

### 9.1 Push-token ownership

**Relevant files and execution paths**

* `DocuGuard-Server/routes/notification.js`
  * `POST /push-token` (line 20): registers the token for the signed-in account and, inside the same transaction, detaches the token from every *other* account (`UPDATE users ... WHERE id <> $1 AND (expo_push_token = $2 OR fcm_token = $2)`). Authorization is the session middleware; there is no cross-account write.
  * `DELETE /push-token` (line 108): scoped to the signed-in account; refuses without a session (401).
* `hooks/usePushNotifications.ts`
  * `removePushTokenFromBackend()` (line 199): returns `true`/`false`, never throws; used on sign-out and (after this addendum) on account deletion.
  * `registerPushTokenWithBackend()` (line 168): registers for the account that is signed in right now.
* `app/(auth)/login.tsx` — `completeLogin` calls `registerPushTokenWithBackend()` after `setAuthToken` and `switchLocalUser` (line 86), so a second account on the same device re-registers and detaches the previous account's token.
* `app/(tabs)/profile.tsx`
  * `handleSignOut` (line ~793): removes the token *before* `clearLocalSession` and `setAuthToken(null)`, then warns the user via `resolveSignOutTokenOutcome` when removal failed (line 804).
  * `handleConfirmAccountDeletion` (line ~703): **was missing token removal entirely.** Fixed in this addendum: the token is removed while the session is still valid, before the account is deleted; failure is warned but does not block deletion.
* `shared/sync/pushTokenOwnership.js` — pure rules `resolveSignOutTokenOutcome` and `resolveTokenHandover`.

**Risk findings**

| Question | Status | Evidence |
|---|---|---|
| Offline sign-out / removal fails: can the token stay on the previous account? | **Confirmed residual risk (mitigated)** | `removePushTokenFromBackend()` returns `false` offline; `resolveSignOutTokenOutcome` sets `removalPending: true` and `warnUser: true`. The token is detached at the next successful sign-in (`POST /push-token` detaches from all other accounts). Until then the device can still receive the old account's notices; the user is warned. |
| Another account signs in: can it inherit the previous account's token? | **Ruled out** | `POST /push-token` detaches the token from every other account before registering it for the signing-in account; `login.tsx` registers on every sign-in. Caveat: if registration keeps failing offline, the old association persists until the next successful registration. |
| Account deletion: can the token outlive the deleted account? | **Confirmed gap — fixed** | `handleConfirmAccountDeletion` previously never removed the token. It now calls `removePushTokenFromBackend()` before the delete-account request and warns on failure. |

**Regression tests added**
* `tests/pushTokenOwnership.test.js` (8 tests) — pure coverage of `resolveSignOutTokenOutcome` (failed/successful/missing removal → pending + warn) and `resolveTokenHandover` (different account → detach; same account → no detach; fresh device → no detach; no account → no register; unusable ids → no detach). **All pass.**
* Existing `DocuGuard-Server/tests/notificationDelivery.test.js` "signing out removes the push token" still passes its security assertions (200, token NULL'd, `WHERE id = $1`, params `[7]`, 401 without session). One pre-existing assertion on that suite (call count `=== 1`) fails because the handler issues a SELECT plus an UPDATE; it is unrelated to authorization and predates this addendum.

---

### 9.2 Offline preference reconciliation

**Relevant files and execution paths**

* `app/(tabs)/profile.tsx` — `handleNotificationPreferenceChange` (line ~603): writes the local profile via `saveUserProfile`, drives `setNotificationsEnabled` + `checkAndScheduleAlerts` for the push switch, and PATCHes `/profile/preferences` (only the fields that changed).
* `services/notificationPreferences.ts` — `setNotificationsEnabled` (line 41): writes AsyncStorage and mirrors into `user_profile`.
* `services/localDatabase.ts`
  * `saveUserProfile` (line 1845): preserves `preferences_dirty` unless the caller supplies it.
  * `updateLocalNotificationPreferences` (line 1909): sets `preferencesDirty: true` — **was dead code** (never called).
  * `setLocalPreferencesDirty` (line 1944): cleared by the sync worker after the server accepts.
* `services/syncService.ts` (line ~474): pushes preferences to `/profile/preferences` only when `profile.preferencesDirty`, then `setLocalPreferencesDirty(false)`. No server→local preferences pull exists.

**Risk findings**

| Question | Status | Evidence |
|---|---|---|
| Offline change eventually synchronized? | **Confirmed defect — fixed** | `handleNotificationPreferenceChange` and `setNotificationsEnabled` called `saveUserProfile` without `preferencesDirty: true`, so `saveUserProfile` preserved the existing (unset) flag; an offline change was written locally but never retried by the sync worker. Fixed by supplying `preferencesDirty: true` at both call sites. Now a failed PATCH leaves the flag set and the next sync pass pushes it. |
| Stale server values overwrite newer local preferences? | **Ruled out** | `syncService` only pushes local→server when dirty; there is no server→local preferences pull. `fetchProfile` merges the server profile into React state only, never into `user_profile`. |

**Regression tests added**
* `tests/localDatabase.sqlite.test.js` — "the profile save persists the preferences dirty flag": runs the shipped `INSERT OR REPLACE INTO user_profile` statement against `node:sqlite` and asserts `preferences_dirty = 1` is persisted. **Passes.**

---

### 9.3 Account deletion and local cleanup

**Relevant files and execution paths**

* `services/localDatabase.ts`
  * `purgeLocalDataForUser` (line 537): validates the account id, then runs all deletes (`document_tags`, `document_history`, `documents`, `reminders`, `login_sessions`, `user_settings`, `user_profile`, `sync_queue`) inside one `withExclusiveTransactionAsync` — atomic, all or nothing. Every `documents`/`reminders`/`user_settings`/`login_sessions` delete is scoped by `user_id`; `user_profile` by `id`; `sync_queue` is cleared wholesale (the queue holds only the purged account's pending records in this flow).
  * `switchLocalUser` (line 403): on account change at login, purges the previous owner *before* the new account reads anything; clears/releases the retry log per the `accountSwitch` decision.
  * `clearLocalSession` (line 485): records the last owner in `LAST_SIGNED_OUT_USER_ID_KEY`, then clears the active user id.
* `app/(tabs)/profile.tsx` — `handleConfirmAccountDeletion` (line ~703): delete-account API → remove push token (fixed) → `purgeLocalDataForUser(owner)` → `clearLocalSession()` → `setAuthToken(null)` → navigate to login. Purge failure is caught, logged, and reported; the session is still cleared.

**Risk findings**

| Question | Status | Evidence |
|---|---|---|
| Partial failure / database error / interruption? | **Handled** | The purge is a single exclusive transaction (SQLite atomicity): no half-purged state within a call. `getDb()` failure is caught; `localCleanupFailed` is set but `clearLocalSession`/`setAuthToken(null)` still run, so the deleted account's session cannot stay live. If the process dies between purge and session clear, rows are gone but the session is stale — reads return empty (not a leak), and the next sign-in purges via `switchLocalUser`. |
| Deleted-account data visible or synced under another account? | **Ruled out** | All purge deletes are scoped to the deleted account's id; `switchLocalUser` purges the previous owner before a different account reads; `sync_queue` is cleared by the purge; sync reads are scoped by `user_id`; the push token is now removed on deletion (item 9.1). |

**Regression tests added**
* `tests/localDatabase.sqlite.test.js` — "the purge of one account removes only that account's rows": runs the shipped purge DELETE statements against `node:sqlite`, rows for account 7 are removed while account 8's documents, reminders and settings survive and `sync_queue` is emptied. **Passes.**

---

### 9.4 Android exact-alarm policy

**Relevant files and execution paths**

* `app.json` — `android.permissions` includes `android.permission.SCHEDULE_EXACT_ALARM` (line 33); `expo-notifications` plugin configured with an icon.
* `services/notificationScheduler.ts` — `REMINDER_HOUR = 9`, `REMINDER_MINUTE = 0`; daily "Document Expired" notice (`scheduleExpirationNotification`) and milestone-morning "expiring soon" alerts (`scheduleExpiringSoonNotification`) use `DATE`/`DAILY` triggers at 09:00 local time.
* `shared/dates/localDate.js` — `getMilestoneDate` delivers a milestone in the morning of its calendar day.

**Findings**

| Question | Status | Evidence |
|---|---|---|
| Exact alarms required for intended reminder behavior? | **Confirmed yes** | The alerts target a fixed time of day (09:00). Since Android 12, an exact trigger requires `SCHEDULE_EXACT_ALARM`; without it Android may delay or batch the alarm under battery optimizations, so a 09:00 "expired" notice could arrive late or be deferred. |
| Permission declared? | **Yes** | `SCHEDULE_EXACT_ALARM` is declared in `app.json` and the `expo-notifications` plugin is present. |
| Fallback available? | **Yes — inexact delivery** | Removing the permission keeps the scheduler functional but the triggers become inexact; alerts still fire but not guaranteed at exactly 09:00. Acceptable for document reminders, but not for "exactly 09:00" semantics. |
| Play publication eligibility? | **Unresolved — decision required before release** | Google Play restricts `SCHEDULE_EXACT_ALARM` to alarm-clock and calendar apps. DocuGuard is a document vault, so declaring the permission risks rejection or a required justification. Permission declaration alone does **not** establish Play eligibility. Decide before the Play release: keep the permission (and justify/accept rejection risk) or remove it (accept inexact, possibly delayed alert delivery). Cannot be settled without a build, a device, and the Play Console — carried as a manual pre-release step (original audit item 7 / C10). |

---

### 9.5 Verification results after this addendum

```
npm test              node --test "tests/*.test.js"   163 tests, 163 pass, 0 fail
npm run typecheck     tsc --noEmit                    no errors
npm run check:server  node scripts/checkSyntax.js +   67 pass, 1 fail (pre-existing)
                            node --test
npm run check                                                       see above
```

The one server failure (`DocuGuard-Server/tests/notificationDelivery.test.js:185`,
"signing out removes the push token of the account") asserts that the removal
handler issues exactly one database call; the shipped handler issues a SELECT
plus an UPDATE (two calls). It predates this addendum, I did not modify the
route or the test, and all of its security assertions (200, token columns NULL'd,
`WHERE id = $1`, params `[7]`, 401 without a session) pass. It is an
implementation-detail assertion, not an authorization finding, and is outside
the four blocker items.

Everything above runs without a network, without a database (the `node:sqlite`
tests skip gracefully when unavailable) and without a device. Nothing was
built, installed or deployed.

---

### 9.6 Recommendation for the next stage

Items 9.1–9.3 are fixed and covered by regression tests: push-token ownership is
closed on sign-out, sign-in and now account deletion; offline notification
preferences are marked dirty and retried by the sync worker; deleted-account
local data is purged atomically, scoped per account, and cannot be read or synced
by another account.

Item 9.4 is a go/no-go product policy decision, not a code defect. The exact
alarm permission is declared and the code schedules at 09:00, but Play eligibility
for `SCHEDULE_EXACT_ALARM` is unresolved for a document-vault app. **Do not
submit to Play until this is decided:** keep the permission and accept
justification/rejection risk, or remove it and accept inexact (delayed) alert
delivery.

Recommended next stage: resolve item 9.4, then proceed to the APK build and
complete the manual Section 7 walk-through (device notification permission, push
token round trip on a real device, real-device expiry alerts, readiness probe,
deployment service account).

---

## 10. Addendum — Phase 5.2 Server Test Baseline and Final Sign-Off

**Date** — 2026-10-21

**Scope** — resolve the single server test failure left by Phase 5.1, then
re-verify the push-token lifecycle, preference reconciliation and account-deletion
cleanup against the actual implementation, and run the full safe verification
suite. No APK was built, no device was used, no EAS/native build was run, and
no production data was touched.

---

### 10.1 Failing-test investigation

**The failure** — `DocuGuard-Server/tests/notificationDelivery.test.js:185`
asserted `recorder.calls.length === 1` for `DELETE /push-token`. It failed
because the test recorder replaced `db.query` (which is `pool.query`), but the
handler checks out a dedicated client via `db.withTransaction` / `pool.connect`
and calls `client.query`, not `db.query` (config/db.js:40-45). The recorder
therefore observed **zero** calls, so the length gate could never pass and the
meaningful security assertions (SQL content, params, authorization) never ran.

**Not a regression** — this was a test measurement problem, not a behavior
change. The implementation behavior is correct and intended: the handler reads
the owned tokens first (needed to detach them from every other account), then
nulls them for the signed-in account, all inside one transaction. I confirmed
this by driving the handler directly against a faked client.

**The fix** — I updated the test (test-side only; the implementation was not
changed):
* Replaced `recordQueries` (db.query) with `recordClientQueries`, which fakes
  `db.withTransaction` to hand the route a client whose `client.query` calls are
  recorded. This is the only way to observe the handler's statements.
* Fixed `callRoute`: the Express `next()` is fire-and-forget — `authMiddleware`
  calls `next()` and returns without awaiting the downstream async work, so
  walking the whole middleware chain returned `res` before the handler called
  `res.json()`. The business handler is now invoked directly and awaited. Auth
  behavior remains covered by the separate no-session test, which invokes
  `authMiddleware` directly.
* Fixed a multi-line SQL regex literal (source spans a newline) and the
  `calls[last]` assumption (the last recorded call is `COMMIT`, so the detach
  statement is now located by matching its SQL).

**Verification** — the full server suite now passes: **80 tests, 80 pass, 0
fail**, including `check:syntax` (57 JS files parsed). The test still meaningfully checks
authorization (401 without a session, no DB calls), ownership (token NULL'd only
for the signed-in account via `WHERE id = $1`, params `[7]`), and delivery
behavior (a token owned by the account is detached from every other account via
`WHERE id <> $1 AND (expo_push_token = $2 OR fcm_token = $2)`).

---

### 10.2 Push-token lifecycle (confirmed)

| Path | File | Behavior | Status |
|---|---|---|---|
| Registration on sign-in | `app/(auth)/login.tsx:86` → `hooks/usePushNotifications.ts:168` | `registerPushTokenWithBackend()` called after `setAuthToken` + `switchLocalUser`. Server `POST /push-token` (`DocuGuard-Server/routes/notification.js:20`) registers for the signing-in account and detaches the token from every other account (`WHERE id <> $1`). | Confirmed |
| Removal on sign-out | `app/(tabs)/profile.tsx:824` | `removePushTokenFromBackend()` called before `clearLocalSession`/`setAuthToken(null)`, while the session is still valid so the server knows whose token it is. | Confirmed |
| Removal on account deletion | `app/(tabs)/profile.tsx:723-728` | Token removed **before** the delete-account request, while the session is valid. Best effort: failure does not block deletion; user warned. **Was missing entirely before Phase 5.1.** | Confirmed (fixed) |
| Removal failure | `hooks/usePushNotifications.ts:199-211` | Returns `false` (never throws). `resolveSignOutTokenOutcome` sets `removalPending: true`/`warnUser: true`. | Confirmed |
| No cross-account token removal | `DocuGuard-Server/routes/notification.js:128-131` | Detach uses `WHERE id <> $1`, so the signing-in account's own row is never cleared by another account's detach. | Confirmed |

**Residual risk** — if sign-out/removal fails offline, the device stays registered for the old account until the next successful sign-in re-registers and detaches. The user is warned each time. Acceptable; cannot be eliminated without a reachable server.

---

### 10.3 Preference reconciliation (confirmed)

| Question | Status | Evidence |
|---|---|---|
| Both offline preference paths persist `preferencesDirty: true`? | **Confirmed** | `app/(tabs)/profile.tsx:619-626` (`handleNotificationPreferenceChange`) and `services/notificationPreferences.ts:51-55` (`setNotificationsEnabled`) both supply `preferencesDirty: true` to `saveUserProfile`. |
| `saveUserProfile` preserves the flag for unrelated writes? | **Confirmed** | `services/localDatabase.ts:1866-1871` carries `preferences_dirty` over when the caller does not supply it, so document-counter writes do not drop a pending preference change. |
| Sync worker retries failed pushes? | **Confirmed** | `services/syncService.ts:474-482` pushes only when `profile.preferencesDirty`, clears the flag **only after** `api.client.patch` succeeds (`setLocalPreferencesDirty(false)` at line 481). A failed/offline push leaves the flag set and is retried on the next pass. |
| Stale server values overwrite newer local preferences? | **Ruled out** | Sync pushes local→server only; there is no server→local preferences pull. `fetchProfile` merges into React state, never into `user_profile`. |

---

### 10.4 Account deletion cleanup (confirmed)

| Question | Status | Evidence |
|---|---|---|
| Purge is atomic? | **Confirmed** | `services/localDatabase.ts:546` runs all deletes inside one `withExclusiveTransactionAsync` — all or nothing, no half-purged state. |
| Purge scoped to the deleted account? | **Confirmed** | Every delete scoped by `user_id` (documents, reminders, login_sessions, user_settings) or `id` (user_profile) or a `user_id`-scoped document subquery (document_tags, document_history). Another account's rows survive. |
| Session cleanup after purge failure? | **Confirmed** | `app/(tabs)/profile.tsx:761-780` — purge failure sets `localCleanupFailed` but execution still reaches `clearLocalSession()` (779) and `setAuthToken(null)` (780). The deleted account's session cannot stay live. |
| Deleted-account data synced under another account? | **Ruled out** | `switchLocalUser` purges the previous owner before a new account reads; `sync_queue` cleared by the purge; sync reads scoped by `user_id`; push token removed on deletion (10.2). |

---

### 10.5 Final verification results

```
npm run typecheck   tsc --noEmit          clean, no errors
npm test            node --test "tests/*.test.js"   163 tests, 163 pass, 0 fail
npm run check:server  check:syntax + node --test   57 JS files parsed + 80 tests, 80 pass, 0 fail
npm run check           typecheck + test + check:server   all green
```

The client suite now includes the new `tests/pushTokenOwnership.test.js` (8 tests) and the extended
`tests/localDatabase.sqlite.test.js` (preferences dirty flag + purge scoping). The server suite
includes the corrected `DocuGuard-Server/tests/notificationDelivery.test.js` (5 tests, all pass).
Nothing was built, installed, distributed, or deployed; no production data was modified.

---

### 10.6 Recommendation for the next stage

All four Phase 5.1/5.2 blocker areas are resolved and covered by regression tests:
push-token ownership is closed on sign-out, sign-in and account deletion; offline
notification preferences are marked dirty and retried by the sync worker;
deleted-account local data is purged atomically and scoped per account, with
session cleanup guaranteed even after purge failure.

The one outstanding item is the Android exact-alarm Play-policy decision
(Section 9.4) — a go/no-go product decision, not a code defect. **Do not submit
to Play until it is decided:** keep `SCHEDULE_EXACT_ALARM` and accept
justification/rejection risk, or remove it and accept inexact (possibly delayed)
alert delivery.

Recommended next stage: resolve item 9.4, then proceed to the APK build and the
manual Section 7 walk-through (device notification permission, push-token round
trip on a real device, real-device expiry alerts, readiness probe, deployment
service account).


