-- ============================================================================
-- DocuGuard — Phase 2B: Supabase least-privilege ROLLBACK (PROPOSED)
-- ============================================================================
--
-- STATUS:  REVIEW ARTIFACT.  THIS SCRIPT HAS NOT BEEN EXECUTED.
--          Nothing in this file was run against any database while it was
--          written.  It is a proposal for a human to review, rehearse against
--          a non-production project, and then run deliberately — and only if
--          the migration has been applied and has been judged harmful.
--
-- TARGET:  Supabase project reference  ysxeobillupncexfkfvu
--          Database                   postgres
--          Expected executing role    postgres (owner of public.*)
--
-- THIS FILE HAS TWO HALVES, AND THE ORDER MATTERS:
--
--   SECTION 1  CAPTURE  — read-only.  MUST be run BEFORE the proposed
--                           migration, and its output archived with the
--                           change ticket.  Without it the rollback cannot
--                           be specific.
--   SECTION 2  ROLLBACK — the mutating part.  Restores only what the
--                           migration changed, privilege by privilege.
--
-- RULES THIS SCRIPT OBLYS
--   * It NEVER uses GRANT ALL, REVOKE ALL, or "ALL TABLES IN SCHEMA".
--     Every statement names the schema, the object, the privilege and the
--     role.
--   * It restores only the privileges and settings that the Phase 2B
--     migration changed.  It grants nothing that the migration did not
--     remove.
--   * Where the original state cannot be established from the capture, the
--     script ABORTS and asks for a decision.  It does not guess.
--
-- LIMITATIONS — READ BEFORE USING THIS
--   1. RESTORING PRIVILEGES DOES NOT RESTORE DATA.  This migration deletes
--      no rows, so a rollback of THIS phase is complete with respect to
--      data.  That is a property of this phase, not of this script: if any
--      destructive statement ran against the database between the capture
--      and the rollback, only a backup can recover it — and this product
--      has no verified backup and no restore path
--      (docs/PRODUCTION_DATA_FLOW_AND_RECOVERY_AUDIT.md section 5, P0-2).
--   2. A rollback restores the PERMISSION STATE, not the SECURITY POSTURE.
--      Restoring the anon/authenticated grants re-opens the exposure this
--      phase exists to close.  A rollback is a recovery action.
--   3. A rollback performed after the application has run for any length of
--      time is not equivalent to the pre-migration state: rows written,
--      mirrors updated and objects stored in the interval are not reverted.
--   4. The trigger function's BODY is never changed by the migration.  The
--      rollback restores its CONFIGURATION (search_path).  The capture in
--      section 1 stores the body so an operator can prove it is unchanged.
--   5. ROLLBACK IS NOT COMPLETE UNTIL EVERY CHANGE HAS A RECOVERY STEP.
--      Section 3 is that mapping.  Any migration change without a row in
--      that table is a reason not to apply the migration.
--
-- ============================================================================


-- ============================================================================
-- SECTION 1 — CAPTURE (read-only).  RUN THIS BEFORE THE MIGRATION.
--
--   Archive the full output.  The rollback in section 2 is parameterised by
--   it, and section 2 refuses to run without the three decisions it needs.
-- ============================================================================

\echo '=== 1.1  Client-role table grants — the exact privilege set to restore ==='
-- The supplied production evidence states that anon and authenticated each
-- held DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE and UPDATE on
-- every table.  This query proves whether that is what the capture finds.
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

\echo '=== 1.2  Raw ACL text for every public table and sequence (authoritative copy) ==='
SELECT c.relname AS object_name, 'table' AS object_kind, c.relacl::text[] AS acl
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
UNION ALL
SELECT s.relname, 'sequence', s.relacl::text[]
FROM pg_class s
JOIN pg_namespace sn ON sn.oid = s.relnamespace
WHERE sn.nspname = 'public' AND s.relkind = 'S'
ORDER BY object_kind, object_name;

\echo '=== 1.3  Schema-level grants on public ==='
SELECT grantee, has_schema_privilege(grantee, 'public', 'USAGE')  AS usage_pub,
       has_schema_privilege(grantee, 'public', 'CREATE') AS create_pub
FROM (VALUES ('anon'),('authenticated'),('service_role'),('postgres')) AS g(grantee);

\echo '=== 1.4  service_role table privileges — decides what the rollback restores ==='
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

