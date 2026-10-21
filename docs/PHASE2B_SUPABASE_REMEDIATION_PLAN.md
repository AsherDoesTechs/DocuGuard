# DocuGuard — Phase 2B: Supabase Least-Privilege Remediation Plan

**Plan date:** 2026-10-21
**Status:** **PROPOSAL / REVIEW ARTIFACT — NOT EXECUTED.**
**Scope:** the Supabase security findings recorded in `docs/PRODUCTION_DATA_FLOW_AND_RECOVERY_AUDIT.md`, remediated with a least-privilege design.
**Companion artifacts (this directory):**

| Artifact | Purpose |
|---|---|
| `docs/sql/phase2b_supabase_least_privilege.proposed.sql` | Proposed migration — review artifact only, never executed as part of this task |
| `docs/sql/phase2b_supabase_least_privilege.rollback.proposed.sql` | Rollback / recovery script + the capture procedure that must run *before* the migration |
| `docs/sql/phase2b_supabase_least_privilege.verify.sql` | Post-migration verification queries and regression probes |

**Nothing in this phase changed any state.** No SQL was executed, no application file was modified, no deployment or APK build was performed, and no Git state was changed (nothing staged, committed, stashed, reverted, or discarded). The original audit report `docs/PRODUCTION_DATA_FLOW_AND_RECOVERY_AUDIT.md` was read but not overwritten.

---

## 0. Evidence base and labelling

Four evidence labels are used throughout. They are deliberately kept separate because the whole plan depends on knowing which statements are observations and which are inferences.

| Label | Meaning |
|---|---|
| **VERIFIED IN CODE** | Read directly in the repository at the cited `path:line` in the audited tree. |
| **VERIFIED BY OWNER-SUPPLIED PRODUCTION EVIDENCE** | Established from the verified production SQL results and the Supabase Security & Access-Path Audit supplied by the project owner for this phase. |
| **DOCUMENTED BUT NOT VERIFIED** | Asserted by repository documentation or configuration intent; not confirmed by code inspection or live observation. |
| **UNKNOWN / REQUIRES MANUAL VERIFICATION** | Not determinable from the repository or from the supplied evidence. Needs the Supabase dashboard, the Render dashboard, or a live read-only session. |

### 0.1 Confirmed facts carried into this plan

1. **VERIFIED BY OWNER-SUPPLIED PRODUCTION EVIDENCE** — Render's `DATABASE_URL` points at the Supabase project. The direct PostgreSQL path and the PostgREST mirror therefore address **the same physical tables**, confirming the "mirror is a self-write" reading in `PRODUCTION_DATA_FLOW_AND_RECOVERY_AUDIT.md` §4.3.
2. **VERIFIED BY OWNER-SUPPLIED PRODUCTION EVIDENCE** — RLS is **enabled** on all 15 `public` tables. *This contradicts the repository schema* (`supabase-schema.sql:374-388` disables RLS on the same 15 tables).
3. **VERIFIED BY OWNER-SUPPLIED PRODUCTION EVIDENCE** — Security Advisor reports **12 `rls_enabled_no_policy`** findings and **one `function_search_path_mutable`** warning.
4. **VERIFIED BY OWNER-SUPPLIED PRODUCTION EVIDENCE** — the live `documents` Storage bucket is **private**.
5. **VERIFIED BY OWNER-SUPPLIED PRODUCTION EVIDENCE** — the live `public.update_modified_column()` trigger function is **owned by `postgres`**, has **`SECURITY DEFINER = false`**, and has **no configured function settings** (`pg_proc.proconfig IS NULL`).
6. **VERIFIED BY OWNER-SUPPLIED PRODUCTION EVIDENCE** — that function is used by triggers on `device_tokens`, `documents`, `profiles`, `reminders`, `subscriptions`, `user_settings` and `users` (7 dependencies).
7. **VERIFIED BY OWNER-SUPPLIED PRODUCTION EVIDENCE** — the live grants query reports that `anon` and `authenticated` each hold **seven** privileges on **every** table: `DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE`.
8. **VERIFIED IN CODE** — the Expo client talks only to the Express backend; the backend uses direct PostgreSQL (`pg`) **and** a Supabase **service-role** client.
9. **VERIFIED IN CODE** — the PostgREST calls cover `documents`, `reminders`, `profiles` and `exports`.
10. **VERIFIED IN CODE** — the repository schema file disables RLS and therefore **does not represent production**.
11. **UNKNOWN / REQUIRES MANUAL VERIFICATION** — the **actual deployed PostgreSQL connection username**, and **all live Storage policies**.

### 0.2 What is *not* established by the supplied evidence

These gaps are load-bearing and are carried forward as explicit blockers rather than guessed at:

* **Which 3 of the 15 tables have RLS policies.** 15 tables, RLS enabled everywhere, 12 `rls_enabled_no_policy` findings ⇒ at most 3 tables have policies. Which 3, and what they say, is unknown. Every table with a policy must be inspected before any statement about "deny-by-default" is made about it.
* **The live grant state of `service_role`.** The supplied grants summary names `anon` and `authenticated` only. `service_role`'s table privileges, its sequence privileges, and its `BYPASSRLS` attribute are not reported.
* **Schema-level grants** (`USAGE`/`CREATE` on schema `public`) for `anon`/`authenticated`.
* **Function-level grants** on `public` functions for `anon`/`authenticated`.
* **Live Storage policies** and Storage-schema grants for `anon`/`authenticated`.
* **Live sequence grants** for `anon`/`authenticated`/`service_role`.
* **Whether the live tables carry the columns the code writes** (`users.role`, `users.theme_mode`, `users.font_size`, `users.reduced_motion`, `users.analytics_enabled`, `users.crash_reports_enabled`, `users.data_sharing_enabled`). The repository schema and the repository migration disagree with each other here.
* **The deployed PostgreSQL connection username.** The repository's local `.env` names `postgres`, and `.env.example:41` shows `postgresql://postgres:…`, but the deployed `DATABASE_URL` is set manually in the Render dashboard (`DocuGuard-Server/render.yaml:32-33`, `sync: false`) and is not readable from the repository.

---

## 1. Section A — Inspection of the existing code and repository

### 1.1 Connection topology (VERIFIED IN CODE)

Two independent database paths leave the Express backend. They are **different privilege domains** and must never be treated as one.

```
Expo client  --HTTPS/JSON-->  Express API (Render: docuguard-api-onoj)
                                   |
                    +--------------+--------------+
                    |                             |
        path 1: `pg` Pool                 path 2: @supabase/supabase-js
        config/db.js                      config/supabase.js
        DATABASE_URL (verbatim)           SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
                    |                             |
                    +--------------+--------------+
                                   |
                   Supabase project ysxeobillupncexfkfvu
                   PostgreSQL  public.*  +  Storage bucket `documents`
```

* `DocuGuard-Server/config/db.js:4` — `DATABASE_URL` wins outright; `DB_*` is used only when `DATABASE_URL` is absent (`:6-9`).
* `DocuGuard-Server/config/db.js:11-21` — one `pg.Pool`, `max: 10`, `sslmode` taken from the connection string.
* `DocuGuard-Server/config/db.js:14-16` — the `ssl: { rejectUnauthorized: false }` branch is unreachable dead code.
* `DocuGuard-Server/config/supabase.js:4-7` — `supabaseAdmin`, built from `SUPABASE_SERVICE_ROLE_KEY`.
* `DocuGuard-Server/config/supabase.js:10-13` — a second client built from `SUPABASE_ANON_KEY`. **It is never imported by anything** (proof in §1.6). It is nevertheless *load-bearing*: `createClient()` throws `supabaseKey is required.` when the key is absent, so `require("../config/supabase")` fails at boot without `SUPABASE_ANON_KEY` — a hard requirement that `config/env.js:10-14` does **not** validate. The repository's own tests work around this by pre-setting a placeholder (`DocuGuard-Server/tests/storageService.test.js:4-11`).
* `DocuGuard-Server/services/realtimeService.js:1,5,13` — a *third* client instance, built from the **service-role** key despite the local variable being named `supabase`. A naming trap for any future reviewer.

### 1.2 Path 1 — direct PostgreSQL surface (`pg`)

Every statement below is `VERIFIED IN CODE`. The set is the complete set of tables the backend reaches over the direct connection.

