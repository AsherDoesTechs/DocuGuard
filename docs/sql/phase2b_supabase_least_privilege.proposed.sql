-- ============================================================================
-- DocuGuard — Phase 2B: Supabase least-privilege remediation (PROPOSED)
-- ============================================================================
--
-- STATUS:  REVIEW ARTIFACT.  THIS SCRIPT HAS NOT BEEN EXECUTED.
--          Nothing in this file was run against any database while it was
--          written.  It is a proposal for a human to review, rehearse against
--          a non-production project, and then run deliberately.
--
-- TARGET:  Supabase project reference  ysxeobillupncexfkfvu
--          PostgreSQL host             db.ysxeobillupncexfkfvu.supabase.co
--          Port                       5432
--          Database                   postgres
--          Expected executing role    postgres (the owner of public.*)
--
--          The script asserts current_database() = 'postgres' and the
--          presence of the Supabase-managed `auth` and `storage` schemas.
--          It CANNOT assert the Supabase project reference from SQL, because
--          the project reference is not exposed inside PostgreSQL.  The
--          operator MUST confirm the project reference in the Supabase
--          dashboard (or the SQL editor title) before running Part B.
--
-- WHY THIS EXISTS
--   Live state (owner-supplied production evidence, 2026-10-21):
--     * RLS is ENABLED on all 15 public tables.
--     * anon and authenticated each hold 7 privileges (DELETE, INSERT,
--       REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE) on EVERY table.
--     * The `documents` Storage bucket is private.
--     * public.update_modified_column() is owned by postgres, is NOT
--       SECURITY DEFINER, has no configured function settings, and is used
--       by triggers on 7 tables.
--     * Security Advisor reports 12 x `rls_enabled_no_policy` and
--       1 x `function_search_path_mutable`.
--
--   No code path in this repository uses the anon or authenticated role
--   (verified: DocuGuard-Server/config/supabase.js:10-13 constructs an anon
--   client that nothing imports; all four import sites of that module
--   destructure `supabaseAdmin`).  Every one of those 7 x 2 x 15 privileges
--   is therefore pure exposure, and removing them is the substantive fix.
--
--   The 12 `rls_enabled_no_policy` findings are DENY-BY-DEFAULT and are the
--   intended posture.  This script deliberately does NOT create any policy.
--   A permissive policy added to silence the advisor would be a regression.
--
-- WHAT THIS SCRIPT DOES
--   Part A  read-only inspection (safe to run at any time, changes nothing)
--   Part B  ONE atomic DO block: precondition assertions + the changes
--   Part C  read-only post-checks
--
-- WHY PART B IS A SINGLE DO BLOCK
--   A DO block is a single statement, therefore a single transaction.
--   If any precondition fails, RAISE EXCEPTION rolls back every change in
--   the block.  This is atomic in the Supabase SQL editor, in psql, and in
--   any other client, without depending on the client wrapping the script
--   in a transaction.  It also means an operator cannot run "half of it".
--
-- OPERATIONAL WARNINGS  (read before running Part B)
--   1. GRANT/REVOKE on a table takes an ACCESS EXCLUSIVE lock on that table
--      for the duration of the statement.  Because Part B is one
--      transaction, those locks are held until the block commits.  The
--      statements are individually very short, but a live service issuing
--      queries against these tables will queue behind them.  Run Part B in
--      a maintenance window, ideally with the Render service drained.
--   2. This script changes only privileges and one function setting.  It
--      deletes no rows, changes no ownership, enables/disables no RLS, and
--      creates no policy.
--   3. Transactional DDL does not protect against every operational failure.
--      A rollback of this script restores PERMISSIONS.  It never restores
--      DATA deleted by a destructive operation, and this product has no
--      verified backup and no restore path
--      (docs/PRODUCTION_DATA_FLOW_AND_RECOVERY_AUDIT.md section 5, P0-2).
--   4. The mirror write path swallows its own failures
--      (DocuGuard-Server/services/dataSyncService.js:191-196).  A privilege
--      mistake introduced here surfaces as a SILENTLY STALE MIRROR, not as
--      an error.  Run the R2 regression check after the change.
--
-- ORDER OF OPERATIONS
--   1. Run Part A.  Attach the FULL output to the change ticket.
--   2. Run the capture section of
--      docs/sql/phase2b_supabase_least_privilege.rollback.proposed.sql
--      and archive its output.  The rollback depends on it.
--   3. Rehearse Parts A+B+C in a separate Supabase project that mirrors the
--      production schema and grant state.  Rehearse the rollback too.
--   4. Rehearse the application regression suite in section 5.2 of
--      docs/PHASE2B_SUPABASE_REMEDIATION_PLAN.md.
--   5. Only then: run Part B in the production project, inside a window in
--      which the Render service can be restarted and re-verified.
--   6. Run docs/sql/phase2b_supabase_least_privilege.verify.sql and the
--      application regression suite.
--
-- ============================================================================