\echo '=== 1.5  Sequence privileges and their owners ==='
SELECT s.relname AS sequence_name, t.relname AS owned_by_table, s.relacl::text[] AS acl,
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

\echo '=== 1.6  The trigger function — definition, owner, configuration, privileges ==='
SELECT pg_get_userbyid(p.proowner) AS owner,
       p.prosecdef AS security_definer,
       COALESCE(p.proconfig::text, '(none)') AS proconfig,
       md5(p.prosrc) AS body_md5,
       p.prosrc AS body
FROM pg_proc p
WHERE p.oid = to_regprocedure('public.update_modified_column()');

SELECT grantee, privilege_type
FROM information_schema.routine_privileges
WHERE specific_schema = 'public'
  AND routine_name = 'update_modified_column'
ORDER BY grantee, privilege_type;

\echo '=== 1.7  RLS status, policies, and trigger inventory ==='
SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY c.relname;

-- Full policy definitions, so that any policy dropped by the opt-in block
-- can be recreated verbatim.  Record this output before the migration.
SELECT schemaname, tablename, policyname, permissive, roles::text[], cmd,
       COALESCE(qual, '(none)') AS using_expr,
       COALESCE(with_check, '(none)') AS check_expr
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

SELECT c.relname AS table_name, t.tgname AS trigger_name, t.tgenabled,
       p.oid::regprocedure::text AS function
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE n.nspname = 'public' AND NOT t.tgisinternal
ORDER BY c.relname, t.tgname;

\echo '=== 1.8  Role attributes and membership graph ==='
SELECT rolname, rolsuper, rolinherit, rolextended, rolcreaterole, rolcreatedb,
       rolbypassrls, rolcanlogin
FROM pg_roles
WHERE rolname IN ('anon','authenticated','service_role','postgres','supabase_admin','authenticator')
ORDER BY rolname;

SELECT m.rolid::regrole::text AS member, g.rolid::regrole::text AS member_of,
       m.admin_option, m.grantor::regrole::text AS granted_by
FROM pg_auth_members m
JOIN pg_roles g ON g.oid = m.roleid
ORDER BY 1, 2;

\echo '=== 1.9  Storage bucket and Storage policies ==='
SELECT id, name, public, file_size_limit, allowed_mime_types FROM storage.buckets ORDER BY id;

SELECT schemaname, tablename, policyname, permissive, roles::text[], cmd,
       COALESCE(qual, '(none)') AS using_expr
FROM pg_policies
WHERE schemaname = 'storage'
ORDER BY tablename, policyname;

\echo '=== 1.10  Catalogue fingerprint and row counts — the no-unintended-change baseline ==='
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
-- SECTION 2 — ROLLBACK
--
--   The three decisions below MUST be taken from the section 1 capture and
--   set in the session BEFORE the rollback runs.  If they are not set, the
--   rollback ABORTS rather than guessing.
--
--     SET docuguard.rollback_client_role_grants = 'present' | 'absent';
--        From capture 1.1.  'present' = anon and authenticated held the
--        seven privileges on every public table (the state the supplied
--        production evidence describes).  'absent' = they held nothing, in
--        which case the client-role part of the rollback is a no-op.
--
--     SET docuguard.rollback_service_role_ddl = 'present' | 'absent';
--        From capture 1.4.  'present' = service_role held TRUNCATE,
--        REFERENCES and TRIGGER before the migration.  'absent' = it did
--        not, in which case the rollback must NOT add them back.
--
--     SET docuguard.rollback_schema_create = 'present' | 'absent';
--        From capture 1.3.  'present' = the client role held CREATE on
--        schema public before the migration.
--
--     SET docuguard.rollback_function_execute = 'present' | 'absent';
--        From capture 1.6.  'present' = service_role already held an
--        EXPLICUTE grant on the trigger function before the migration (so
--        the rollback must remove the grant the migration added).
--        'absent' = it did not, and the migration's explicit grant is
--        removed so the function falls back to the PUBLIC default.
--
--   The function search_path is NOT conditional: precondition P7 of the
--   proposed migration guarantees that proconfig was NULL before the
--   change, so RESET restores the original state exactly.
-- ============================================================================

DO $rollback$
DECLARE
  v_target_tables constant text[] := ARRAY[
    'users','password_resets','documents','reminders','device_tokens',
    'subscriptions','activity_logs','subscription_payments','transactions',
    'support_tickets','exports','user_settings','login_sessions',
    'email_verifications','profiles'
  ];
  v_client_roles  constant text[] := ARRAY['anon','authenticated'];
  v_privs         constant text[] := ARRAY[
    'SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'
  ];
  t           text;
  r           text;
  p           text;
  v_seq       record;
  v_setting   text;
  v_missing   text;