| Table | Operations | Representative sites |
|---|---|---|
| `users` | `SELECT` (by `id`, by `email`, by `id`+scope), `INSERT`, `UPDATE` (many columns), `DELETE` (account deletion) | `authController.js:44-47,62-73,146-148,245-247,285-295,423-433,497-516,570-587,651-654,782-785`; `profileController.js:14-19,69-101,120-182,245-248,315-318,548-569,624-627,681-684,699-702,735-738,769`; `reminderController.js:126-129`; `routes/notification.js:52-132`; `expirationChecker.js:28-44` (join) |
| `documents` | `SELECT` (scoped, list, aggregate), `INSERT`, `UPDATE` (incl. `clock_timestamp()` revision guard), `DELETE` (scoped + account-wide) | `documentController.js:105-112,249-303,351-478,534-542,592-603,701-709,751-754,814-841,932-958,969-973,1139-1175,1179-1183,1214-1248,1322-1325,1364-1367`; `profileController.js:21-28,703-706,763`; `dashboardController.js:8-11`; `documentSyncResolver.js:50-102`; `dataSyncService.js:24-33,141` |
| `reminders` | `SELECT`, `INSERT`, `UPDATE`, `DELETE` | `reminderController.js:20-24,55-60,158-168,200-203`; `profileController.js:707-710,762`; `dashboardController.js:15-18` |
| `profiles` | — (no direct `pg` read/write; the table is written only through PostgREST) | — |
| `user_settings` | `SELECT`, `INSERT`, `UPDATE` | `profileController.js:337-346,395-398,432-456,711-714,735-738,764` |
| `login_sessions` | `SELECT`, `DELETE` (**never `INSERT`**) | `profileController.js:348-354,470-476,489-492,507-510,715-718,765` |
| `support_tickets` | `INSERT`, `SELECT`, `DELETE` | `profileController.js:280-283,719-722,766` |
| `transactions` | `INSERT`, `DELETE` | `profileController.js:321-324,767` |
| `exports` | `DELETE` only | `profileController.js:768` |
| `password_resets` | `SELECT` (`FOR UPDATE`), `INSERT`, `UPDATE` | `authController.js:584-587,636-658,699-702` |
| `subscriptions` | `INSERT … ON CONFLICT DO UPDATE` (production path is gated off) | `routes/subscription.js:78-111` |
| `activity_logs` | `INSERT` (production path is gated off) | `routes/subscription.js:124-137` |
| `device_tokens` | — (schema only; **no code path references it**) | — |
| `email_verifications` | — (schema only; **no code path references it**) | — |
| `subscription_payments` | — (schema only; **no code path references it**) | — |

**Conclusion:** the direct path needs `SELECT / INSERT / UPDATE / DELETE` on 12 tables, and **never** `TRUNCATE`, `REFERENCES` or `TRIGGER`.

Sequences: every `BIGSERIAL` primary key is populated by the database default (`nextval`), so the direct-path role needs `USAGE` (and `SELECT` for `currval`) on the sequences of the tables it inserts into. The tables with sequence-backed ids and an application insert are `users`, `password_resets`, `documents`, `reminders`, `subscriptions`, `activity_logs`, `subscription_payments`, `transactions`, `support_tickets`, `exports`, `user_settings`, `login_sessions`, `email_verifications`, `device_tokens`. `profiles.id` is a plain `BIGINT` primary key with no default — no sequence.

User-defined functions called by the direct path: **none**. The only user-defined function in the schema is the `update_modified_column()` trigger function, which is invoked implicitly by the trigger, not called from SQL. Everything else (`now()`, `clock_timestamp()`, `to_char()`, `date_trunc()`, `COALESCE`, `NULLIF`) lives in `pg_catalog`.

### 1.3 Path 2 — PostgREST (service-role) surface

| Operation | Table | Site | Notes |
|---|---|---|---|
| `.upsert(row)` | `documents` | `services/dataSyncService.js:178` (via `syncDocument` `:230`, `syncDocumentFromAuthoritative` `:268-273`) | Service-role. Payload is a full row on insert (`documentRow` `:42-64`), a persisted-row-shaped partial on update (`authoritativeDocumentRow` `:92-127`). |
| `.upsert(row)` | `reminders` | `services/dataSyncService.js:178` (via `syncReminder` `:280`) | Service-role. |
| `.upsert(row)` | `profiles` | `services/dataSyncService.js:304-313` | Service-role. 8-column payload. |
| `.delete()` | `documents`, `reminders` | `services/dataSyncService.js:284-288` | Service-role. Filtered by `id` **and** `user_id`. |
| `.insert([...])` | `exports` | `services/supabaseSync.js:28-30` | Service-role. `id` is **not** supplied ⇒ the `exports` sequence is used ⇒ `service_role` needs `USAGE` on `exports_id_seq`. |
| `.upsert(...)` | `documents` | `services/supabaseSync.js:50-52` | **Dead code** — `syncDocumentToCloud` has zero callers. |

**Conclusion:** the PostgREST path needs, on four tables only:

| Table | Required privileges | Why |
|---|---|---|
| `documents` | `SELECT, INSERT, UPDATE, DELETE` | `INSERT`/`UPDATE` for the mirror upsert; `DELETE` for the mirror delete; `SELECT` for Realtime `postgres_changes` and for PostgREST conflict resolution. |
| `reminders` | `SELECT, INSERT, UPDATE, DELETE` | Mirror upsert + delete; `SELECT` for Realtime. |
| `profiles` | `SELECT, INSERT, UPDATE` | Mirror upsert; `SELECT` for Realtime. `DELETE` is **not** used. |
| `exports` | `INSERT` | Export insert. `SELECT`/`UPDATE`/`DELETE` are not used by the PostgREST path (the export delete happens on the direct path). |

`service_role` needs **no** `TRUNCATE`, **no** `REFERENCES` and **no** `TRIGGER` anywhere.

### 1.4 Path 2 — Storage surface

| Operation | Site | Notes |
|---|---|---|
| `createSignedUrl(s3Key, 900)` | `services/storageService.js:64-66` | 15-minute TTL, `SIGNED_URL_TTL_SECONDS` (`:11`). |
| `remove([s3Key])` | `services/storageService.js:107-109` | Best-effort; errors swallowed (`:110-121`). |
| `createSignedUploadUrl(path, { upsert: false })` | `services/storageService.js:144-148` | Server-generated path `<userId>/<uuid><ext>`; `upsert: false` prevents overwrite. The SDK exposes no TTL parameter — the signed upload URL is valid for the platform's fixed window (2 hours). |

Bucket: `documents` (`storageService.js:4`), forced private in the canonical schema (`supabase-schema.sql:411-413`) and **confirmed private in production** by the supplied evidence. The repository contains **zero** `storage.objects` policies, zero `storage.buckets` policies, and zero `CREATE POLICY`/`GRANT`/`REVOKE` statements of any kind.

The mobile client writes object bytes directly with `fetch(uploadUrl, { method: "PUT", body: blob })` (`services/api.ts:223-252`). That request carries the **signed upload token**, not an API key, so the storage credential surface for uploads is the signed URL, not the anon key.

### 1.5 Path 2 — Realtime surface

`services/realtimeService.js:79-95` (`documents`), `:97-113` (`reminders`), `:115-131` (`profiles`), each filtered `user_id=eq.<userId>`; the same three tables are added to the `supabase_realtime` publication by `supabase-schema.sql:393-408`. The subscription client is the **service-role** instance (`:5,:13`). `subscribeAllUsers()` (`:185-202`) opens three channels per verified user at boot (`app.js:136-138`).

No mobile client consumes these events — `hooks/useRealtime.ts` is never mounted. This is a resource cost, not a security boundary, but it means Realtime must keep working after remediation or the server loses nothing functional (the WebSocket broadcast at `dataSyncService.js:201-205` is the path that actually matters).

### 1.6 Does any backend code use the `anon` or `authenticated` role?

**No. Verified exhaustively.** The proof:

1. `DocuGuard-Server/config/supabase.js:15` exports `{ supabase, supabaseAdmin }`.
2. A repository-wide search for imports of that module returns exactly **four** sites, and all four destructure `{ supabaseAdmin }`: `services/dataSyncService.js:1`, `services/storageService.js:1`, `services/supabaseSync.js:1`, `tests/documentMirror.test.js:107`.
3. The `supabase` (anon) export is imported by **nothing**, and no method is ever called on that instance.
4. `services/realtimeService.js:13` builds its own instance from the **service-role** key.
5. No code path issues `SET ROLE`, `SET SESSION AUTHORIZATION`, or connects with the anon key. No `pg` connection is made with a client-role credential.
6. The mobile bundle contains **no** Supabase URL, **no** Supabase key, **no** `@supabase/supabase-js` dependency, and makes **no** direct PostgREST/Storage/Realtime call. The only `supabase` string in mobile code is a substring test on an error URL (`utils/ocr.ts:154`).
7. Supabase Auth is not integrated: there are zero `.auth.*` call sites; `SUPABASE_JWKS_URL` is set in `.env.example:50` and `render.yaml:40-41` but referenced by no code. Authentication is custom (bcrypt + local JWT).

