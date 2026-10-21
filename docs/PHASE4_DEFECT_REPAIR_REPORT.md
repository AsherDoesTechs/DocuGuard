# DocuGuard Phase 4 — Defect Repair Report

Phase 4 repairs the confirmed defects of the Phase 3.1 post-implementation
review (D1–D9, S1–S11) in the Expo/React Native client and in
`DocuGuard-Server`. No new features were added, no APK was built, installed or
distributed, and no production database migration was applied.

---

## 1. Verification

Every command below was executed in this working tree.

| Command | Result |
|---|---|
| `npm run typecheck` | clean, 0 errors |
| `npm test` (client) | **119 / 119 pass**, 14 files, 0 fail |
| `npm run check:server` | **58 / 58 pass**, 5 files, 0 fail |
| `npm run check` (typecheck + client + server) | all green |
| `node --test DocuGuard-Server/tests/documentSync.test.js` from the repository root | 9 / 9 pass (the test no longer depends on the working directory) |

Client test files and their sizes:

| File | Tests | Covers |
|---|---|---|
| `tests/syncPolicy.test.js` | 18 | failure classification, backoff, attempt budget, the pass gate, payload shape |
| `tests/syncWorker.test.js` | 13 | start/stop, scheduling, request merging, no overlapping runs |
| `tests/documentSyncCore.test.js` | 12 | push outcome, conflict detection, revision handling, delete path |
| `tests/documentPayload.test.js` | 11 | the exact payload that is sent to `POST /documents/sync` |
| `tests/revisionCompatibility.test.js` | 9 | canonical / legacy revision formats on both sides |
| `tests/localDatabase.sqlite.test.js` | 8 | the **real SQL** of `services/localDatabase.ts` executed against SQLite |
| `tests/cloudId.test.js` | 7 | server id normalisation (number, numeric string, bigint, garbage) |
| `tests/documentSaveCore.test.js` | 7 | save outcome, compensating delete, "do not delete an unrelated document" |
| `tests/documentSyncResolver.test.js` | 7 | which server row a payload belongs to |
| `tests/syncRetryStore.test.js` | 7 | the retry log, its persistence and its release rules |
| `tests/validationSchemas.test.js` | 7 | the shared validation schemas |
| `tests/validationContract.test.js` | 5 | client and server enforce the same contracts |
| `tests/offlinePersistence.test.js` | 4 | what survives a restart while offline |
| `tests/payloadContract.test.js` | 4 | client payload against server schema |

`tests/localDatabase.sqlite.test.js` does not copy the statements: it reads the
SQL out of `services/localDatabase.ts` and runs it in `node:sqlite`, so the
test exercises the statements that ship.

---

## 2. Repair batches

| Batch | Area | Defects |
|---|---|---|
| P1 | Server revision and conflict contract | D2, S3, S11 |
| P2 | Shared sync core (new `shared/sync/`) | D1, D4, D5, D6, S1, S2, S4, S9, S10 |
| P3 | Client save path | D1, D3, D4, S2 |
| P4 | Validation parity | S10, S11 |
| P5 | Local database correctness | D3, D7, S1, S2, S8 |
| P6 | Sync service, worker and retry log | D1, D5, D6, S3, S5, S6, S7, S9 |
| P7 | Auth, session and conflict surfacing | D5, D9, S3, S8 |

---

## 3. Defect by defect

### D1 — P0 · Server ids are strings, so `cloud_id` was never persisted — **fixed**

`documents.id` is a `BIGSERIAL`, so node-postgres returns it as the string
`"42"`. The client compared it with `typeof id === "number"` in several
places, so a valid id was treated as "no id at all". The consequences were:
the OCR draft link was dropped, the compensating delete after a failed local
insert never ran, a deleted document was hard-deleted locally instead of
tombstoned, and every reminder retry inserted a second server row.

* `shared/sync/cloudId.js` — `normalizeCloudId()` accepts a number, a numeric
  string or a bigint and rejects everything else. A wrong id would address the
  wrong server row, so a rejected value is reported as "no id".
* `shared/sync/documentSyncCore.js` — `readCloudId` uses it.
* `utils/ocr.ts` — the draft id is normalised before it is returned.
* `services/syncService.ts` — the reminder id is normalised before
  `setReminderCloudId`, so the update-in-place branch is reachable again.

The server response contract is unchanged: the normalisation happens at the
client boundary, so no deployed server has to change for this.