-- ============================================================================
-- PART A — READ-ONLY INSPECTION (changes nothing; safe to run repeatedly)
-- ============================================================================

\echo '=== A.1  Connection identity — confirm this is the expected project ==='
SELECT
  current_database()                       AS database,
  current_user                             AS current_user,
  session_user                             AS session_user,
  inet_server_addr()::text                 AS server_addr,
  inet_server_port()                       AS server_port,
  current_setting('server_version')        AS server_version,
  current_setting('TimeZone')              AS timezone,
  (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS current_user_is_superuser;

\echo '=== A.2  Role attributes — BYPASSRLS is the critical column ==='
SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb,
       rolbypassrls, rolcanlogin, rolconnlimit
FROM pg_roles
WHERE rolname IN ('anon','authenticated','service_role','postgres','supabase_admin','authenticator')
ORDER BY rolname;

\echo '=== A.3  Role memberships — an edge here is equivalent to the credential ==='
SELECT
  m.rolid::regrole::text AS member,
  g.rolid::regrole::text AS member_of,
  m.admin_option,
  m.grantor::regrole::text AS granted_by
FROM pg_auth_members m
JOIN pg_roles g ON g.oid = m.roleid
JOIN pg_roles h ON h.oid = m.member
ORDER BY 1, 2;

\echo '=== A.4  Effective table privileges held by anon / authenticated / service_role ==='
SELECT
  c.relname AS table_name,
  r.role,
  has_table_privilege(r.role, c.oid, 'SELECT')    AS sel,
  has_table_privilege(r.role, c.oid, 'INSERT')    AS ins,
  has_table_privilege(r.role, c.oid, 'UPDATE')    AS upd,
  has_table_privilege(r.role, c.oid, 'DELETE')    AS del,
  has_table_privilege(r.role, c.oid, 'TRUNCATE')  AS trunc,
  has_table_privilege(r.role, c.oid, 'REFERENCES') AS refs,
  has_table_privilege(r.role, c.oid, 'TRIGGER')    AS trg
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN (VALUES ('anon'),('authenticated'),('service_role')) AS r(role)
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY c.relname, r.role;

\echo '=== A.5  Raw ACL for every public table (the capture source for the rollback) ==='
SELECT
  c.relname AS table_name,
  n.nspname AS schema_name,
  pg_get_userbyid(c.relowner) AS owner,
  c.relacl::text[] AS acl
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY c.relname;

\echo '=== A.6  Schema-level grants on public ==='
SELECT nspname, pg_get_userbyid(nspowner) AS owner, nspacl::text[] AS acl
FROM pg_namespace
WHERE nspname IN ('public','storage','auth')
ORDER BY nspname;

SELECT grantee, has_schema_privilege(grantee, 'public', 'USAGE')  AS usage_pub,
       has_schema_privilege(grantee, 'public', 'CREATE') AS create_pub
FROM (VALUES ('anon'),('authenticated'),('service_role'),('postgres')) AS g(grantee);

\echo '=== A.7  Function privileges in schema public ==='
SELECT p.oid::regprocedure::text AS function,
       pg_get_userbyid(p.proowner) AS owner,
       p.prosecdef AS security_definer,
       COALESCE(p.proconfig::text, '(none)') AS proconfig,
       has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_exec,
       has_function_privilege('service_role', p.oid, 'EXECUTE')  AS service_role_exec
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
ORDER BY 1;

\echo '=== A.8  RLS status per public table ==='
SELECT c.relname AS table_name,
       pg_get_userbyid(c.relowner) AS owner,
       c.relrowsecurity   AS rls_enabled,
       c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY c.relname;

\echo '=== A.9  Full RLS policy inventory (the 3 tables that DO have policies) ==='
SELECT schemaname, tablename, policyname, permissive, roles::text[], cmd,
       COALESCE(qual, '(none)') AS using_expr,
       COALESCE(with_check, '(none)') AS check_expr
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

\echo '=== A.10  Trigger inventory for public.update_modified_column() ==='
SELECT c.relname AS table_name, t.tgname AS trigger_name, t.tgenabled,
       p.oid::regprocedure::text AS function
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE n.nspname = 'public'
  AND NOT t.tgisinternal
  AND p.oid = to_regprocedure('public.update_modified_column()')
ORDER BY c.relname;

\echo '=== A.11  The trigger function definition and its configuration ==='
SELECT pg_get_userbyid(p.proowner) AS owner,
       p.prosecdef AS security_definer,
       p.provolatile AS volatility,
       COALESCE(p.proconfig::text, '(none — no configured function settings)') AS proconfig,
       p.prosrc AS body
FROM pg_proc p
WHERE p.oid = to_regprocedure('public.update_modified_column()');

\echo '=== A.12  Sequences owned by the public tables, and their grants ==='
SELECT s.relname AS sequence_name, t.relname AS owned_by_table,
       s.relacl::text[] AS acl,
       has_sequence_privilege('anon', s.oid, 'USAGE')         AS anon_usage,
       has_sequence_privilege('authenticated', s.oid, 'USAGE') AS authenticated_usage,
       has_sequence_privilege('service_role', s.oid, 'USAGE')  AS service_role_usage
FROM pg_class s
JOIN pg_namespace sn ON sn.oid = s.relnamespace
JOIN pg_depend d ON d.classid = 'pg_class'::regclass
                 AND d.objid = s.oid
                 AND d.refclassid = 'pg_class'::regclass
                 AND d.deptype = 'a'
JOIN pg_class t ON t.oid = d.refobjid
JOIN pg_namespace tn ON tn.oid = t.relnamespace
WHERE s.relkind = 'S' AND sn.nspname = 'public' AND tn.nspname = 'public'
ORDER BY t.relname, s.relname;

\echo '=== A.13  Storage bucket state and Storage policies ==='
SELECT id, name, public, file_size_limit, allowed_mime_types
FROM storage.buckets
ORDER BY id;

SELECT schemaname, tablename, policyname, permissive, roles::text[], cmd,
       COALESCE(qual, '(none)') AS using_expr
FROM pg_policies
WHERE schemaname = 'storage'
ORDER BY tablename, policyname;

\echo '=== A.14  Catalogue fingerprint — capture this BEFORE Part B and compare after ==='
SELECT md5(string_agg(fingerprint, '|' ORDER BY fingerprint)) AS catalog_fingerprint
FROM (
  SELECT 'table:' || c.relname AS fingerprint
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
  UNION ALL
  SELECT 'policy:' || schemaname || '.' || tablename || '.' || policyname || ':' || cmd || ':' || roles::text
  FROM pg_policies
  UNION ALL
  SELECT 'trigger:' || n.nspname || '.' || c.relname || '.' || t.tgname || ':' || p.proname
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_proc p ON p.oid = t.tgfoid
  WHERE NOT t.tgisinternal
  UNION ALL
  SELECT 'func:' || p.proname || ':' || md5(p.prosrc) || ':' || COALESCE(p.proconfig::text, 'NULL')
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
) s;

\echo '=== A.15  Row counts per public table (for the no-unintended-change check) ==='
DO $$
DECLARE
  t text;
  c bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users','password_resets','documents','reminders','device_tokens',
    'subscriptions','activity_logs','subscription_payments','transactions',
    'support_tickets','exports','user_settings','login_sessions',
    'email_verifications','profiles'
  ] LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO c;
    RAISE NOTICE '% : % rows', rpad(t, 24), c;
  END LOOP;