**Operational consequence, and the reason this matters even though no code uses the anon role:** the Supabase project serves PostgREST and Storage on the public internet. The anon key is *designed* to be public and is currently held in the Render environment (`render.yaml:36-37`). With seven DDL/DML privileges on every table for both `anon` and `authenticated`, anyone holding the anon key can read every row of every table — `users.password_hash`, `users.two_factor_secret`, `users.verification_token`, `documents.ocr_data`, `exports.data` — and can write, delete and truncate. RLS with no policy limits *rows*, not the *fact of access*; a table with RLS enabled and no policy still allows an authorised role to see zero rows, but a role holding `SELECT` on the table can still attempt every statement, and the live grant state is what makes the table reachable at all. Removing the grants is the substantive fix; the RLS posture is the second layer.

### 1.7 Assumptions in migrations, triggers and schema files

| # | Assumption in the repository | Why it is now unsafe | Evidence |
|---|---|---|---|
| D1 | `supabase-schema.sql:374-388` — `ALTER TABLE … DISABLE ROW LEVEL SECURITY` on all 15 tables. | **Production has RLS enabled on all 15.** Re-running the canonical schema against production **re-disables RLS**, which — combined with the live `anon`/`authenticated` grants — is a total data disclosure. This is the single most dangerous drift in the repository. | Supplied evidence #2, #10 |
| D2 | `supabase-schema.sql:318-324` — `CREATE OR REPLACE FUNCTION update_modified_column()` with **no `SET search_path`**. | This is the exact body of the live function (owned by `postgres`, `SECURITY DEFINER = false`, no settings), and it is the source of the single `function_search_path_mutable` advisory. | Supplied evidence #5; `supabase-schema.sql:318-324` |
| D3 | `supabase-schema.sql:326-366` — 7 trigger bindings of `update_modified_column()`: `users`, `documents`, `subscriptions`, `device_tokens`, `user_settings`, `profiles`, `reminders`. | **Matches the live set of 7 exactly.** This is the one place where the repository schema and production agree, and it is what makes the search-path hardening safe to plan. | Supplied evidence #6 |
| D4 | `supabase-schema.sql` contains **no** `GRANT`, **no** `REVOKE`, **no** `CREATE POLICY`. | The live grant state is invisible to the repository, so no review, no CI check and no migration can see the exposure. | Repository-wide search |
| D5 | `supabase-schema.sql:7-26` — `users` has no `role` column, but `authController.js:285-295` returns `RETURNING id, email, role`. | Either the live table has an undocumented column or the endpoint is broken. | `PRODUCTION_DATA_FLOW…` P1-3 |
| D6 | `DocuGuard-Server/migrations/001_add_settings_tables.sql:3-31` creates `user_settings`/`login_sessions` with `SERIAL` (int4) `id`, `user_id INTEGER NOT NULL DEFAULT 1` and **no FK**, while `supabase-schema.sql:180-210` uses `BIGSERIAL`, `BIGINT` and `REFERENCES users(id) ON DELETE CASCADE`. | Two incompatible definitions of the same two tables, and a second source of truth for the schema. | Direct file comparison |
| D7 | `supabase-schema.sql` does not define `users.theme_mode`, `font_size`, `reduced_motion`, `analytics_enabled`, `crash_reports_enabled`, `data_sharing_enabled`, but `profileController.js:604-608,661-665` writes all six. | Defined only in the ad-hoc migration D6. Column-level drift. | `migrations/001_add_settings_tables.sql:34-40` |
| D8 | `DocuGuard-Server/.env.example:55-57` — *"Create a bucket named `documents` … **Set bucket to PUBLIC** for direct file access"*. | Directly contradicts `supabase-schema.sql:411-413` (`public = FALSE`) and the production state (private). An operator following the example file re-opens permanent public access to identity documents. | `.env.example:56` |
| D9 | `supabase-schema.sql:411-413` — the bucket insert sets no `file_size_limit` and no `allowed_mime_types`. | The 15 MB cap and MIME allow-list exist only in application code (`storageService.js:20-29`), so they are not enforced by Storage. | `storageService.js:20-29` |
| D10 | `run-migration.js:4-7` connects with `process.env.DATABASE_URL`, `ssl: { rejectUnauthorized: false }`, no target assertion, no `--apply` flag, and executes DDL directly. | Running it against the wrong `DATABASE_URL` alters production. It also uses a weaker TLS posture than the server. | `run-migration.js:1-37` |
| D11 | `supabase-schema.sql:30-31` — `profiles.id` and `profiles.user_id` are both `REFERENCES users(id) ON DELETE CASCADE`; `profiles.id` is **not** a sequence-backed default. | The mirror upsert supplies `id` explicitly (`dataSyncService.js:305`), so no sequence is needed for `profiles` — but `exports` **does** need one. | `dataSyncService.js:304-313` vs `supabaseSync.js:28-30` |
| D12 | `routes/subscription.js:17-22` 503s in production, so `subscriptions` and `activity_logs` are never written in production. | The direct path still needs `INSERT`/`UPDATE` on `subscriptions` and `INSERT` on `activity_logs` for the non-production path to keep working. | `routes/subscription.js:78-137` |
| D13 | `device_tokens`, `email_verifications`, `subscription_payments` exist in the schema and are referenced by **no** code path. | Dead tables. They are also the only three tables *not* in the supplied trigger-dependency list, and they hold `device_tokens.token` (a push token) in plaintext. | `supabase-schema.sql:107-114,138-147,215-222`; repository-wide search |

### 1.8 The RLS interaction trap (critical)

Live RLS is enabled on all 15 tables and at least 12 of them have **no policy**. For any role that does **not** bypass RLS, "RLS enabled + no policy" means **deny every row and deny every write**.

The direct PostgreSQL connection currently works against that live state. That is only possible because the connecting role **bypasses RLS** — it is the table owner (`postgres`), and table owners bypass RLS unless `ALTER TABLE … FORCE ROW LEVEL SECURITY` is set. The repository never issues `FORCE ROW LEVEL SECURITY` and the supplied evidence does not report it either.

**Therefore: replacing the application's connection with a "clean" non-owner role that lacks `BYPASSRLS` would take the entire application down** — every query against the 12 policy-less tables would return zero rows and every write would fail with `new row violates row-level security policy`. This is the reason the backend-role change is staged in §2.4 and §9 rather than bundled into the Phase 2B migration.

**Corroboration (added 2026-10-21, after the phase-2B analysis).** The project owner confirmed during this phase that `GET /health/ready` now returns 200, i.e. the deployed service **is** currently reaching PostgreSQL successfully. The readiness route runs `SELECT 1` (`DocuGuard-Server/app.js:87`), which touches no table, so it does not by itself prove that the RLS-enabled tables are readable. However, the same deployed service serves document and reminder routes against those tables, and those routes are reported as working. Taken together with §1.8, this is consistent with — and reinforces — the conclusion that the deployed connection role bypasses RLS (it is the table owner). **It is not an independent proof of the connection username**, which remains **UNKNOWN** until it is read from the Render dashboard.

---

## 2. Section B — Least-privilege design

### 2.0 Principles applied

1. **Separate the privilege domains.** Table privileges, RLS policies, function-execute privileges, sequence privileges and Storage authorisation are five different mechanisms. They are designed and remediated separately, and the plan never conflates them.
2. **Deny by default, and never re-open by default.** Removing a privilege can only reduce reach. Adding a policy can only increase reach. The migration is therefore a subtraction script; every addition is opt-in and separately justified.
3. **Revoke what is not used, grant what is used, by name.** Every statement names the schema, the object and the privilege. No `GRANT ALL`, no `REVOKE ALL`, no `ALL TABLES IN SCHEMA` as a shortcut, no unqualified `ALTER TABLE`.
4. **A privilege that is revoked because it was unused today will be re-added the day a legitimate consumer appears** — through a reviewed migration, never by hand.
5. **A role is not a proxy for another role.** The service-role client and the direct PostgreSQL connection are separate privilege domains and are specified separately below.