**Verified by** `tests/cloudId.test.js` (7) and `tests/documentSyncCore.test.js`
(12).

### D2 — P0 · Deployment ordering: a new client hit permanent 409s — **fixed**

The server rendered `updated_at` as a JS `Date` (millisecond precision) while
it compared the incoming revision with microsecond equality, so a client that
had synced once and then edited locally was told the document had been changed
on another device.

* `DocuGuard-Server/controllers/documentController.js` — `UPDATED_AT_ISO_SQL`
  renders the revision with `to_char(..., 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
  so the value a client sends back is the value the server stored.
* `REVISION_MATCH_SQL` compares with `date_trunc('milliseconds', …)`, so a
  client written against the previous format still matches the row it came
  from while a genuine concurrent edit still fails.
* `shared/sync/serverRevision.js` — `canonicalizeServerRevision()` rewrites a
  legacy millisecond revision into the canonical form and rejects a value that
  cannot be used.
* The server answers an unusable revision with **400** instead of letting
  Postgres throw on `$18::timestamptz` and answering 500.
* The client only sends `baseUpdatedAt` when the stored revision can be
  canonicalised. A document that has never been synced with revision tracking
  is pushed unconditionally once, and every push after that is conflict
  checked, because the answer carries the canonical revision.

**Verified by** `tests/revisionCompatibility.test.js` (9) and
`DocuGuard-Server/tests/documentSync.test.js` (9).

### D3 — P1 · `processingStatus: "processing"` was pushed and never cleared — **fixed**

A scanned document was pushed with `processingStatus: "processing"`, which
downgraded the server row from `completed` to `processing` permanently, and
the detail screen then waited for an OCR run that never came.

* `shared/sync/syncPolicy.js` — a document whose file is stored is always sent
  as `completed`; only a failed upload is sent as `failed`.
* `app/add-document.tsx` — a scan is `completed` (the OCR already ran), a
  picked file is `completed` after a successful upload and `failed` after a
  failed one.
* `services/localDatabase.ts` — `markDocumentSyncedWithCloud` moves a
  transient `pending` / `uploading` / `processing` state to `completed`.

**Verified by** `tests/documentPayload.test.js` (11) and the SQLite test
"a successful sync finishes a pending processing state".

### D4 — P1 · Picker-added files never reached the cloud — **fixed**

The metadata of a picked file was synced while the file itself stayed on the
device: the server had no `s3_key` and could not mint a file URL.

* `shared/sync/documentFileUpload.js` — the upload name, the file type check
  and the "does this document still need an upload" rule.
* `app/add-document.tsx` — the file is uploaded through the endpoint the OCR
  pipeline already uses (`getUploadUrl` → `uploadToS3`). The OCR draft
  endpoint is deliberately **not** called, because it would create a second
  server row. The upload runs before the local insert, so the stored row
  carries the storage key and the sync links the document to the uploaded
  object.
* A failed upload is reported to the user, the document is still saved on the
  device and the file stays there until the upload succeeds. Nothing is lost.
* The upload happens at most once per document: the storage key of the last
  upload is remembered and reused when the same file is saved again.

### D5 — P1 · Auth failures parked documents forever — **fixed**

A single expired session classified every queued document as a permanent
failure, and nothing ever released them, so the user was stuck.

* `services/localDatabase.ts` — `switchLocalUser` releases the records that
  were blocked by an expired session (`syncRetryStore.clearBlockedBy`).
* A different account starts with an empty retry log (`clearAll`), so the
  bookkeeping of one account never blocks another.
* `app/(tabs)/sync.tsx` — "Sync now" runs with `force: true`, so the user can
  always ask for an explicit attempt.

**Verified by** `tests/syncRetryStore.test.js` (7) and
`tests/syncPolicy.test.js` (18).

### D6 — P1 · The worker and "Sync now" could push the same document twice — **fixed**

* `shared/sync/syncMutex.js` — a process-wide lock. A pass that arrives while
  another one runs waits for it and then runs itself: nothing is dropped and
  no two passes touch the queue at the same time.
* `services/syncService.ts` and `services/syncWorker.ts` both run their pass
  through the same lock.
* `DocuGuard-Server/services/documentSyncResolver.js` — the server resolves
  the target row by id first, then by storage key, then by document number,
  so a retry updates the row it already created instead of creating a second
  one.

**Verified by** `tests/syncWorker.test.js` (13) and
`tests/documentSyncResolver.test.js` (7).

### D7 — P2 · `getAllDocuments` broke its own projection invariant — **fixed**

`getAllDocuments` hand-rolled its column list and left out
`server_updated_at`, so a document loaded that way carried no revision and the
next push was an unconditional overwrite.

`services/localDatabase.ts` — the read now uses the same `DOC_COLUMNS`
projection as every other read. The SQLite test asserts that the projection
and the table cannot drift apart.

### D8 — P2 · `services/documentPipeline.ts` was a dead, divergent duplicate — **fixed**

The file was a second, unused implementation of the save path that disagreed
with the real one on the field name — exactly the trap that produced D1. It
has been deleted; `app/add-document.tsx` uses `services/documentSaveService.ts`
and `utils/ocr.ts`.

### D9 — P2 · Realtime reconciliation was exported but never wired — **documented, not enabled**

`reconcileRealtimeDocument` / `reconcileRealtimeReminder` are implemented and
reviewed, but no screen mounts `useRealtime`, so no realtime message is
received and the reconciliation does not run. This is deliberate: mounting the
hook opens a websocket for every session, which is a behaviour change rather
than a repair, and the reconciliation writes to the local database from a
server event. The hook and the reconcilers now state this in their own
documentation, so the gap is visible instead of silent. The sync worker
remains the only path that brings server changes onto the device.

### S1 — `getLocalUserId()` returning null mid-save — **fixed**

A document that was queued for sync but had no owner would be written with
`user_id = NULL`: it would exist and be invisible at the same time, and every
read and the worker are scoped by `user_id`.

* `services/localDatabase.ts` — `createDocument` refuses to queue a document
  when the signed-in account cannot be determined, and says why.
* `claimUnownedRows` claims the documents that were written while nobody was
  signed in and queues the ones that never reached the cloud.

### S2 — A save reported success without a persisted row — **fixed**

* `services/localDatabase.ts` — `createDocument` reads the row back after the
  insert and fails the save when the id is not usable or the row is not
  there.
* `shared/sync/documentSaveCore.js` — the save result distinguishes "stored
  locally" from "stored in the cloud" and carries the cloud id.
* `services/documentSaveService.ts` — the compensating delete is only wired to
  the draft that belongs to *this* save, so a failure cannot delete an
  unrelated document.

### S3 — A conflict was unresolvable and invisible — **fixed**

The 409 body carries the revision the server holds; the client ignored it.

* `shared/sync/documentSyncCore.js` — the conflict outcome carries
  `serverUpdatedAt`.
* `services/syncService.ts` — `SyncResult` now carries a `conflicts` list
  (document id, title, the revision the server holds).
* `app/(tabs)/sync.tsx` — the conflict is reported on its own
  ("Sync Completed with Conflicts"), naming the documents and the moment the
  server last changed them. The local copy is kept and is not uploaded, so
  nothing is overwritten on either side: the decision belongs to the user.

### S4 — `SERVER_STATUSES` did not contain `"active"` — **fixed**

`shared/sync/syncPolicy.js` now lists `["active", "verified", "expired"]`, so
the fallback is not doing the work by accident.

### S5 — The worker never pushed reminders — **fixed**

`services/syncWorker.ts` runs its pass with `includeReminders: true`. A
reminder queued while offline is no longer waiting for the user to open the
Sync screen.

### S6 — The effective retry granularity was the poll interval — **documented**

The per-record backoff starts at 30 seconds and doubles to 30 minutes, but the
worker only looks for due records every 5 minutes, so the earliest retry of a
record with a 30 second backoff is 5 minutes after the failure. The rule is
now written down where the code lives (`services/syncWorker.ts`), so the
behaviour is not mistaken for a 30 second retry. The granularity itself was
not changed, because it is a deliberate trade-off between server load and
recovery time.

### S7 — A later request dropped the scope of an earlier one — **fixed**

`services/syncWorker.ts` merges the scopes of pending requests
(`mergeSyncRequest`), so a document that is waiting for its backoff is not
pushed early by an unrelated save and no document is dropped.

### S8 — The previous account's vault survived an account change — **fixed**

`clearLocalSession` deletes the local user id, and `getLocalUserId` falls back
to the token, so the next sign-in could not tell that the rows on disk belong
to somebody else. The purge was therefore unreachable.

* `services/localDatabase.ts` — the owner of the rows is recorded explicitly
  (`LAST_SIGNED_OUT_USER_ID_KEY`) and `getLocalDataOwnerId()` never falls back
  to the token.
* `switchLocalUser` compares the owner with the incoming account and purges
  the previous account's rows when they differ.

### S9 — The retry log was not account-scoped and never cleared — **fixed**

`syncRetryStore.clearAll()` is called when the account changes, and the
records blocked by an expired session are released when the same account signs
in again. The backoff and the attempt count of every other record are kept,
because they describe real attempts against a reachable server.

### S10 — The client and the server validation schemas had drifted — **fixed**

* `shared/validation/schemas.ts` and `shared/validation/schemas.js` now
  enforce the same rules.
* The password policy is split: `passwordSchema` (sign in, 6 characters) and
  `registrationPasswordSchema` (create an account, 8 characters plus
  complexity). Accounts that were created before the stricter policy existed
  keep working, and a password the app accepts is never refused by the API.

### S11 — A document without a number or issuer could not be synced — **closed by design**

The sync contract requires an issuer and a document number, and the app
requires both before a document can be saved (`app/add-document.tsx`). A
payload that does not satisfy the contract is refused with a 400 and the
record is parked as a validation failure — it is reported to the user, not
dropped silently. The path is therefore not reachable from the app.

---

## 4. Additional repairs found while implementing

* **A document without an expiry date could never be synced.** The date schema
  only accepted a string, so the `null` the app stores for "no expiration
  date" was a type error and the whole request was refused with a 400. Both
  schema files now accept a genuinely absent date, and an empty string is
  normalised to `null` before it reaches a `DATE` column.
* **`riskScore: null` / `riskLevel: null` were type errors.** The payload
  builder omits values that hold nothing, and the schema accepts an explicit
  null as "not assessed" instead of refusing the whole document.
* **The flag and the status moved apart.** `updateDocumentSyncStatus` now
  always writes `needs_sync` together with `sync_status`: `pending` and
  `failed` keep the record in the queue, `synced` and `local` release it.
  `markDocumentSynced` clears both, so a row no longer reads "waiting to sync"
  forever.
* **A server answer without a revision no longer erases the known one.**
  `markDocumentSyncedWithCloud` keeps the stored revision when the server
  sends none.
* **Editing a document kept the old revision.** The edit now stores the
  revision the server returned, so the next push is conflict aware instead of
  being answered with a 409 forever.
* **The profile notification flags were silently dropped.** `PATCH /profile`
  only accepts `{name, email}`, so the flags are now sent to
  `PATCH /profile/preferences`, which is the endpoint that persists them.
* **The biometric button was evaluated only once.** The availability check now
  runs on every focus of the login screen.

---

## 5. Deployment notes

1. **The server ships first.** The revision format change
   (`to_char(..., US)`) is in `DocuGuard-Server`. Deploy the server before a
   client build. The change is backward compatible with existing clients: a
   legacy millisecond revision still matches the row it came from, and the
   response of every read now carries a revision, which existing clients
   ignore.
2. **No database migration is required.** The local schema and the server
   schema are unchanged.
3. **No new server endpoint is needed by the client.** The file upload uses
   the endpoint the OCR pipeline already uses.
4. **The realtime path stays off** until it is covered by tests and the
   websocket behaviour is decided. Nothing in the sync path depends on it.

## 6. Files

Added

* `shared/sync/` — `cloudId`, `documentFileUpload`, `documentSaveCore`,
  `documentSyncCore`, `serverRevision`, `syncMutex`, `syncPolicy`,
  `syncRetryStore`, `syncWorkerCore` (each with a type declaration)
* `services/documentSaveService.ts`, `services/syncRetryStore.ts`,
  `services/syncWorker.ts`
* `DocuGuard-Server/services/documentSyncResolver.js`
* `tests/` — 14 test files and the fake local store helper
* `DocuGuard-Server/tests/documentSync.test.js`

Changed

* `DocuGuard-Server/controllers/documentController.js`
* `services/localDatabase.ts`, `services/syncService.ts`
* `app/add-document.tsx`, `app/edit-document/[id].tsx`, `app/(tabs)/sync.tsx`,
  `app/(auth)/login.tsx`, `app/_layout.tsx`
* `hooks/useRealtime.ts`, `utils/ocr.ts`
* `shared/validation/schemas.ts`, `shared/validation/schemas.js`
* `package.json` — `npm test` and the `check` script now include the client
  suite

Deleted

* `services/documentPipeline.ts` — the dead duplicate of the save path