END $$;


-- ============================================================================
-- PART B — THE PROPOSED CHANGE  (single atomic statement; aborts on any
--           unsatisfied precondition)
--
--   The operator MUST have read the Part A output and recorded it in the
--   change ticket before running this part.
-- ============================================================================

DO $phase2b$
DECLARE
  -- The 15 public tables this plan covers. Enumerated explicitly: this
  -- script never uses "ALL TABLES IN SCHEMA".
  v_target_tables  constant text[] := ARRAY[
    'users','password_resets','documents','reminders','device_tokens',
    'subscriptions','activity_logs','subscription_payments','transactions',
    'support_tickets','exports','user_settings','login_sessions',
    'email_verifications','profiles'
  ];

  -- The two internet-reachable client roles. No code path uses either.
  v_client_roles   constant text[] := ARRAY['anon','authenticated'];

  -- The only four tables the service-role PostgREST path touches.
  v_postgrest_tables constant text[] := ARRAY['documents','reminders','profiles','exports'];

  -- The 7 tables whose triggers call public.update_modified_column().
  v_expected_trigger_tables constant text[] := ARRAY[
    'device_tokens','documents','profiles','reminders','subscriptions',
    'user_settings','users'
  ];

  t            text;
  r            text;
  v_seq        record;
  v_missing    text;
  v_trig_list  text;
  v_policy_list text;
  v_owner      text;
  v_conf       text;
  v_narrow     text;