### 2.1 `anon`

**Role:** the Supabase PostgREST/Storage anonymous client role. Its key is designed to be public.

| Aspect | Current (live) | Target | Reason |
|---|---|---|---|
| Table privileges | `SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER` on **all 15** `public` tables | **none** on all 15 | No code path uses this role (§1.6). Every privilege held is pure exposure. |
| Sequence privileges | UNKNOWN | **none** | A client role must not be able to burn sequence values. |
| Schema `public` | UNKNOWN | keep `USAGE`; **revoke `CREATE`** if held | Revoking `CREATE` removes object-shadowing risk with zero functional impact. Revoking `USAGE` is *not* proposed by default because it changes PostgREST's error surface from "permission denied for table" to "relation not found" and interacts with platform internals — see §2.7. |
| RLS policies | 12 tables have none (deny-by-default); 3 tables have unknown policies | **no policy may grant anything to `anon`** | Table-privilege removal already makes every policy unreachable for this role (PostgreSQL evaluates the table privilege before RLS). The 3 unknown policies are reviewed and any `anon`-facing policy is dropped as a follow-up. **A policy written `TO public` also grants to `anon` and `authenticated` and must be treated as a client-role policy** — the verification queries check for it explicitly. |
| Function execute | UNKNOWN | no `EXECUTE` on application functions in `public` | The application defines one public function, a trigger function, which cannot be invoked directly. |
| Storage | bucket `documents` is private; policies UNKNOWN | no policy may grant `anon` any access to the `documents` bucket | All legitimate access is via server-minted signed URLs. |

**Rationale in one line:** `anon` is the role the internet can reach with a public key; it needs to hold **no** privilege on any application object, and the RLS layer then provides the second lock.

### 2.2 `authenticated`

**Role:** the role Supabase Auth mints a session JWT for. **DocuGuard does not use Supabase Auth** (§1.6), so no token in this system ever carries this role.

| Aspect | Current (live) | Target | Reason |
|---|---|---|---|
| Table privileges | `SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER` on **all 15** tables | **none** on all 15 | Exactly the same as `anon`. A future Supabase Auth integration must not inherit a blanket write grant on `users` (which holds `password_hash`, `two_factor_secret`, `verification_token`) or on `documents` (which holds `ocr_data`). |
| Sequence privileges | UNKNOWN | **none** | As `anon`. |
| Schema `public` | UNKNOWN | as `anon` | As `anon`. |
| RLS policies | as `anon` | no policy may grant anything to `authenticated` until a deliberate, per-table policy is authored | |
| Function execute | UNKNOWN | none on application functions | |
| Storage | policies UNKNOWN | no `authenticated` policy on the `documents` bucket | |

**Forward-looking note (design constraint, not a change):** when Supabase Auth is introduced, it must **not** be pointed at the existing `public.users` table, because that table is the application's credential store. The correct shape is a separate `auth`-owned identity table plus a `public` profile table keyed by `auth.users.id`, with per-user RLS policies written per table. That is a Phase 3 design, not a Phase 2B change; this plan's job is to ensure that when it happens, the role starts from **zero** privileges rather than from "all seven on every table".

### 2.3 `service_role`

**Role:** the PostgREST / Storage / Realtime role the backend uses with the service-role key. It is **not** a PostgreSQL login role for the `pg` pool; it is a database role that PostgREST and Storage switch to after authenticating the key.

| Aspect | Current (live) | Target | Reason |
|---|---|---|---|
| `BYPASSRLS` attribute | UNKNOWN | **must be `true`** | With RLS enabled on all 15 tables and 12 of them policy-less, a `service_role` without `BYPASSRLS` would be denied every mirror write. The mirror would silently stop working (its failures are swallowed — `dataSyncService.js:191-196`). This is a **precondition**, checked before the migration runs. |
| Table privileges | UNKNOWN (Supabase default is "all on all tables") | `SELECT, INSERT, UPDATE, DELETE` on `documents`, `reminders`, `profiles`; `SELECT, INSERT, UPDATE` on `profiles`; `INSERT` (+`SELECT`) on `exports`; and **no** `TRUNCATE`, `REFERENCES` or `TRIGGER` anywhere | The mirror, the export insert and Realtime need exactly these. `TRUNCATE`/`REFERENCES`/`TRIGGER` are never used by any code path. |
| Sequence privileges | UNKNOWN | `USAGE, SELECT` on the sequences of the four PostgREST tables | `exports` insert omits `id`, so `nextval` runs as `service_role` and needs `USAGE` on `exports_id_seq`. |
| Function execute | UNKNOWN | `EXECUTE` on `public.update_modified_column()` (explicitly granted) | A `BEFORE UPDATE` trigger fires on the PostgREST upsert path. The function runs with the invoker's rights (`SECURITY DEFINER = false`), so the invoking role must hold `EXECUTE`. |
| Storage | service-role Storage access is required for `createSignedUrl`, `createSignedUploadUrl` and `remove` | unchanged | These are the only three Storage operations the product performs. |
| RLS | bypassed by the attribute | unchanged | |
| Role memberships | UNKNOWN | must not be a member of any other role, and no other role must be a member of it | A membership edge silently grants everything the member role holds. |

**Explicitly not assumed:** the plan does not assume `service_role` currently holds "all on all tables", and it does not narrow `service_role` to the four tables by default. The narrowing is in §2.8 as an **opt-in proposal** because the live grant state is unknown and the dashboard's own tooling may hold paths the repository does not show. The **unconditional** part of the `service_role` change is the removal of `TRUNCATE`, `REFERENCES` and `TRIGGER` — three privileges that no code path uses, and the only ones whose removal cannot break a consumer that does not exist.

### 2.4 The backend's direct PostgreSQL connection role