BEGIN
  ------------------------------------------------------------------
  -- R1.  Correct database and role.
  ------------------------------------------------------------------
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'ABORT (R1): expected database "postgres", current database is "%". '
                    'Nothing was changed.', current_database();
  END IF;

  IF NOT (current_user = 'postgres' OR (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)) THEN
    RAISE EXCEPTION 'ABORT (R1): the rollback must run as "postgres" (or a superuser). '
                    'Current role is "%". Nothing was changed.', current_user;
  END IF;

  ------------------------------------------------------------------
  -- R2.  All four decisions must be present.  The rollback does not
  --      guess at a state it cannot prove.
  ------------------------------------------------------------------
  FOREACH r IN ARRAY ARRAY[
    'docuguard.rollback_client_role_grants',
    'docuguard.rollback_service_role_ddl',
    'docuguard.rollback_schema_create',
    'docuguard.rollback_function_execute'
  ] LOOP
    v_setting := current_setting(r, true);
    IF v_setting IS NULL OR v_setting NOT IN ('present','absent') THEN
      RAISE EXCEPTION
        'ABORT (R2): the decision "%" has not been set from the section 1 capture. '
        'Expected ''present'' or ''absent''. The rollback refuses to guess. Nothing was changed.', r;
    END IF;
  END LOOP;

  ------------------------------------------------------------------
  -- R3.  The rollback only makes sense against the migrated state.
  --      If the function still has no search_path, the migration was
  --      never applied and running the rollback would ADD privileges
  --      that were never taken away.
  ------------------------------------------------------------------
  IF (SELECT proconfig FROM pg_proc
        WHERE oid = to_regprocedure('public.update_modified_column()')) IS NULL THEN
    RAISE EXCEPTION
      'ABORT (R3): public.update_modified_column() has no configured function settings, so the '
      'Phase 2B migration does not appear to have been applied. Running the rollback now would '
      'ADD privileges that were never removed. Nothing was changed.';
  END IF;

  ------------------------------------------------------------------
  -- R4.  Restore the client-role table privileges.
  --
  --      One GRANT per privilege, per table, per role.  The privilege
  --      list is the seven that the supplied production evidence
  --      reports for both roles on every table; capture 1.1 must
  --      confirm that before this branch is taken.
  ------------------------------------------------------------------
  IF current_setting('docuguard.rollback_client_role_grants', true) = 'present' THEN
    FOREACH t IN ARRAY v_target_tables LOOP
      FOREACH r IN ARRAY v_client_roles LOOP
        FOREACH p IN ARRAY v_privs LOOP
          EXECUTE format('GRANT %s ON TABLE public.%I TO %I', p, t, r);
        END LOOP;
      END LOOP;
    END LOOP;
    RAISE NOTICE 'R4: restored % privileges on % tables for each of the % client roles',
                 array_length(v_privs, 1), array_length(v_target_tables, 1),
                 array_length(v_client_roles, 1);
  ELSE
    RAISE NOTICE 'R4: the capture showed the client roles held no table privileges — nothing to restore';
  END IF;

  ------------------------------------------------------------------
  -- R5.  Restore the client-role sequence privileges, if the capture
  --      shows they were held.  The sequence names are read from the
  --      live catalogue rather than hard-coded, so a rename cannot
  --      make the rollback miss its target.
  ------------------------------------------------------------------
  IF current_setting('docuguard.rollback_client_role_grants', true) = 'present' THEN
    FOR v_seq IN
      SELECT s.relname AS seq_name
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
        EXECUTE format('GRANT USAGE, SELECT, UPDATE ON SEQUENCE public.%I TO %I',
                       v_seq.seq_name, r);
      END LOOP;
      RAISE NOTICE 'R5: restored sequence privileges on public.%', v_seq.seq_name;
    END LOOP;
  END IF;

  ------------------------------------------------------------------
  -- R6.  Restore CREATE on schema public, if the capture shows it was
  --      held.
  ------------------------------------------------------------------
  IF current_setting('docuguard.rollback_schema_create', true) = 'present' THEN
    FOREACH r IN ARRAY v_client_roles LOOP
      EXECUTE format('GRANT CREATE ON SCHEMA public TO %I', r);
    END LOOP;
    RAISE NOTICE 'R6: restored CREATE on schema public for the client roles';
  ELSE
    RAISE NOTICE 'R6: the capture showed the client roles did not hold CREATE on schema public — nothing to restore';
  END IF;

  ------------------------------------------------------------------
  -- R7.  Restore TRUNCATE, REFERENCES and TRIGGER on service_role, if
  --      the capture shows they were held.  These are exactly the
  --      three privileges the migration removed from that role.
  ------------------------------------------------------------------
  IF current_setting('docuguard.rollback_service_role_ddl', true) = 'present' THEN
    FOREACH t IN ARRAY v_target_tables LOOP
      EXECUTE format('GRANT TRUNCATE ON TABLE public.%I TO service_role', t);
      EXECUTE format('GRANT REFERENCES ON TABLE public.%I TO service_role', t);
      EXECUTE format('GRANT TRIGGER ON TABLE public.%I TO service_role', t);
    END LOOP;
    RAISE NOTICE 'R7: restored TRUNCATE, REFERENCES and TRIGGER on % tables for service_role',
                 array_length(v_target_tables, 1);
  ELSE
    RAISE NOTICE 'R7: the capture showed service_role did not hold TRUNCATE/REFERENCES/TRIGGER — nothing to restore';
  END IF;

  ------------------------------------------------------------------
  -- R8.  Restore the trigger function's configuration.
  --
  --      RESET removes the setting, so proconfig returns to NULL — the
  --      exact state precondition P7 of the migration verified before
  --      the change.  Ownership, the function body and SECURITY DEFINER
  --      are untouched, and no EXECUTE privilege is affected here.
  ------------------------------------------------------------------
  EXECUTE 'ALTER FUNCTION public.update_modified_column() RESET search_path';
  RAISE NOTICE 'R8: reset the search_path of public.update_modified_column() (proconfig back to NULL)';

  ------------------------------------------------------------------
  -- R9.  Remove the EXECUTE grant the migration added to service_role.
  --
  --      If the capture shows service_role already held an explicit
  --      EXECUTE grant, the migration's GRANT was redundant and the
  --      pre-existing entry must be left in place: in that case the
  --      operator restores it explicitly, as documented below.
  --      Otherwise the grant the migration added is removed, and the
  --      function falls back to the PUBLIC default that it had before.
  ------------------------------------------------------------------
  IF current_setting('docuguard.rollback_function_execute', true) = 'absent' THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.update_modified_column() FROM service_role';
    RAISE NOTICE 'R9: removed the explicit EXECUTE grant added to service_role '
                 '(the function falls back to the PUBLIC default)';
  ELSE
    RAISE NOTICE 'R9: the capture showed service_role already held an explicit EXECUTE grant — '
                 'it has been left in place; verify with the section 1.6 query';
  END IF;

  ------------------------------------------------------------------
  -- R10.  The service-role DML grants the migration RE-STATED are
  --       additive.  Nothing was removed from the DML set, so there is
  --       nothing to restore.  The narrowing opt-in block (plan P1) is
  --       the only path that removes service_role DML, and it has its
  --       own explicit reverse below.
  ------------------------------------------------------------------
  RAISE NOTICE 'R10: no service_role DML grant was removed by the migration — nothing to restore';

  ------------------------------------------------------------------
  -- R11.  Reverse of the opt-in blocks, each gated by the same
  --       opt-in style so that an accidental run cannot widen the
  --       privilege surface.
  ------------------------------------------------------------------

  -- Reverse of plan P1 (service_role narrowing): re-grant the DML set on
  -- every public table.  Enable with:
  --   SET docuguard.rollback_service_role_narrowing = 'CONFIRMED';
  IF current_setting('docuguard.rollback_service_role_narrowing', true) = 'CONFIRMED' THEN
    FOREACH t IN ARRAY v_target_tables LOOP
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role', t);
    END LOOP;
    RAISE NOTICE 'R11a: restored SELECT/INSERT/UPDATE/DELETE on % tables for service_role',
                 array_length(v_target_tables, 1);
  ELSE
    RAISE NOTICE 'R11a: service_role narrowing reverse SKIPPED (opt-in)';
  END IF;

  -- Reverse of plan P2 (client-role policy drop): the dropped policies
  -- CANNOT be recreated automatically, because their exact definitions
  -- live only in the section 1.7 capture.  The script therefore refuses
  -- to pretend, and asks for the CREATE POLICY statements to be pasted
  -- in from the capture.
  IF current_setting('docuguard.rollback_client_policy_restore', true) = 'CONFIRMED' THEN
    RAISE EXCEPTION
      'ABORT (R11b): the client-role policies that plan P2 dropped must be recreated from the '
      'section 1.7 capture. Their exact USING and WITH CHECK expressions are not recoverable '
      'from the database once the policy is gone. Paste the CREATE POLICY statements from the '
      'capture above this block and execute them individually. Nothing was changed.';
  END IF;

  RAISE NOTICE 'PHASE 2B ROLLBACK COMPLETE. Review section 2 of the plan: restoring privileges '
               'does NOT restore data, and it re-opens the exposure this phase was designed to close.';