BEGIN
  ------------------------------------------------------------------
  -- P1.  Correct database.
  ------------------------------------------------------------------
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION
      'ABORT (P1): expected database "postgres", current database is "%". Nothing was changed.',
      current_database();
  END IF;

  ------------------------------------------------------------------
  -- P2.  This is a Supabase-managed project.
  ------------------------------------------------------------------
  IF to_regnamespace('storage') IS NULL OR to_regnamespace('auth') IS NULL THEN
    RAISE EXCEPTION
      'ABORT (P2): the "storage" and/or "auth" schemas are missing. This does not look like a '
      'Supabase project. Nothing was changed.';
  END IF;

  ------------------------------------------------------------------
  -- P3.  All 15 target tables exist.
  ------------------------------------------------------------------
  SELECT string_agg(x, ', ' ORDER BY x)
    INTO v_missing
  FROM unnest(v_target_tables) AS u(x)
  WHERE to_regclass(format('public.%I', x)) IS NULL;

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'ABORT (P3): these expected public tables are missing: %. The live schema has drifted '
      'from the plan. MANUAL REVIEW REQUIRED. Nothing was changed.', v_missing;
  END IF;

  ------------------------------------------------------------------
  -- P4.  RLS is ENABLED on all 15 tables.
  --      This script NEVER enables or disables RLS.  If RLS is not
  --      enabled, the live state is not what this plan assumes and the
  --      correct next step is a human decision, not a DDL guess.
  ------------------------------------------------------------------
  SELECT string_agg(c.relname::text, ', ' ORDER BY c.relname::text)
    INTO v_missing
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relname::text = ANY(v_target_tables)
    AND NOT c.relrowsecurity;

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'ABORT (P4): RLS is NOT enabled on: %. This plan assumes RLS is enabled everywhere and '
      'does not change that setting. MANUAL REVIEW REQUIRED. Nothing was changed.', v_missing;
  END IF;

  ------------------------------------------------------------------
  -- P5.  service_role exists and has BYPASSRLS.
  --      With RLS enabled and no policy on 12 tables, a service_role
  --      without BYPASSRLS would be denied every mirror write — and the
  --      mirror swallows its failures, so the breakage would be silent.
  ------------------------------------------------------------------
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    RAISE EXCEPTION
      'ABORT (P5): the service_role role does not exist. Wrong project. Nothing was changed.';
  END IF;

  IF NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname = 'service_role') THEN
    RAISE EXCEPTION
      'ABORT (P5): service_role does NOT have BYPASSRLS. The PostgREST mirror path (documents, '
      'reminders, profiles, exports) would be denied by the live RLS configuration, and the '
      'mirror swallows its errors, so the failure would be silent. MANUAL REVIEW REQUIRED. '
      'Nothing was changed.';
  END IF;

  ------------------------------------------------------------------
  -- P6.  anon and authenticated exist.
  ------------------------------------------------------------------
  SELECT string_agg(x, ', ' ORDER BY x)
    INTO v_missing
  FROM unnest(v_client_roles) AS u(x)
  WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = x);

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'ABORT (P6): these platform roles are missing: %. Wrong project. Nothing was changed.',
      v_missing;
  END IF;

  ------------------------------------------------------------------
  -- P7.  The trigger function is in the exact state the plan assumes.
  ------------------------------------------------------------------
  IF to_regprocedure('public.update_modified_column()') IS NULL THEN
    RAISE EXCEPTION
      'ABORT (P7): public.update_modified_column() does not exist. Nothing was changed.';
  END IF;

  SELECT pg_get_userbyid(proowner) INTO v_owner
  FROM pg_proc WHERE oid = to_regprocedure('public.update_modified_column()');

  IF v_owner <> 'postgres' THEN
    RAISE EXCEPTION
      'ABORT (P7): public.update_modified_column() is owned by "%", not "postgres". Ownership is '
      'NOT changed by this script. MANUAL REVIEW REQUIRED. Nothing was changed.', v_owner;
  END IF;

  IF (SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure('public.update_modified_column()')) THEN
    RAISE EXCEPTION
      'ABORT (P7): public.update_modified_column() is SECURITY DEFINER, but the plan assumed '
      'SECURITY DEFINER = false. The hardening step and the risk assessment both change. '
      'MANUAL REVIEW REQUIRED. Nothing was changed.';
  END IF;

  IF (SELECT proconfig FROM pg_proc WHERE oid = to_regprocedure('public.update_modified_column()'))
     IS NOT NULL THEN
    RAISE EXCEPTION
      'ABORT (P7): public.update_modified_column() already has configured function settings (%. '
      'This script would overwrite them, so it refuses to. MANUAL REVIEW REQUIRED. Nothing was '
      'changed.',
      (SELECT proconfig::text FROM pg_proc
        WHERE oid = to_regprocedure('public.update_modified_column()'));
  END IF;

  ------------------------------------------------------------------
  -- P8.  The trigger dependency set is exactly the expected 7 tables.
  --      A different set means a different function and a different
  --      hardening assessment.
  ------------------------------------------------------------------
  SELECT string_agg(DISTINCT c.relname::text, ', ' ORDER BY c.relname::text)
    INTO v_trig_list
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND NOT t.tgisinternal
    AND t.tgfoid = to_regprocedure('public.update_modified_column()');

  IF v_trig_list IS DISTINCT FROM (
        SELECT string_agg(x, ', ' ORDER BY x) FROM unnest(v_expected_trigger_tables) AS u(x)) THEN
    RAISE EXCEPTION
      'ABORT (P8): the trigger dependencies of public.update_modified_column() are [%] but the plan '
      'expected [device_tokens, documents, profiles, reminders, subscriptions, user_settings, users]. '
      'MANUAL REVIEW REQUIRED. Nothing was changed.', v_trig_list;
  END IF;

  ------------------------------------------------------------------
  -- P9.  The executing role can alter the function it owns.
  ------------------------------------------------------------------
  IF NOT (current_user = 'postgres' OR (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)) THEN
    RAISE EXCEPTION
      'ABORT (P9): this script must run as "postgres" (or a superuser) because it alters a '
      'function owned by postgres. Current role is "%". Nothing was changed.', current_user;
  END IF;

  ------------------------------------------------------------------
  -- P10. Informational: list the tables that carry RLS policies.
  --      These are NOT modified by this script.  The operator must
  --      record them in the change ticket (plan precondition P9).
  ------------------------------------------------------------------
  SELECT string_agg(DISTINCT tablename, ', ' ORDER BY tablename)
    INTO v_policy_list
  FROM pg_policies
  WHERE schemaname = 'public';

  RAISE NOTICE 'P10: public tables that carry RLS policies (NOT changed by this script): %',
                 COALESCE(v_policy_list, '(none)');

  ------------------------------------------------------------------
  -- P11. Informational: list the tables that carry no policy.
  --      These are the deny-by-default tables behind the 12
  --      `rls_enabled_no_policy` Security Advisor findings.  This
  --      script does NOT create a policy for any of them.
  ------------------------------------------------------------------
  RAISE NOTICE 'P11: public tables with RLS enabled and NO policy (deny-by-default, kept as-is): %',
    (SELECT string_agg(c.relname, ', ' ORDER BY c.relname)
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND c.relrowsecurity
        AND c.relname::text = ANY(v_target_tables)
        AND NOT EXISTS (SELECT 1 FROM pg_policies p
                         WHERE p.schemaname = 'public' AND p.tablename = c.relname));

  ------------------------------------------------------------------
  -- ===== CHANGES BEGIN =====
  ------------------------------------------------------------------

  ------------------------------------------------------------------
  -- C1.  Revoke the seven client-role table privileges.
  --      Every statement names one table and one role explicitly, and
  --      lists the seven privileges by name.  No GRANT ALL, no
  --      REVOKE ALL, no "ALL TABLES IN SCHEMA".
  --
  --      Why each privilege is removed:
  --        SELECT    - would expose users.password_hash, users.two_factor_secret,
  --                    users.verification_token, documents.ocr_data, exports.data
  --        INSERT    - would allow forging rows, bypassing every application check
  --        UPDATE    - would allow mutating another user's records
  --        DELETE    - would allow destroying another user's records
  --        TRUNCATE  - would allow destroying a whole table in one statement
  --        REFERENCES- only meaningful for creating foreign keys; unused at runtime
  --        TRIGGER   - only meaningful for creating triggers; unused at runtime
  --
  --      No code path in this repository uses the anon or authenticated
  --      role, so this removes no capability the product uses.
  ------------------------------------------------------------------
  FOREACH t IN ARRAY v_target_tables LOOP
    FOREACH r IN ARRAY v_client_roles LOOP
      EXECUTE format(
        'REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER '
        'ON TABLE public.%I FROM %I', t, r);
    END LOOP;
  END LOOP;
  RAISE NOTICE 'C1: revoked 7 table privileges from anon and authenticated on % tables',
               array_length(v_target_tables, 1);

  ------------------------------------------------------------------
  -- C2.  Revoke sequence privileges from the client roles.
  --      Sequences are discovered from the catalogue (pg_depend), not
  --      guessed by name, so a rename in the live database cannot make
  --      this statement miss its target.
  --
  --      A sequence privilege lets a role burn sequence values, which
  --      is a denial-of-service against the primary keys, and it lets a
  --      role read the current value to infer row counts.
  ------------------------------------------------------------------
  FOR v_seq IN
    SELECT s.relname AS seq_name, t.relname AS tbl_name
    FROM pg_class s
    JOIN pg_namespace sn ON sn.oid = s.relnamespace
    JOIN pg_depend d ON d.classid = 'pg_class'::regclass
                     AND d.objid = s.oid
                     AND d.refclassid = 'pg_class'::regclass
                     AND d.deptype = 'a'
    JOIN pg_class t ON t.oid = d.refobjid
    JOIN pg_namespace tn ON tn.oid = t.relnamespace
    WHERE s.relkind = 'S'
      AND sn.nspname = 'public'
      AND tn.nspname = 'public'
      AND t.relname::text = ANY(v_target_tables)
  LOOP
    FOREACH r IN ARRAY v_client_roles LOOP
      EXECUTE format(
        'REVOKE USAGE, SELECT, UPDATE ON SEQUENCE public.%I FROM %I', v_seq.seq_name, r);
    END LOOP;
    RAISE NOTICE 'C2: revoked sequence privileges on public.% (owned by public.%)', v_seq.seq_name, v_seq.tbl_name;
  END LOOP;

  ------------------------------------------------------------------
  -- C3.  Revoke CREATE on schema public from the client roles, if held.
  --      A client role holding CREATE on a schema can create objects
  --      there, including a function that shadows one of ours.
  --      USAGE is deliberately NOT revoked: revoking it changes
  --      PostgREST's error surface from "permission denied for table"
  --      to "relation not found" and interacts with platform internals
  --      that cannot be verified from the repository.  That step is a
  --      separate, manually reviewed proposal (plan P5).
  ------------------------------------------------------------------
  FOREACH r IN ARRAY v_client_roles LOOP
    IF has_schema_privilege(r, 'public', 'CREATE') THEN
      EXECUTE format('REVOKE CREATE ON SCHEMA public FROM %I', r);
      RAISE NOTICE 'C3: revoked CREATE on schema public from %', r;
    ELSE
      RAISE NOTICE 'C3: % did not hold CREATE on schema public — nothing to do', r;
    END LOOP;
  END LOOP;

  ------------------------------------------------------------------
  -- C4.  Remove the three privileges no code path uses from
  --      service_role: TRUNCATE, REFERENCES, TRIGGER.
  --
  --      The service-role role keeps every DML privilege it needs; only
  --      these three are removed.  This is unconditional because no
  --      code path uses them, so no consumer can depend on them.
  --
  --      Note: revoking the table-level TRIGGER privilege does NOT
  --      stop triggers from firing.  TRIGGER governs CREATE TRIGGER.
  --      A firing trigger requires EXECUTE on the FUNCTION, which is
  --      preserved in C7.
  ------------------------------------------------------------------
  FOREACH t IN ARRAY v_target_tables LOOP
    EXECUTE format(
      'REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.%I FROM service_role', t);
  END LOOP;
  RAISE NOTICE 'C4: revoked TRUNCATE, REFERENCES, TRIGGER from service_role on % tables',
               array_length(v_target_tables, 1);

  ------------------------------------------------------------------
  -- C5.  State the service-role requirements positively.
  --
  --      These are the only four tables the PostgREST path touches:
  --        documents  - mirror upsert (INSERT/UPDATE), mirror delete (DELETE),
  --                     Realtime postgres_changes (SELECT)
  --        reminders  - mirror upsert (INSERT/UPDATE), mirror delete (DELETE),
  --                     Realtime postgres_changes (SELECT)
  --        profiles   - mirror upsert (INSERT/UPDATE),
  --                     Realtime postgres_changes (SELECT)
  --        exports    - export insert (INSERT).  The insert omits "id", so
  --                     the exports sequence is used — see C6.
  --
  --      These GRANTs are additive and therefore cannot remove a
  --      capability.  They make the required surface explicit instead
  --      of leaving it to a platform default.
  ------------------------------------------------------------------
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.documents TO service_role';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.reminders TO service_role';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE         ON TABLE public.profiles  TO service_role';
  EXECUTE 'GRANT INSERT                         ON TABLE public.exports   TO service_role';
  RAISE NOTICE 'C5: stated the required service_role privileges on documents, reminders, profiles, exports';

  ------------------------------------------------------------------
  -- C6.  Sequence access for service_role, only where it is needed.
  --      The exports insert omits "id", so the nextval default runs as
  --      service_role and needs USAGE on that sequence.
  ------------------------------------------------------------------
  FOR v_seq IN
    SELECT s.relname AS seq_name, t.relname AS tbl_name
    FROM pg_class s
    JOIN pg_namespace sn ON sn.oid = s.relnamespace
    JOIN pg_depend d ON d.classid = 'pg_class'::regclass
                     AND d.objid = s.oid
                     AND d.refclassid = 'pg_class'::regclass
                     AND d.deptype = 'a'
    JOIN pg_class t ON t.oid = d.refobjid
    JOIN pg_namespace tn ON tn.oid = t.relnamespace
    WHERE s.relkind = 'S'
      AND sn.nspname = 'public'
      AND tn.nspname = 'public'
      AND t.relname::text = ANY(v_postgrest_tables)
  LOOP
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE public.%I TO service_role', v_seq.seq_name);
    RAISE NOTICE 'C6: granted USAGE, SELECT on public.% (owned by public.%) to service_role',
                 v_seq.seq_name, v_seq.tbl_name;
  END LOOP;

  ------------------------------------------------------------------
  -- C7.  The function_search_path_mutable fix — a SEPARATE, narrowly
  --      scoped operation.
  --
  --      What this changes:
  --        * the function's own `search_path` configuration.
  --      What this does NOT change:
  --        * the function body (only NOW() and NEW.updated_at are used,
  --          both resolved from pg_catalog);
  --        * ownership (stays postgres);
  --        * SECURITY DEFINER (stays false);
  --        * any EXECUTE privilege.
  --
  --      Why it matters even though the function is not SECURITY DEFINER:
  --      a mutable search_path lets the name resolution inside the
  --      function be influenced by the caller's environment.  With
  --      SECURITY DEFINER = false the function runs with the caller's
  --      own rights, so this is a hardening measure rather than a
  --      privilege-escalation fix — the advisory is still correct to
  --      raise it, and the fix is behaviour-preserving.
  --
  --      The explicit EXECUTE grant for service_role documents the
  --      trigger dependency and survives a future
  --      "REVOKE EXECUTE ... FROM PUBLIC".
  ------------------------------------------------------------------
  EXECUTE 'ALTER FUNCTION public.update_modified_column() SET search_path = pg_catalog, public';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.update_modified_column() TO service_role';
  RAISE NOTICE 'C7: set search_path = pg_catalog, public on public.update_modified_column() '
               'and granted EXECUTE to service_role';

  ------------------------------------------------------------------
  -- ===== OPT-IN PROPOSALS (skipped unless explicitly enabled) =====
  -- These are documented in section 2.8 of the plan.  They are NOT
  -- executed by default because their preconditions could not be
  -- established from the repository and the supplied evidence.
  ------------------------------------------------------------------

  -- P1: narrow service_role to the four PostgREST tables.
  --     Enable with:  SET docuguard.apply_service_role_narrowing = 'CONFIRMED';
  --     The operator must first review the list of tables printed below.
  v_narrow := current_setting('docuguard.apply_service_role_narrowing', true);
  IF v_narrow IS NOT NULL AND v_narrow = 'CONFIRMED' THEN
    RAISE NOTICE 'P1: service_role narrowing ENABLED. The following public tables would lose all '
                 'table privileges from service_role: %',
      (SELECT string_agg(c.relname, ', ' ORDER BY c.relname)
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
          AND c.relname::text = ANY(v_target_tables)
          AND NOT (c.relname::text = ANY(v_postgrest_tables)));
    FOREACH t IN ARRAY v_target_tables LOOP
      IF NOT (t = ANY(v_postgrest_tables)) THEN
        EXECUTE format(
          'REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER '
          'ON TABLE public.%I FROM service_role', t);
      END IF;
    END LOOP;
    RAISE NOTICE 'P1: service_role narrowed to documents, reminders, profiles, exports';
  ELSE
    RAISE NOTICE 'P1: service_role narrowing SKIPPED (opt-in). Set '
                 'docuguard.apply_service_role_narrowing = ''CONFIRMED'' to enable it after review.';
  END IF;

  -- P2: drop any RLS policy that grants a client role.
  --     A policy written "TO public" also grants to anon and
  --     authenticated, so pg_policies.roles = {public} counts as a
  --     client-role grant and is included here.
  --     Enable with:  SET docuguard.apply_client_policy_drop = 'CONFIRMED';
  --     The operator must first review the policy list printed below.
  v_conf := current_setting('docuguard.apply_client_policy_drop', true);
  IF v_conf IS NOT NULL AND v_conf = 'CONFIRMED' THEN
    FOR v_seq IN
      SELECT p.schemaname, p.tablename, p.policyname
      FROM pg_policies p
      WHERE p.schemaname = 'public'
        AND (p.roles @> ARRAY['anon']::name[]
             OR p.roles @> ARRAY['authenticated']::name[]
             OR p.roles @> ARRAY['public']::name[])
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', v_seq.policyname, v_seq.tablename);
      RAISE NOTICE 'P2: dropped policy public.% on table public.%', v_seq.policyname, v_seq.tablename;
    END LOOP;
  ELSE
    RAISE NOTICE 'P2: client-role policy drop SKIPPED (opt-in). Policies that would be dropped: %',
      (SELECT COALESCE(string_agg(p.tablename || '.' || p.policyname, ', ' ORDER BY p.tablename, p.policyname), '(none)')
         FROM pg_policies p
        WHERE p.schemaname = 'public'
          AND (p.roles @> ARRAY['anon']::name[]
               OR p.roles @> ARRAY['authenticated']::name[]
               OR p.roles @> ARRAY['public']::name[]));
  END IF;

  RAISE NOTICE 'PHASE 2B PART B COMPLETE. No rows were touched, no ownership was changed, '
               'no RLS setting was changed, and no policy was created.';