**Current:** the deployed username is **UNKNOWN** (evidence #11). The repository's local `.env` names `postgres` (`DB_USER=postgres`), `.env.example:41` shows `postgresql://postgres:…`, and `postgres` is the owner of `public.update_modified_column()` (supplied evidence #5) — so the deployed role is very probably `postgres`, i.e. the **owner and effectively a superuser** of the project. This is the largest standing privilege in the system and it is the reason §1.8's trap matters.

**Target design (Phase 2C — deliberately *not* in the Phase 2B migration):**

| Aspect | Target for a dedicated application role (e.g. `docuguard_app`) | Reason |
|---|---|---|
| Role attributes | `NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS` — but with `BYPASSRLS` granted explicitly, or an equivalent per-table policy model | See §1.8: without `BYPASSRLS` the application is denied by the live policy-less RLS. A dedicated role must therefore be created with the RLS bypass it needs, and the bypass should be an **explicit, documented attribute** rather than an accident of ownership. |
| Table privileges | `SELECT, INSERT, UPDATE, DELETE` on the 12 tables the code actually touches (§1.2); **no** `TRUNCATE`, `REFERENCES`, `TRIGGER`; **no** privilege on `device_tokens`, `email_verifications`, `subscription_payments` (dead tables, §1.7 D13) | Least privilege per §2.0. |
| Sequence privileges | `USAGE, SELECT` on the sequences of the tables it inserts into | `nextval` on `BIGSERIAL` defaults. |
| Function execute | `EXECUTE` on `public.update_modified_column()` | The trigger fires for its own `UPDATE`s. |
| DDL | **none** | The application never migrates. `run-migration.js` must not run as this role. |
| Ownership | **none** | The application must not own the tables, or it can alter them, and RLS bypass becomes accidental rather than declared. |
| RLS | bypassed by explicit attribute | Documented, reviewable, and revocable in one place. |
| Memberships | none; not a member of `postgres`, `service_role`, `anon` or `authenticated` | A membership edge would hand over the whole superuser surface. |

**The transition must be done in this order, and never in one step:**
1. Create the role and grant the §2.4 privileges; create the matching `DATABASE_URL`.
2. Point the Render service at the new `DATABASE_URL` and restart; observe `/health/ready` and one full document read/write cycle.
3. Only then remove `postgres` credentials from the Render environment.

Skipping step 3 leaves the superuser credential in the production environment, where the least-privilege change buys nothing.

**Why this is not in the Phase 2B migration:** it requires a credential change in the Render dashboard, a restart, and a real traffic window; and the live connection username is unconfirmed. Folding it into a DDL script would mean a script that changes the authentication principal of a live application — which cannot be rolled back by running SQL.

### 2.5 Database owner and migration role

| Aspect | Position | Reason |
|---|---|---|
| `postgres` (or a dedicated `docuguard_migrator`) | Owns `public.*` and the trigger function; used **only** from the Supabase SQL editor or a controlled CI job with the credentials in a secret store | DDL, ownership changes and `GRANT`/`REVOKE` are owner-level operations. |
| Application | must **not** be `postgres`, and must not be a member of it | A membership edge is equivalent to the credential. |
| Trigger-function ownership | **unchanged** — stays `postgres` | Ownership is not being changed by this phase, and the search-path fix does not require it. |
| Migration files | must be idempotent, and must be run with an explicit target assertion | `run-migration.js` currently has none (D10). |
| Anonymous/public DDL | `CREATE` on schema `public` is **not** granted to `anon`/`authenticated` | Prevents a client role from shadowing a function or a table. |

### 2.6 Distinguishing the five privilege domains — worked example

The same table, `public.documents`, carries five independent mechanisms. A change to one says nothing about the others:

| Mechanism | `anon` today | `anon` after | `service_role` after | Backend `pg` role after |
|---|---|---|---|---|
| **Table privilege** | `SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER` | *none* | `SELECT, INSERT, UPDATE, DELETE` | `SELECT, INSERT, UPDATE, DELETE` |
| **RLS policy** | none on this table (deny-by-default) | unchanged (no policy added) | bypassed via `BYPASSRLS` | bypassed via explicit attribute (Phase 2C) |
| **Function execute** (`update_modified_column`) | not needed | unchanged | explicit `GRANT EXECUTE` | explicit `GRANT EXECUTE` |
| **Sequence privilege** (`documents_id_seq`) | UNKNOWN | revoked | `USAGE, SELECT` | `USAGE, SELECT` |
| **Storage authorisation** | bucket private; policies UNKNOWN | no policy grants `anon` | signed-URL minting retained | n/a (the `pg` path never touches Storage) |

Note the two facts that are easy to get wrong:

* **Revoking the table-level `TRIGGER` privilege does not stop triggers from firing.** `TRIGGER` on a table governs `CREATE TRIGGER`; a firing trigger requires `EXECUTE` on the *function*. The plan revokes the former and preserves the latter.
* **Revoking the table privileges makes every RLS policy unreachable for that role.** PostgreSQL checks the table privilege before it evaluates any policy. A policy that would have allowed `anon` to read a table is inert once `anon` holds no `SELECT` on it. This is why the migration can be a pure subtraction and does not need to touch the 3 unknown policies in order to close the exposure.

### 2.7 What the Phase 2B migration does and does not do

**Does (all reversible, all subtraction or an explicitly-justified addition):**
1. `REVOKE` the seven named privileges from `anon` and `authenticated` on each of the 15 named `public` tables.
2. `REVOKE` `USAGE, SELECT, UPDATE` from `anon` and `authenticated` on every sequence owned by those 15 tables (sequences discovered at run time from the catalogue, not guessed by name).
3. `REVOKE` `CREATE` on schema `public` from `anon` and `authenticated`, **if** it is currently held.
4. `REVOKE` `TRUNCATE, REFERENCES, TRIGGER` from `service_role` on the 15 tables — three privileges no code path uses.
5. Explicitly `GRANT` the required `service_role` privileges on the four PostgREST tables and the required sequence privileges, so the required surface is stated positively rather than left implicit.
6. `ALTER FUNCTION public.update_modified_column() SET search_path = pg_catalog, public;` — the `function_search_path_mutable` fix, as a separate, clearly-scoped operation that changes **no** privilege, **no** ownership, **no** body and **no** `SECURITY DEFINER` flag.
7. Explicitly `GRANT EXECUTE ON FUNCTION public.update_modified_column() TO service_role;` so the trigger dependency is documented and survives a future `REVOKE EXECUTE … FROM PUBLIC`.

**Does not (deliberately):**
1. It does **not** create any RLS policy. Deny-by-default is the target state; a permissive policy added to silence Security Advisor would be a regression, not a fix.
2. It does **not** enable or disable RLS on any table, and does **not** issue `FORCE ROW LEVEL SECURITY`.
3. It does **not** change any ownership.
4. It does **not** narrow `service_role` to the four tables by default (§2.8).
5. It does **not** drop or alter any of the 3 unknown policies (§2.8).
6. It does **not** change schema-level `USAGE` for `anon`/`authenticated` (§2.1).
7. It does **not** change the application's database credential (§2.4).
8. It does **not** touch Storage policies — the live policies are unknown, and the evidence says the bucket is private, so no Storage change is justified from what is known.

### 2.8 Proposals requiring human review (explicitly left as proposals)

These cannot be completed safely from the repository plus the supplied evidence, and are **not** executed by the proposed script. Each is present in the script as a clearly-marked, opt-in block that reports what it *would* do and requires an explicit enabling setting.

| # | Proposal | Why it is not executed by default | How to enable |
|---|---|---|---|
| P1 | Narrow `service_role` to the four PostgREST tables (`documents`, `reminders`, `profiles`, `exports`) plus the `storage` schema. | The live `service_role` grant state is unknown, and the Supabase dashboard's own tooling may hold paths the repository does not show. A wrong narrowing breaks the mirror **silently** (its errors are swallowed — `dataSyncService.js:191-196`). | Set `docuguard.apply_service_role_narrowing = 'on'` in the session after reviewing the "extra tables" list the block prints. |
| P2 | Drop any RLS policy that grants `anon` or `authenticated` access. | The 3 tables with policies are unknown; the policy bodies were not supplied. A policy written `TO public` counts as a client-role policy, because it grants to both. | Review the printed policy list; then run the documented `DROP POLICY` statements individually. |
| P3 | Drop any Storage policy on the `documents` bucket that grants `anon`/`authenticated`. | Live Storage policies are explicitly unconfirmed (evidence #11). A wrong drop breaks signed-URL access. | Manual, after the Storage policy inventory is captured. |
| P4 | `REVOKE EXECUTE ON FUNCTION public.update_modified_column() FROM PUBLIC`. | A firing trigger requires `EXECUTE` on the function. Until the deployed direct-connection username is confirmed and a dedicated application role exists, revoking from `PUBLIC` could break the trigger for the current connection role. | Phase 2C, together with §2.4. |
| P5 | `REVOKE USAGE ON SCHEMA public FROM anon, authenticated`. | Changes PostgREST's error surface from "permission denied" to "relation not found" and interacts with platform internals in ways the repository cannot verify. | Manual, after a staging check. |

---

## 3. Section C — The proposed migration

**Artifact:** `docs/sql/phase2b_supabase_least_privilege.proposed.sql` — **review artifact only. It was not executed.**

### 3.1 Structure

| Part | Content | Mutating? |
|---|---|---|
| Header | The expected project (`ysxeobillupncexfkfvu`), expected database (`postgres`), expected host, how to run, and the safety notes | No |
| Part A | Read-only inspection: connection identity, role attributes and memberships, effective table/sequence/schema/function grants, RLS status, policy inventory, trigger dependency inventory, function definition, and a catalogue fingerprint | No |
| Part B | A **single** `DO` block that (1) asserts every precondition and `RAISE EXCEPTION`s if any is unsatisfied, then (2) performs the changes, then (3) reports what it changed | **Yes — one atomic statement** |
| Part C | Read-only post-checks that mirror the verify script | No |

**Why a single `DO` block:** it is one statement, so it is one transaction, so a failed precondition rolls back every change with it. This is atomic in the Supabase SQL editor, in `psql`, and in any other client, without depending on the client wrapping the script. It also means the operator cannot accidentally run half of it.

**Validation status of the three SQL artifacts.** This phase was explicitly forbidden from executing SQL, so the scripts have **not** been parsed or run against any PostgreSQL instance — including a local scratch database. They have been reviewed statically only: statement-level syntax, `RAISE` placeholder/argument arity, PL/pgSQL block balance, `text`/`name` type coercions, and the newline-separated string-literal concatenation rule were all checked by hand. **A syntax check is therefore part of the mandatory rehearsal in §8**, and it is step 0 of the operator procedure: run Part A (read-only) and Part B in a throwaway project, confirm the script parses and the preconditions behave as documented, and only then rehearse in the production-mirror project. A parse error in Part B is harmless — nothing is applied — but it must be found before the production window, not inside it.

### 3.2 Preconditions (the script aborts if any is unsatisfied)

| # | Precondition | If it fails |
|---|---|---|
| P1 | `current_database() = 'postgres'` | Abort — wrong database |
| P2 | The `storage` schema and the `auth` schema exist | Abort — not a Supabase project |
| P3 | All 15 expected `public` tables exist | Abort — schema drift, manual review |
| P4 | RLS is **enabled** (`relrowsecurity = true`) on all 15 | Abort — the live state is not what this plan assumes; **never** "fix" it by disabling it |
| P5 | `service_role` exists and has `rolbypassrls = true` | Abort — the mirror would break; this is the single most important check |
| P6 | `public.update_modified_column()` exists, is in schema `public`, is owned by `postgres`, has `prosecdef = false`, and has `proconfig IS NULL` | Abort — the function is not in the state the evidence describes, or someone has already configured it; the script must not clobber an existing configuration |
| P7 | The trigger dependencies of that function are exactly the 7 expected tables | Abort — a different trigger set may change what hardening is safe |
| P8 | `anon` and `authenticated` exist as roles | Abort — platform roles missing; wrong project |
| P9 | The three tables that carry RLS policies are listed and reviewed by the operator before Part B runs | Manual — printed by Part A, recorded in the change ticket |

### 3.3 Impact of the proposed changes

| Change | Blast radius | Failure mode if wrong |
|---|---|---|
| `REVOKE` 7 privileges × 2 roles × 15 tables | Only the `anon` / `authenticated` roles | **None for the product** — no code path uses these roles (§1.6). If it turns out that something does, that something is a client-side or third-party consumer and is *supposed* to be denied. |
| `REVOKE` sequence privileges from `anon`/`authenticated` | Same | None for the product |
| `REVOKE CREATE ON SCHEMA public` (if held) | Schema-level | None for the product |
| `REVOKE TRUNCATE/REFERENCES/TRIGGER` from `service_role` | `service_role` only | None — no code path uses those three privileges |
| `GRANT` (re-state) `service_role` privileges on 4 tables | `service_role` only | None — additive; restores rather than removes |
| `GRANT EXECUTE` on the trigger function to `service_role` | `service_role` only | None — additive |
| `ALTER FUNCTION … SET search_path = pg_catalog, public` | The trigger function | The function body uses only `NOW()` and `NEW.updated_at`, both resolved from `pg_catalog`; the change is behaviour-preserving. It does **not** change ownership, the body, `SECURITY DEFINER`, or any execute privilege. |

### 3.4 What transactional DDL does **not** protect against

The Part B block is atomic. That guarantee covers the *script*. It does not cover the *system*, and the difference must be understood before the script is run:

1. **It does not restore data deleted by a destructive operation.** Privilege changes delete no rows, but a `TRUNCATE` or `DELETE` executed by another principal between the capture and the rollback is not undone by a rollback of the DDL. There is **no backup and no verified restore path** in this product (`PRODUCTION_DATA_FLOW…` §5, P0-2). A rollback restores *permissions*, never *data*.
2. **It does not protect against an in-flight request.** A connection that authenticated before the change keeps its session; a statement already in flight completes against the old ACL snapshot. A request that fails mid-migration can leave the mirror partially written — and the mirror's failures are swallowed, so a partially-migrated mirror would be **invisible** in the logs.
3. **It does not protect against a concurrent privileged session.** Another `postgres` session writing, creating a policy, or granting a privilege during the window is not serialised against Part B.
4. **It does not protect against the mirror's silent-failure design.** The mirror (`dataSyncService.js:174-208`) swallows errors and answers 200. If Part B removed something the mirror needs, the first symptom is a *stale mirror*, not an error. This is why Part B **re-states** the `service_role` grants positively rather than relying on a default, and why the preconditions include the `BYPASSRLS` check.
5. **It does not roll back the application.** Changing a database privilege is not a deployment; the Render service is untouched by this script and must be re-verified separately (§5).

---

## 4. Section D — Rollback

**Artifact:** `docs/sql/phase2b_supabase_least_privilege.rollback.proposed.sql` — **review artifact only. It was not executed.**

### 4.1 The capture that must happen first

The rollback script restores **exactly** what the migration changed, and nothing else. That is only possible if the original state is captured *before* the migration runs. The rollback file therefore opens with a **capture** section that must be run first and its output archived with the change ticket:

* the effective grant matrix for `anon`, `authenticated`, `service_role` on all 15 tables and on all their sequences;
* the schema-level grants on `public` for `anon`/`authenticated`;
* the function-level grants on `public.update_modified_column()`;
* the complete `pg_get_functiondef` of `public.update_modified_column()` and its `pg_proc.proconfig`;
* the role attributes and the full `pg_auth_members` graph;
* the RLS status, policy inventory and trigger inventory;
* the catalogue fingerprint (table list, row counts, checksums).

If the capture is not taken, the rollback cannot be specific, and the only safe fallback is the manual, privilege-by-privilege reconstruction documented in §4.4.

### 4.2 What the rollback restores

| Change made by Part B | Restored by | Source of the original value |
|---|---|---|
| `REVOKE` 7 privileges from `anon`/`authenticated` on table *T* | `GRANT <privilege> ON TABLE public.T TO anon;` — **one statement per privilege per role per table**, using the captured grant matrix | Capture §4.1 |
| `REVOKE` sequence privileges from `anon`/`authenticated` | `GRANT USAGE, SELECT, UPDATE ON SEQUENCE <captured name> TO <role>;` | Capture §4.1 |
| `REVOKE CREATE ON SCHEMA public` | `GRANT CREATE ON SCHEMA public TO <role>;` | Capture §4.1 |
| `REVOKE TRUNCATE/REFERENCES/TRIGGER` from `service_role` | `GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLE public.T TO service_role;` | Capture §4.1 |
| `GRANT` (re-stated) `service_role` privileges | **no action needed** — the migration only *adds* grants that were already implied by the platform default; nothing is removed | n/a |
| `GRANT EXECUTE` on the trigger function to `service_role` | `REVOKE EXECUTE ON FUNCTION public.update_modified_column() FROM service_role;` — only if the capture shows the role did **not** previously hold it | Capture §4.1 |
| `ALTER FUNCTION … SET search_path = pg_catalog, public` | `ALTER FUNCTION public.update_modified_column() RESET search_path;` — restores the exact captured `proconfig` (which is `NULL` today) | Capture §4.1 |
| The opt-in blocks (P1/P2/P3) | Each carries its own explicit reverse statement, gated by the same setting | — |

**No `GRANT ALL` and no `REVOKE ALL` appears anywhere in the rollback script.** Every statement names the object and the privilege.

### 4.3 Rollback limitations

1. **Restoring privileges does not restore data.** Nothing in this phase deletes data, so a rollback of *this* phase is complete with respect to data — but that is a property of *this* phase, not of the rollback script. If a destructive statement ran against the database between the capture and the rollback, only a backup can recover it, and **no verified backup exists** (`PRODUCTION_DATA_FLOW…` §5.2).
2. **The rollback restores the privilege state, not the security posture.** Restoring the `anon`/`authenticated` grants re-opens the exposure that this phase exists to close. A rollback is a recovery action, not a remediation.
3. **A rollback performed after the application has run is not equivalent to the pre-migration state.** Rows written, mirrors updated and objects stored during the interval are not reverted.
4. **`ALTER FUNCTION … RESET search_path` restores the *configuration*, not the function body.** The body is never changed by this phase, so this is not a live risk — but the capture stores `pg_get_functiondef` precisely so that an operator can verify the body is unchanged, and reconstruct it if it ever is.
5. **Rollback is not complete until every change has a recovery step.** The check table in §4.2 is exactly that mapping. Any change without a row in that table is not allowed to leave the review.

---

## 5. Section E — Verification and regression tests

**Artifact:** `docs/sql/phase2b_supabase_least_privilege.verify.sql` — **review artifact only. It was not executed.**

### 5.1 What the verify script checks

| # | Check | Method |
|---|---|---|
| V1 | RLS is enabled on all 15 intended tables, and `relforcerowsecurity` is `false` (not forced) | `pg_class` |
| V2 | The 12 policy-less tables still have **no** policy (deny-by-default preserved — no permissive policy was added to silence the advisor) | `pg_policies` |
| V3 | The 3 tables that do have policies are listed with their full definitions, roles and qualifiers, for review | `pg_policies` |
| V4 | `anon` and `authenticated` hold **no** privilege on any of the 15 tables | `has_table_privilege` for each of the 7 privileges |
| V5 | `anon` and `authenticated` hold no privilege on the sequences of those tables | `has_sequence_privilege` |
| V6 | `anon`/`authenticated` do not hold `CREATE` on schema `public` | `has_schema_privilege` |
| V7 | `service_role` holds exactly the required privileges on the 4 PostgREST tables, and **no** `TRUNCATE`/`REFERENCES`/`TRIGGER` on any table | `has_table_privilege` |
| V8 | `service_role` has `BYPASSRLS` | `pg_roles.rolbypassrls` |
| V9 | `public.update_modified_column()` has a `search_path` setting of `pg_catalog, public`, `prosecdef = false`, owner `postgres`, and an **unchanged body** (hash compared against the capture) | `pg_proc` |
| V10 | All **7** trigger dependencies still exist and still point at that function | `pg_trigger` |
| V11 | The live probe: `SET LOCAL ROLE anon` cannot read `public.users`; `SET LOCAL ROLE authenticated` cannot read `public.documents` — each expected to fail with `permission denied for table` | error-trapping `DO` block, rolled back |
| V12 | The production database contains **no unintended changes**: identical table list, identical row counts, identical checksums, identical trigger set, identical function body | catalogue fingerprint diff against the pre-migration capture |
| V13 | Storage: the `documents` bucket is still private; no Storage policy grants `anon`/`authenticated` (report-only — the live policies are unconfirmed) | `storage.buckets`, `pg_policies` on `storage.objects` |
| V14 | Role membership graph unchanged | `pg_auth_members` diff against the capture |

### 5.2 Application regression tests (to be run after the migration)

These are **not** automated by the SQL artifact; they are the acceptance gate for the change.

**R1 — Backend read/write per table (direct PostgreSQL path).** For each of `documents`, `reminders`, `profiles`, `exports`, `users`, `subscriptions`, `device_tokens`: create → read → update → delete a row as the production connection role, and assert the exact HTTP status and response body of the corresponding route. Include `device_tokens`, which the code never touches today, to prove the revocation did not remove a capability the product needs. (The product's `device_tokens` behaviour is "no capability" — the test asserts the *route* still answers, not that a row is written.)

**R2 — PostgREST mirror path.** Create a document via `POST /documents`; assert the row is visible through the service-role PostgREST read; assert a `verify` (partial-payload path) does **not** null `expiry_date`/`s3_key`; assert a reminder mirror write lands; assert a profile mirror write lands; assert `POST /api/export/export` writes an `exports` row. This is the highest-value regression because the mirror's failures are silent.

**R3 — Realtime.** Confirm the server still opens its three `postgres_changes` channels at boot and that a `documents` write still produces a server-side event. The client consumes nothing, so the assertion is server-side.

**R4 — Storage.** Signed upload URL still mints; a client `PUT` to that URL succeeds; a signed download URL still resolves; the signed download URL **expires** at 15 minutes (assert a 400/403 after expiry); the `DELETE /documents/storage` path still removes an object; an object belonging to another user is not readable through another user's signed URL (ownership check).

**R5 — Authentication.** Register → verify email → login → password reset → 2FA enrol → 2FA verify → 2FA login gate; session listing and termination. Note that the *server-side* `login_sessions` table is never inserted into (`PRODUCTION_DATA_FLOW…` P1-5), so the session-list test asserts today's (empty) behaviour is unchanged, not that it works.

**R6 — Document lifecycle.** OCR draft creation → `POST /documents/process` → edit (`PUT`) with the revision guard → 409 path on a stale revision → delete → storage cleanup. Assert the `updated_at` trigger still fires on every update (this is the direct behavioural test of the `search_path` change: a broken `search_path` would not break the trigger, but a *wrong* `search_path` could resolve `NOW()` differently — the assertion is that `updated_at` still advances and still matches the server's canonical revision format).

**R7 — Client-role denial, from outside.** With the anon key only, issue `GET {SUPABASE_URL}/rest/v1/users?select=id&limit=1` and the same for `documents`. Expected after remediation: **401/403, or 200 with zero rows and a permission error — never rows.** A 200 with rows is a failed migration.

**R8 — No-intended-change confirmation.** Run the verify script's fingerprint section and diff it against the pre-migration capture. Any difference outside the privilege matrix, the function `proconfig` and the `service_role` grant list is an unexplained change and blocks the change.

**R9 — Security Advisor re-run.** The 12 `rls_enabled_no_policy` findings will **still be reported** after the migration, and that is the expected outcome — they describe a deny-by-default posture that the product intends. The correct action is to dismiss them with the written justification in §5.3, **not** to add a policy. The `function_search_path_mutable` finding should clear.

### 5.3 Security Advisor dismissal text (for the 12 `rls_enabled_no_policy` findings)

> **Accepted by design — deny-by-default.** DocuGuard has no client-role database access. The mobile client never imports `supabase-js`, never receives a Supabase URL or key, and reaches the database only through the Express API (`services/api.ts`, `app/`, `hooks/`). The backend reaches PostgreSQL exclusively with a privileged direct connection and with the service-role key (`DocuGuard-Server/config/db.js`, `DocuGuard-Server/config/supabase.js:4-7`); there is no `anon` or `authenticated` code path, and Supabase Auth is not integrated. As of the Phase 2B remediation, `anon` and `authenticated` hold **no** table, sequence or schema privilege, so no policy on these tables is reachable by any client. The tables are deliberately left policy-less: RLS with no policy is deny-by-default, which is the intended posture. A permissive policy would be added only when a specific, reviewed client capability requires it.

---

## 6. Section F — Reconciling schema drift

### 6.1 The rule

The repository must end up describing the **intended** posture, and must not be capable of describing the **current** posture in a way that can be applied to production. The canonical schema becomes the *desired state*; migrations become the *reviewed path* from a known state to the desired state. Neither is auto-applied to production.

### 6.2 Conflicts and the order in which to resolve them

| Order | Conflict | Repository change | Production impact |
|---|---|---|---|
| 1 | **`supabase-schema.sql:374-388` disables RLS** (D1) | Replace the 15 `DISABLE ROW LEVEL SECURITY` statements with `ENABLE ROW LEVEL SECURITY` and add the explicit `REVOKE` baseline for `anon`/`authenticated`. **This is the highest-priority change in the repository**, because today the canonical file is a loaded gun: running it against production re-disables RLS. | None — the live state already has RLS enabled; the file is brought into line with production. |
| 2 | **No grants anywhere in the repository** (D4) | Add the explicit privilege baseline (Phase 2B §2.1–2.3) to the canonical schema as `REVOKE`s that are safe to re-run. | None. |
| 3 | **Trigger function has no `search_path`** (D2) | Change the function definition in `supabase-schema.sql` to include `SET search_path = pg_catalog, public`, and add the matching `ALTER FUNCTION … SET search_path` to the migration path. | Matches the Phase 2B change; idempotent. |
| 4 | **`.env.example:56` says "Set bucket to PUBLIC"** (D8) | Correct it to state the bucket must be **private** and must match `supabase-schema.sql:411-413`. | None. |
| 5 | **`run-migration.js` has no target assertion and a weaker TLS posture** (D10) | Require an explicit `--apply` flag, print the resolved host/database/user before connecting, refuse to run against a host outside an allow-list, and use `sslmode=require` semantics. | None. |
| 6 | **Two definitions of `user_settings` / `login_sessions`** (D6) | Fold `001_add_settings_tables.sql` into the canonical schema and **delete** the ad-hoc file, so `supabase-schema.sql` is the single source of truth — which is what `docs/schema_note.md:1-4` already insists on. Also fold in the `users.theme_mode`/`font_size`/`reduced_motion`/`analytics_enabled`/`crash_reports_enabled`/`data_sharing_enabled` columns (D7). | The live column state is unconfirmed; the migration must be written to be additive and idempotent (`ADD COLUMN IF NOT EXISTS`) and must **not** attempt to change a column's type. |
| 7 | **`users.role` is selected by code but absent from the schema** (D5) | Decide: either add `role TEXT` to the canonical schema, or change `authController.js:285-295` to `RETURNING id, email, name`. **This is an application change and is out of scope for Phase 2B.** Record it as a blocker. | None in this phase. |
| 8 | **Bucket limits** (D9) | Add `file_size_limit` and `allowed_mime_types` to the bucket insert, matching `storageService.js:20-29`. | Additive; `INSERT … ON CONFLICT DO UPDATE` is idempotent. |
| 9 | **Dead tables** `device_tokens`, `email_verifications`, `subscription_payments` (D13) | Decide: implement or drop. If dropped, their revocation is a no-op; if kept, the application role gets no privilege on them and the Phase 2B revocation already covers them. **Do not drop them in this phase** — a drop is destructive and they hold a plaintext push token. | None. |
| 10 | **`docs/sql/` is not a tracked migration path** | Introduce `DocuGuard-Server/migrations/` as the reviewed migration path, numbered and idempotent, with the Phase 2B artifact promoted into it only after approval. Add a CI check that fails if any file contains `DISABLE ROW LEVEL SECURITY`. | None. |

### 6.3 The "do not auto-apply" rule

The repository's migration path must **not** be wired to anything that touches production. Concretely:

* Migrations are applied by a human, from the Supabase SQL editor, against a named project, with the pre-flight output attached to the change ticket — not by a CI job, not by `run-migration.js`, and not by a deploy hook.
* `render.yaml` must not gain a `preDeployCommand` that runs SQL.
* The `supabase_realtime` publication block (`supabase-schema.sql:393-408`) already demonstrates the right pattern for a non-fatal, environment-dependent statement: it catches `undefined_object` and raises a notice rather than failing. The Phase 2B script's precondition block follows the same philosophy but inverts it — a failed precondition **aborts**, because here the assumptions are load-bearing.

---

## 7. Remaining blockers and production risks

| # | Blocker / risk | Severity | Owner action |
|---|---|---|---|
| B1 | **The deployed PostgreSQL connection username is unconfirmed.** | High | Read the username from the Render dashboard (never the value of the password) and confirm it matches `DB_USER=postgres`. Blocks §2.4. |
| B2 | **The live Storage policies are unconfirmed.** | High | Capture `pg_policies` for `storage.objects` / `storage.buckets` and the bucket's `public` flag. Blocks P3. |
| B3 | **The 3 tables with RLS policies are unidentified.** | High | Part A of the verify script prints them with their full definitions. Blocks P2. |
| B4 | **The live `service_role` grant state and `BYPASSRLS` attribute are unconfirmed.** | High | Part A prints them; Part B aborts if `BYPASSRLS` is false. |
| B5 | **The mirror swallows its own failures.** The single largest *silent* failure mode in this system: a privilege mistake surfaces as a stale mirror, not an error. | High | Treat R2 as a mandatory, manual gate; consider surfacing mirror failures in the API response as a separate change. |
| B6 | **The `documents` bucket has no `file_size_limit` / `allowed_mime_types`.** | Medium | Address in §6.2 order 8. |
| B7 | **No verified backup exists.** | High (pre-existing) | This phase changes only privileges, so it is low-risk *as a DDL change* — but there is no safety net if anything else goes wrong. `PRODUCTION_DATA_FLOW…` §5.2. |
| B8 | **The canonical schema can re-disable RLS.** | High | Fix §6.2 order 1 **before** anyone else touches the schema file. |
| B9 | **The app connects as the database owner.** | High | Phase 2C. Until then, RLS provides no protection against the application itself. |
| B10 | **The client-role grants are not monitored.** | Medium | Schedule the verify script as a recurring read-only check; the same principle as the grant check the audit already recommends. |
| B11 | **12 Security Advisor findings will persist by design.** | Low | Dismiss with the §5.3 justification; do **not** add policies. |
| B12 | **`users.role` drift** (D5/D7) and the broken `RETURNING id, email, role` statement. | Medium (pre-existing) | Out of scope; recorded as a blocker for the application, not the database. |

---

## 8. Test gate before approval

The change is **not** approvable until all of the following are true:

1. **Pre-flight captured.** Part A of the proposed script and the capture section of the rollback script have been run against production, and their full output is attached to the change ticket. The capture includes the catalogue fingerprint.
2. **Preconditions confirmed.** Every precondition P1–P9 in §3.2 has been evaluated and satisfied, or the change has been re-scoped.
3. **Staging rehearsal.** The proposed script has been executed against a **separate** Supabase project that mirrors the production schema and grant state, followed by the full rollback, followed by a second execution. Both must succeed.
4. **The application regression suite (§5.2) passes** against the rehearsed project: R1–R9, with R2 and R7 treated as hard gates.
5. **The `BYPASSRLS` precondition is satisfied** and the mirror is confirmed to still write after the change (R2).
6. **The change window is defined**: the migration runs inside a window in which the Render service can be restarted and re-verified, because a DDL change is not a deployment and the service must be re-proved afterwards.
7. **The rollback has been rehearsed** and its output is attached.
8. **A human has read all three SQL artifacts end to end.** All three are proposals; none has been executed by this phase.
9. **The security sign-off covers the 12 persistent Advisor findings** with the §5.3 justification, recorded as "accepted by design".

---

## 9. Appendix — evidence index

### 9.1 Connection and role facts

| Fact | Site |
|---|---|
| `DATABASE_URL` precedence | `DocuGuard-Server/config/db.js:4-9` |
| Pool construction, `max: 10` | `DocuGuard-Server/config/db.js:11-21` |
| Unreachable SSL branch | `DocuGuard-Server/config/db.js:14-16` |
| Service-role client | `DocuGuard-Server/config/supabase.js:4-7` |
| Anon client (constructed, never imported) | `DocuGuard-Server/config/supabase.js:10-13` |
| Anon key is a de-facto boot requirement | `DocuGuard-Server/config/env.js:10-14` (does not validate it); `DocuGuard-Server/tests/storageService.test.js:4-11` (workaround) |
| Realtime client uses the service-role key despite its name | `DocuGuard-Server/services/realtimeService.js:1,5,13` |
| Anon key declared in the deploy config | `DocuGuard-Server/render.yaml:36-37` |
| `DATABASE_URL` set manually in Render | `DocuGuard-Server/render.yaml:32-33` |
| Platform health check points at liveness | `DocuGuard-Server/render.yaml:12` |

### 9.2 Privilege-relevant call sites

| Surface | Site |
|---|---|
| PostgREST mirror upsert | `DocuGuard-Server/services/dataSyncService.js:178` |
| PostgREST mirror delete | `DocuGuard-Server/services/dataSyncService.js:284-288` |
| PostgREST profile upsert | `DocuGuard-Server/services/dataSyncService.js:304-313` |
| PostgREST export insert (needs the `exports` sequence) | `DocuGuard-Server/services/supabaseSync.js:28-30` |
| Dead PostgREST call | `DocuGuard-Server/services/supabaseSync.js:49-57` |
| Mirror failure swallowing | `DocuGuard-Server/services/dataSyncService.js:191-196` |
| Storage signed download (15 min) | `DocuGuard-Server/services/storageService.js:64-66` |
| Storage object removal | `DocuGuard-Server/services/storageService.js:107-109` |
| Storage signed upload (`upsert: false`) | `DocuGuard-Server/services/storageService.js:144-148` |
| Realtime channels | `DocuGuard-Server/services/realtimeService.js:79-95,97-113,115-131` |
| Realtime fan-out at boot | `DocuGuard-Server/services/realtimeService.js:185-202`; `DocuGuard-Server/app.js:136-138` |
| Mobile direct-to-Storage upload | `services/api.ts:223-252` |

### 9.3 Schema, trigger and drift sites

| Fact | Site |
|---|---|
| 15 tables defined | `supabase-schema.sql:7-222` |
| RLS disabled in the repository | `supabase-schema.sql:374-388` |
| Trigger function definition (no `search_path`) | `supabase-schema.sql:318-324` |
| 7 trigger bindings | `supabase-schema.sql:326-366` |
| Realtime publication block | `supabase-schema.sql:393-408` |
| Private bucket insert | `supabase-schema.sql:411-413` |
| Public-URL guidance in the env example | `DocuGuard-Server/.env.example:55-57` |
| Competing `user_settings` / `login_sessions` definitions | `DocuGuard-Server/migrations/001_add_settings_tables.sql:3-31` |
| `users` columns written by code but not in the schema | `DocuGuard-Server/migrations/001_add_settings_tables.sql:34-40` |
| `RETURNING id, email, role` on a column that does not exist | `DocuGuard-Server/controllers/authController.js:285-295` |
| Unguarded migration runner | `run-migration.js:1-37` |
| Single source of truth already asserted | `docs/schema_note.md:1-4` |

---

*End of Phase 2B plan. Three companion SQL artifacts accompany this document. None of the four was executed.*