END
$rollback$;


-- ============================================================================
-- SECTION 3 — ROLLBACK COMPLETENESS MAP
--
--   Every change the proposed migration makes has a recovery step here.
--   The migration is not approvable if any change lacks a row.
--
--   +---+--------------------------------+---------------------------------------------+
--   | # | Change (proposed migration)      | Recovery step (this file)               |
--   +---+--------------------------------+---------------------------------------------+
--   | 1 | REVOKE 7 table privileges from  | R4: GRANT <privilege> ON TABLE           |
--   |   | anon and authenticated on 15     | public.<table> TO <role>, one           |
--   |   | tables                          | statement per privilege per table      |
--   |   |                                 | per role                               |
--   +---+--------------------------------+---------------------------------------------+
--   | 2 | REVOKE USAGE/SELECT/UPDATE on    | R5: GRANT USAGE, SELECT, UPDATE ON       |
--   |   | the sequences of those tables    | SEQUENCE public.<seq> TO <role>         |
--   +---+--------------------------------+---------------------------------------------+
--   | 3 | REVOKE CREATE on schema public   | R6: GRANT CREATE ON SCHEMA public       |
--   |   | from the client roles            | TO <role>                              |
--   +---+--------------------------------+---------------------------------------------+
--   | 4 | REVOKE TRUNCATE/REFERENCES/       | R7: GRANT TRUNCATE / REFERENCES /       |
--   |   | TRIGGER from service_role on 15  | TRIGGER ON TABLE public.<table> TO     |
--   |   | tables                           | service_role                           |
--   +---+--------------------------------+---------------------------------------------+
--   | 5 | GRANT (re-stated) service_role   | R10: nothing to restore — the change   |
--   |   | DML on 4 tables                  | was additive                            |
--   +---+--------------------------------+---------------------------------------------+
--   | 6 | GRANT USAGE/SELECT on the        | R10: nothing to restore — the change   |
--   |   | sequences of those 4 tables      | was additive                            |
--   +---+--------------------------------+---------------------------------------------+
--   | 7 | ALTER FUNCTION ... SET            | R8: ALTER FUNCTION public               |
--   |   | search_path = pg_catalog, public | .update_modified_column() RESET         |
--   |   |                                 | search_path  (proconfig back to NULL)  |
--   +---+--------------------------------+---------------------------------------------+
--   | 8 | GRANT EXECUTE on the trigger     | R9: REVOKE EXECUTE ON FUNCTION          |
--   |   | function to service_role         | public.update_modified_column() FROM   |
--   |   |                                 | service_role (falls back to PUBLIC)    |
--   +---+--------------------------------+---------------------------------------------+
--   | 9 | Opt-in P1: narrow service_role   | R11a: GRANT SELECT, INSERT, UPDATE,     |
--   |   | to 4 tables                      | DELETE on every public table to        |
--   |   |                                 | service_role                           |
--   +---+--------------------------------+---------------------------------------------+
--   | 10| Opt-in P2: drop client-role      | R11b: recreate the policies from the   |
--   |   | policies                         | section 1.7 capture. NOT automatable — |
--   |   |                                 | the script refuses to fake it           |
--   +---+--------------------------------+---------------------------------------------+
--
--   Not changed by the migration, therefore not covered by the rollback:
--     * table data, row counts, table definitions, indexes, constraints
--     * table and function ownership
--     * RLS enable/disable state
--     * Storage bucket settings and Storage policies
--     * the application's database credential
--     * any application file, deployment or Git state
--
-- ============================================================================
-- End of the proposed rollback.  NOT EXECUTED.
-- ============================================================================