END
$phase2b$;


-- ============================================================================
-- PART C — READ-ONLY POST-CHECKS (run immediately after Part B)
-- ============================================================================

\echo '=== C.1  anon / authenticated must now hold NOTHING on any public table ==='
SELECT
  c.relname AS table_name,
  r.role,
  has_table_privilege(r.role, c.oid, 'SELECT')    AS sel,
  has_table_privilege(r.role, c.oid, 'INSERT')    AS ins,
  has_table_privilege(r.role, c.oid, 'UPDATE')    AS upd,
  has_table_privilege(r.role, c.oid, 'DELETE')    AS del,
  has_table_privilege(r.role, c.oid, 'TRUNCATE')  AS trunc,
  has_table_privilege(r.role, c.oid, 'REFERENCES') AS refs,
  has_table_privilege(r.role, c.oid, 'TRIGGER')    AS trg
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN (VALUES ('anon'),('authenticated')) AS r(role)
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY c.relname, r.role;

\echo '=== C.2  service_role — required privileges present, unused ones gone ==='
SELECT
  c.relname AS table_name,
  has_table_privilege('service_role', c.oid, 'SELECT')    AS sel,
  has_table_privilege('service_role', c.oid, 'INSERT')    AS ins,
  has_table_privilege('service_role', c.oid, 'UPDATE')    AS upd,
  has_table_privilege('service_role', c.oid, 'DELETE')    AS del,
  has_table_privilege('service_role', c.oid, 'TRUNCATE')  AS trunc,
  has_table_privilege('service_role', c.oid, 'REFERENCES') AS refs,
  has_table_privilege('service_role', c.oid, 'TRIGGER')    AS trg
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY c.relname;

\echo '=== C.3  The trigger function, after hardening ==='
SELECT pg_get_userbyid(p.proowner) AS owner,
       p.prosecdef AS security_definer,
       COALESCE(p.proconfig::text, '(none)') AS proconfig
FROM pg_proc p
WHERE p.oid = to_regprocedure('public.update_modified_column()');

\echo '=== C.4  All 7 trigger dependencies must still be present ==='
SELECT c.relname AS table_name, t.tgname AS trigger_name, t.tgenabled
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND NOT t.tgisinternal
  AND t.tgfoid = to_regprocedure('public.update_modified_column()')
ORDER BY c.relname;

\echo '=== C.5  RLS must still be enabled everywhere, and no policy was added ==='
SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced,
       (SELECT count(*) FROM pg_policies p
         WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policy_count
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY c.relname;

\echo '=== C.6  Catalogue fingerprint — compare with the Part A capture ==='
SELECT md5(string_agg(fingerprint, '|' ORDER BY fingerprint)) AS catalog_fingerprint
FROM (
  SELECT 'table:' || c.relname AS fingerprint
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
  UNION ALL
  SELECT 'policy:' || schemaname || '.' || tablename || '.' || policyname || ':' || cmd || ':' || roles::text
  FROM pg_policies
  UNION ALL
  SELECT 'trigger:' || n.nspname || '.' || c.relname || '.' || t.tgname || ':' || p.proname
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_proc p ON p.oid = t.tgfoid
  WHERE NOT t.tgisinternal
  UNION ALL
  SELECT 'func:' || p.proname || ':' || md5(p.prosrc) || ':' || COALESCE(p.proconfig::text, 'NULL')
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
) s;

-- ============================================================================
-- End of the proposed migration.  NOT EXECUTED.
--
-- The full verification suite, including the live role probes and the
-- no-unintended-change checks, is in
--   docs/sql/phase2b_supabase_least_privilege.verify.sql
-- The rollback, and the capture that must precede this migration, is in
--   docs/sql/phase2b_supabase_least_privilege.rollback.proposed.sql
-- ============================================================================
