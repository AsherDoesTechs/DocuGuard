-- ============================================================================
-- DocuGuard — Phase 2B: Supabase least-privilege VERIFICATION
-- ============================================================================
--
-- STATUS:  REVIEW ARTIFACT.  NOTHING IN THIS FILE HAS BEEN EXECUTED.
--          This is the verification runbook for the proposed migration in
--          docs/sql/phase2b_supabase_least_privilege.proposed.sql.
--
-- TARGET:  Supabase project reference  ysxeobillupncexfkfvu
--          Database                   postgres
--
-- HOW TO USE
--   Section 1  Database-side verification (read-only SQL, plus safe
--               in-transaction write probes that are always rolled back).
--               Run it as `postgres` (or any superuser): the live role
--               probes in V9 use SET LOCAL ROLE, which a non-superuser
--               cannot do for `anon` / `authenticated`.  It reports
--               PASS/FAIL per check and lists every failure in one
--               message.
--   Section 2  The "no unintended changes" confirmation (fingerprints,
--               row counts, content checksums, ACL deltas).
--   Section 3  Application-level regression tests that this SQL file
--               cannot perform: Storage, authentication, document
--               lifecycle, mirror synchronisation, and the external
--               client-role denial check.
--
-- WHAT SECTION 1 DOES NOT PROVE
--   * That the application still works.  That is Section 3.
--   * Anything about the live Storage policies, which remain
--     unconfirmed; Section 1.9 REPORTS them, it does not assert them.
--   * That the deployed PostgreSQL connection username is correct.  The
--     direct-connection checks in Section 1.7 are parameterised on
--     `docuguard.app_role` and are SKIPPED until that role is confirmed.
--
-- ============================================================================


-- ============================================================================
-- SECTION 1 — DATABASE-SIDE VERIFICATION
-- ============================================================================

\echo ''
\echo '################ SECTION 1 — DATABASE-SIDE VERIFICATION ################'
\echo ''

-- ----------------------------------------------------------------------------
-- V1..V12: one block, all checks, every failure reported at once.
-- ----------------------------------------------------------------------------
DO $verify$
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
  v_expected_trigger_tables constant text[] := ARRAY[
    'device_tokens','documents','profiles','reminders','subscriptions',
    'user_settings','users'
  ];

  v_failures text[] := ARRAY[]::text[];
  v_notes    text[] := ARRAY[]::text[];
  v_sql      text;
  v_n        bigint;
  v_oid      oid;
  v_text     text;
  v_trig     text;
  v_seq      record;
  v_probe    text;
  v_pass     boolean;
  v_err      text;
  v_app_role text;
BEGIN
  ------------------------------------------------------------------
  -- V1.  RLS is ENABLED on all 15 intended tables, and is NOT forced.
  --      (FORCE would make the table owner subject to RLS too, which
  --      the application would not survive given 12 policy-less
  --      tables.  It must remain false.)
  ------------------------------------------------------------------
  SELECT count(*) INTO v_n
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
    AND c.relname::text = ANY(v_target_tables) AND NOT c.relrowsecurity;
  IF v_n > 0 THEN
    v_failures := v_failures || format('V1 FAIL: RLS is not enabled on % table(s).', v_n);
  ELSE
    v_notes := v_notes || 'V1 PASS: RLS enabled on all 15 intended tables.';
  END IF;

  SELECT count(*) INTO v_n
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
    AND c.relname::text = ANY(v_target_tables) AND c.relforcerowsecurity;
  IF v_n > 0 THEN
    v_failures := v_failures || format('V1 FAIL: FORCE ROW LEVEL SECURITY is set on % table(s) — '
      'the application role would be denied by the policy-less tables.', v_n);
  ELSE
    v_notes := v_notes || 'V1 PASS: FORCE ROW LEVEL SECURITY is not set anywhere.';
  END IF;

  ------------------------------------------------------------------
  -- V2.  No policy was created.  The tables that had no policy must
  --      still have no policy: deny-by-default is the intended state
  --      and the reason the 12 Security Advisor findings persist.
  --      Any policy granting a client role is a failure.
  ------------------------------------------------------------------
  SELECT count(*) INTO v_n
  FROM pg_policies p
  WHERE p.schemaname = 'public'
    AND (p.roles @> ARRAY['anon']::name[]
         OR p.roles @> ARRAY['authenticated']::name[]
         OR p.roles @> ARRAY['public']::name[]);
  IF v_n > 0 THEN
    v_failures := v_failures || format('V2 FAIL: % policy/policies still grant a client role '
      '(a policy written TO public also grants anon and authenticated).', v_n);
  ELSE
    v_notes := v_notes || 'V2 PASS: no RLS policy grants anon, authenticated or public.';
  END IF;

  SELECT count(*) INTO v_n
  FROM pg_policies WHERE schemaname = 'public';
  v_notes := v_notes || format('V2 NOTE: % policy/policies exist in schema public. '
           'The expected state is 3 (the tables that already had policies) and 0 new ones. '
           'Compare with the pre-migration capture.', v_n);

  ------------------------------------------------------------------
  -- V3.  anon and authenticated hold NO privilege on any public table.
  ------------------------------------------------------------------
  FOREACH v_text IN ARRAY v_target_tables LOOP
    FOREACH v_probe IN ARRAY v_client_roles LOOP
      FOREACH v_sql IN ARRAY v_privs LOOP
        IF has_table_privilege(v_probe, format('public.%I', v_text), v_sql) THEN
          v_failures := v_failures || format(
            'V3 FAIL: % still holds %s on public.%s.', v_probe, v_sql, v_text);
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM unnest(v_failures) AS u(f) WHERE f LIKE 'V3 FAIL%') THEN
    v_notes := v_notes || 'V3 PASS: anon and authenticated hold no table privilege on any of the 15 tables.';
  END IF;

  ------------------------------------------------------------------
  -- V4.  service_role holds what it needs and not what it does not.
  ------------------------------------------------------------------
  IF NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname = 'service_role') THEN
    v_failures := v_failures || 'V4 FAIL: service_role does not have BYPASSRLS. The PostgREST '
      'mirror would be denied by the policy-less tables, and the mirror swallows its errors.';
  ELSE
    v_notes := v_notes || 'V4 PASS: service_role has BYPASSRLS.';
  END IF;

  FOREACH v_text IN ARRAY v_target_tables LOOP
    IF v_text IN ('documents','reminders') THEN
      IF NOT (has_table_privilege('service_role', format('public.%I', v_text), 'SELECT')
          AND has_table_privilege('service_role', format('public.%I', v_text), 'INSERT')
          AND has_table_privilege('service_role', format('public.%I', v_text), 'UPDATE')
          AND has_table_privilege('service_role', format('public.%I', v_text), 'DELETE')) THEN
        v_failures := v_failures || format('V4 FAIL: service_role lacks a required privilege on public.%s.', v_text);
      END IF;
    ELSIF v_text = 'profiles' THEN
      IF NOT (has_table_privilege('service_role', format('public.%I', v_text), 'SELECT')
          AND has_table_privilege('service_role', format('public.%I', v_text), 'INSERT')
          AND has_table_privilege('service_role', format('public.%I', v_text), 'UPDATE')) THEN
        v_failures := v_failures || format('V4 FAIL: service_role lacks a required privilege on public.%s.', v_text);
      END IF;
    ELSIF v_text = 'exports' THEN
      IF NOT has_table_privilege('service_role', format('public.%I', v_text), 'INSERT') THEN
        v_failures := v_failures || 'V4 FAIL: service_role lacks INSERT on public.exports '
          '(the export path would fail).';
      END IF;
    END IF;

    -- The three privileges no code path uses must be gone from service_role.
    FOREACH v_sql IN ARRAY ARRAY['TRUNCATE','REFERENCES','TRIGGER'] LOOP
      IF has_table_privilege('service_role', format('public.%I', v_text), v_sql) THEN
        v_failures := v_failures || format(
          'V4 FAIL: service_role still holds %s on public.%s.', v_sql, v_text);
      END IF;
    END LOOP;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM unnest(v_failures) AS u(f) WHERE f LIKE 'V4 FAIL%') THEN
    v_notes := v_notes || 'V4 PASS: service_role holds the required privileges and none of '
      'TRUNCATE / REFERENCES / TRIGGER on any table.';
  END IF;

  ------------------------------------------------------------------
  -- V5.  No sequence privilege for the client roles; USAGE for
  --      service_role on the exports sequence.
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
    WHERE s.relkind = 'S' AND sn.nspname = 'public' AND tn.nspname = 'public'
      AND t.relname::text = ANY(v_target_tables)
  LOOP
    FOREACH v_probe IN ARRAY v_client_roles LOOP
      IF has_sequence_privilege(v_probe, format('public.%I', v_seq.seq_name), 'USAGE') THEN
        v_failures := v_failures || format('V5 FAIL: % still holds USAGE on sequence public.%s.',
                                            v_probe, v_seq.seq_name);
      END IF;
    END LOOP;
    IF v_seq.tbl_name = 'exports'
       AND NOT has_sequence_privilege('service_role', format('public.%I', v_seq.seq_name), 'USAGE') THEN
      v_failures := v_failures || format('V5 FAIL: service_role lacks USAGE on sequence public.%s '
        '(the export insert omits "id" and would fail).', v_seq.seq_name);
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM unnest(v_failures) AS u(f) WHERE f LIKE 'V5 FAIL%') THEN
    v_notes := v_notes || 'V5 PASS: sequence privileges are correct.';
  END IF;

  ------------------------------------------------------------------
  -- V6.  Schema-level: the client roles must not hold CREATE.
  --      USAGE is intentionally NOT asserted either way.
  ------------------------------------------------------------------
  FOREACH v_probe IN ARRAY v_client_roles LOOP
    IF has_schema_privilege(v_probe, 'public', 'CREATE') THEN
      v_failures := v_failures || format('V6 FAIL: % still holds CREATE on schema public.', v_probe);
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM unnest(v_failures) AS u(f) WHERE f LIKE 'V6 FAIL%') THEN
    v_notes := v_notes || 'V6 PASS: neither client role holds CREATE on schema public.';
  END IF;

  ------------------------------------------------------------------
  -- V7.  The trigger function: configuration, ownership, body, and
  --      the EXECUTE grant the mirror path depends on.
  ------------------------------------------------------------------
  IF to_regprocedure('public.update_modified_column()') IS NULL THEN
    v_failures := v_failures || 'V7 FAIL: public.update_modified_column() does not exist.';
  ELSE
    -- The exact stored text of a GUC list value is not asserted: whitespace
    -- around the comma is normalised differently by PostgreSQL versions.
    -- What matters is that a search_path setting exists and that it names
    -- pg_catalog and public.
    IF NOT EXISTS (
         SELECT 1
         FROM pg_proc p
         CROSS JOIN LATERAL unnest(p.proconfig) AS cfg
         WHERE p.oid = to_regprocedure('public.update_modified_column()')
           AND cfg LIKE 'search_path=%'
           AND replace(cfg, 'search_path=', '') ~ '^\s*pg_catalog\s*,\s*public\s*$'
       ) THEN
      v_failures := v_failures || format('V7 FAIL: the function has no search_path setting of '
        '"pg_catalog, public". Actual proconfig: [%s].',
        (SELECT COALESCE(proconfig::text, '(null)')
           FROM pg_proc WHERE oid = to_regprocedure('public.update_modified_column()')));
    ELSE
      v_notes := v_notes || 'V7 PASS: search_path is pinned to pg_catalog, public.';
    END IF;

    IF (SELECT prosecdef FROM pg_proc
         WHERE oid = to_regprocedure('public.update_modified_column()')) THEN
      v_failures := v_failures || 'V7 FAIL: the function became SECURITY DEFINER — it must not.';
    ELSE
      v_notes := v_notes || 'V7 PASS: SECURITY DEFINER remains false.';
    END IF;

    IF (SELECT pg_get_userbyid(proowner) FROM pg_proc
         WHERE oid = to_regprocedure('public.update_modified_column()')) <> 'postgres' THEN
      v_failures := v_failures || 'V7 FAIL: the function owner changed — ownership must not change.';
    ELSE
      v_notes := v_notes || 'V7 PASS: ownership is still postgres.';
    END IF;

    IF NOT has_function_privilege('service_role',
         to_regprocedure('public.update_modified_column()'), 'EXECUTE') THEN
      v_failures := v_failures || 'V7 FAIL: service_role cannot EXECUTE the trigger function. '
        'A PostgREST UPDATE on documents/reminders/profiles would fail.';
    ELSE
      v_notes := v_notes || 'V7 PASS: service_role can EXECUTE the trigger function.';
    END IF;
  END IF;

  ------------------------------------------------------------------
  -- V8.  All 7 trigger dependencies must still be present and enabled.
  ------------------------------------------------------------------
  SELECT string_agg(DISTINCT c.relname::text, ', ' ORDER BY c.relname::text) INTO v_trig
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND NOT t.tgisinternal
    AND t.tgfoid = to_regprocedure('public.update_modified_column()');

  IF v_trig IS DISTINCT FROM (
       SELECT string_agg(x, ', ' ORDER BY x) FROM unnest(v_expected_trigger_tables) AS u(x)) THEN
    v_failures := v_failures || format('V8 FAIL: the trigger dependencies are [%s], expected '
      '[device_tokens, documents, profiles, reminders, subscriptions, user_settings, users].',
      v_trig);
  ELSE
    v_notes := v_notes || 'V8 PASS: all 7 trigger dependencies are present.';
  END IF;

  SELECT count(*) INTO v_n
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND NOT t.tgisinternal
    AND t.tgfoid = to_regprocedure('public.update_modified_column()')
    AND t.tgenabled <> 'O';
  IF v_n > 0 THEN
    v_failures := v_failures || format('V8 FAIL: % trigger(s) are disabled.', v_n);
  ELSE
    v_notes := v_notes || 'V8 PASS: every trigger is enabled.';
  END IF;

  ------------------------------------------------------------------
  -- V9.  Live probe: the client roles must be denied at the database
  --      level, not merely by the absence of a policy.
  --
  --      A READ probe is used deliberately.  A write probe that
  --      unexpectedly SUCCEEDED would insert a row; the write denial is
  --      instead proven by the definitive has_table_privilege checks in
  --      V3 and V4.
  --      The probe runs inside a subtransaction, so the SET LOCAL ROLE
  --      is undone when the subtransaction ends.
  ------------------------------------------------------------------
  FOREACH v_probe IN ARRAY v_client_roles LOOP
    v_pass := false;
    v_err := NULL;
    BEGIN
      EXECUTE format('SET LOCAL ROLE %I', v_probe);
      EXECUTE 'SELECT 1 FROM public.users LIMIT 1';
      v_err := 'the role could read public.users';
    EXCEPTION WHEN SQLSTATE '42501' THEN
      v_pass := true;
      v_err := SQLERRM;
    WHEN OTHERS THEN
      v_err := SQLERRM;
    END;
    IF NOT v_pass THEN
      v_failures := v_failures || format('V9 FAIL: % was not denied on public.users (%s). '
        'A 42501 "insufficient_privilege" error is required.', v_probe, COALESCE(v_err, 'no error'));
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM unnest(v_failures) AS u(f) WHERE f LIKE 'V9 FAIL%') THEN
    v_notes := v_notes || 'V9 PASS: live probes confirm anon and authenticated are denied '
      'on public.users.';
  END IF;

  ------------------------------------------------------------------
  -- V10.  Role membership graph must be unchanged (compare with the
  --       section 1.8 capture of the rollback script).
  ------------------------------------------------------------------
  SELECT count(*) INTO v_n
  FROM pg_auth_members m
  JOIN pg_roles g ON g.oid = m.roleid
  JOIN pg_roles h ON h.oid = m.member
  WHERE g.rolname IN ('anon','authenticated','service_role');
  v_notes := v_notes || format('V10 NOTE: % membership edge(s) involve a client or service role. '
    'Compare with the pre-migration capture; the migration must not have changed this.', v_n);

  ------------------------------------------------------------------
  -- V11.  Direct-connection role checks.
  --       PARAMETERISED: the deployed connection username is not yet
  --       confirmed.  Set the role name to run these checks:
  --         SET docuguard.app_role = '<deployed username>';
  --       Until then they are skipped and reported as such.
  ------------------------------------------------------------------
  v_app_role := current_setting('docuguard.app_role', true);
  IF v_app_role IS NULL THEN
    v_notes := v_notes || 'V11 SKIPPED: docuguard.app_role is not set, so the direct-connection '
      'checks were not run. Set it to the deployed PostgreSQL username to run them.';
  ELSIF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_app_role) THEN
    v_failures := v_failures || format('V11 FAIL: docuguard.app_role = "%" is not a role in this '
      'database. The deployed connection username is wrong or points elsewhere.', v_app_role);
  ELSE
    FOREACH v_text IN ARRAY v_target_tables LOOP
      IF v_text IN ('users','password_resets','documents','reminders','profiles','exports',
                    'user_settings','login_sessions','support_tickets','transactions',
                    'subscriptions','activity_logs') THEN
        IF NOT (has_table_privilege(v_app_role, format('public.%I', v_text), 'SELECT')
            AND has_table_privilege(v_app_role, format('public.%I', v_text), 'INSERT')
            AND has_table_privilege(v_app_role, format('public.%I', v_text), 'UPDATE')
            AND has_table_privilege(v_app_role, format('public.%I', v_text), 'DELETE')) THEN
          v_failures := v_failures || format('V11 FAIL: the direct-connection role % cannot '
            'perform the full read/write set on public.%s. The application would break on that table.',
            v_app_role, v_text);
        END IF;
        FOREACH v_sql IN ARRAY ARRAY['TRUNCATE','REFERENCES','TRIGGER'] LOOP
          IF has_table_privilege(v_app_role, format('public.%I', v_text), v_sql) THEN
            v_notes := v_notes || format('V11 NOTE: the direct-connection role % holds %s on '
              'public.%s. Not required by the application; remove it in Phase 2C when the role is '
              'dedicated.', v_app_role, v_sql, v_text);
          END IF;
        END LOOP;
      END IF;
    END LOOP;
    v_notes := v_notes || format('V11 PASS: the direct-connection role % holds the read/write set '
      'on every table the application uses.', v_app_role);
  END IF;

  ------------------------------------------------------------------
  -- V12.  Report the storage facts (the live Storage policies remain
  --       unconfirmed; this REPORTS, it does not assert).
  ------------------------------------------------------------------
  v_notes := v_notes || 'V12 NOTE: the live Storage policies are NOT independently confirmed. '
    'Review the output of the storage query below and treat any policy that grants anon or '
    'authenticated on the documents bucket as a finding to be closed (plan proposal P3).';

  ------------------------------------------------------------------
  -- Report.
  ------------------------------------------------------------------
  RAISE NOTICE '';
  RAISE NOTICE '================= PHASE 2B VERIFICATION REPORT =================';
  FOREACH v_text IN ARRAY v_notes LOOP
    RAISE NOTICE '%', v_text;
  END LOOP;
  RAISE NOTICE '----------------------------------------------------------------';
  IF array_length(v_failures, 1) IS NULL THEN
    RAISE NOTICE 'RESULT: ALL DATABASE-SIDE CHECKS PASSED.';
    RAISE NOTICE 'The application-level regression suite (Section 3) is still required.';
  ELSE
    FOREACH v_text IN ARRAY v_failures LOOP
      RAISE NOTICE 'FAILURE: %', v_text;
    END LOOP;
    RAISE NOTICE 'RESULT: % CHECK(S) FAILED. DO NOT CLOSE THE CHANGE.', array_length(v_failures, 1);
    RAISE EXCEPTION 'Phase 2B verification failed: % check(s) failed.', array_length(v_failures, 1);
  END IF;
  RAISE NOTICE '================================================================';
END
$verify$;


-- ============================================================================
-- SECTION 2 — NO UNINTENDED CHANGES
--
--   Run this before and after the migration.  The two "normalised"
--   fingerprints and the row counts MUST be identical; only the ACLs and
--   the function proconfig are expected to differ.
-- ============================================================================

\echo ''
\echo '############ SECTION 2 — NO UNINTENDED CHANGES ############'
\echo ''

\echo '=== 2.1  Raw catalogue fingerprint (expected to CHANGE: ACLs + proconfig) ==='
SELECT md5(string_agg(fingerprint, '|' ORDER BY fingerprint)) AS fingerprint_raw
FROM (
  SELECT 'table:' || c.relname || ':' || COALESCE(c.relacl::text, '') AS fingerprint
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
  UNION ALL
  SELECT 'sequence:' || s.relname || ':' || COALESCE(s.relacl::text, '')
  FROM pg_class s JOIN pg_namespace n ON n.oid = s.relnamespace
  WHERE n.nspname = 'public' AND s.relkind = 'S'
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

\echo '=== 2.2  Normalised fingerprint (ACLs and proconfig EXCLUDED) — MUST be identical ==='
SELECT md5(string_agg(fingerprint, '|' ORDER BY fingerprint)) AS fingerprint_normalised
FROM (
  SELECT 'table:' || c.relname AS fingerprint
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
  UNION ALL
  SELECT 'sequence:' || s.relname
  FROM pg_class s JOIN pg_namespace n ON n.oid = s.relnamespace
  WHERE n.nspname = 'public' AND s.relkind = 'S'
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
  SELECT 'func:' || p.proname || ':' || md5(p.prosrc)
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
) s;

\echo '=== 2.3  Table definition fingerprint (columns, types, defaults, constraints) ==='
SELECT md5(string_agg(fingerprint, '|' ORDER BY fingerprint)) AS fingerprint_table_defs
FROM (
  SELECT c.relname || ':' || COALESCE(string_agg(
           a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
           || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END
           || CASE WHEN ad.adbin is not null THEN ' DEFAULT ' || pg_get_expr(ad.adbin, ad.adrelid) ELSE '' END,
           ', ' ORDER BY a.attnum), '')
    AS fingerprint
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
  LEFT JOIN pg_attrdef ad ON ad.adrelid = c.oid AND ad.adnum = a.attnum
  WHERE n.nspname = 'public' AND c.relkind = 'r'
  GROUP BY c.relname
) s;

\echo '=== 2.4  Row counts per public table — MUST be identical before and after ==='
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

\echo '=== 2.5  Content checksums for the data-bearing tables — MUST be identical ==='
SELECT 'documents' AS tbl, md5(string_agg(h, '|' ORDER BY h)) AS checksum FROM (
  SELECT md5(concat_ws('|', id::text, user_id::text, coalesce(title,''), coalesce(issuer,''),
                       coalesce(document_number,''), coalesce(expiry_date::text,''),
                       coalesce(s3_key,''), coalesce(status,''), coalesce(processing_status,''),
                       coalesce(updated_at::text,''))) AS h
  FROM public.documents) s
UNION ALL
SELECT 'reminders', md5(string_agg(h, '|' ORDER BY h)) FROM (
  SELECT md5(concat_ws('|', id::text, user_id::text, coalesce(title,''), coalesce(due_date::text,''),
                       coalesce(severity,''), coalesce(is_read::text,''), coalesce(updated_at::text,''))) AS h
  FROM public.reminders) s
UNION ALL
SELECT 'profiles', md5(string_agg(h, '|' ORDER BY h)) FROM (
  SELECT md5(concat_ws('|', id::text, user_id::text, coalesce(name,''), coalesce(email,''),
                       coalesce(updated_at::text,''))) AS h
  FROM public.profiles) s
UNION ALL
SELECT 'users', md5(string_agg(h, '|' ORDER BY h)) FROM (
  SELECT md5(concat_ws('|', id::text, coalesce(email,''), coalesce(name,''),
                       coalesce(security_level,''), coalesce(is_verified::text,''),
                       coalesce(updated_at::text,''))) AS h
  FROM public.users) s
UNION ALL
SELECT 'exports', md5(string_agg(h, '|' ORDER BY h)) FROM (
  SELECT md5(concat_ws('|', id::text, user_id::text, coalesce(created_at::text,''),
                       md5(coalesce(data::text,''))::text)) AS h
  FROM public.exports) s
UNION ALL
SELECT 'user_settings', md5(string_agg(h, '|' ORDER BY h)) FROM (
  SELECT md5(concat_ws('|', id::text, user_id::text, coalesce(default_category,''),
                       coalesce(auto_backup::text,''), coalesce(updated_at::text,''))) AS h
  FROM public.user_settings) s;

\echo '=== 2.6  Storage object count — MUST be identical (the migration touches Storage) ==='
SELECT count(*) AS storage_objects FROM storage.objects;
SELECT id, name, public FROM storage.buckets ORDER BY id;

\echo '=== 2.7  The exact ACL delta — list what the migration changed ==='
SELECT c.relname AS table_name, c.relacl::text[] AS acl_now
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY c.relname;

SELECT s.relname AS sequence_name, s.relacl::text[] AS acl_now
FROM pg_class s
JOIN pg_namespace n ON n.oid = s.relnamespace
WHERE n.nspname = 'public' AND s.relkind = 'S'
ORDER BY s.relname;

SELECT nspname, nspacl::text[] AS acl_now FROM pg_namespace WHERE nspname = 'public';


-- ============================================================================
-- SECTION 3 — APPLICATION-LEVEL REGRESSION TESTS
--
--   These cannot be expressed as SQL.  Each test states the exact call,
--   the expected result, and the failure signal.  Run them against the
--   production service AFTER the migration, inside the change window.
--
--   Placeholders:  {API}  the Express base URL
--                  {TOKEN} a JWT for a dedicated test account
--                  {ANON}  the Supabase anon key  (never the service-role key)
--                  {SUPA}  the Supabase project URL
--   Never put a service-role key or the anon key in a ticket, a log, or a
--   shell history that is shared.
-- ============================================================================

\echo ''
\echo '############ SECTION 3 — APPLICATION REGRESSION TESTS ############'
\echo ''

-- ----------------------------------------------------------------------------
-- R1  Backend read/write per table, over the direct PostgreSQL path.
--     Every statement below is exercised by a real route.  The test is
--     that the route answers with the expected status AFTER the change.
-- ----------------------------------------------------------------------------
--   R1.1  POST /documents                     -> 201, and the row is readable
--   R1.2  GET  /documents                     -> 200, the row is listed
--   R1.3  PUT  /documents/:id                 -> 200, revision advances
--   R1.4  DELETE /documents/:id               -> 200, row gone
--   R1.5  POST /reminders                     -> 201;  GET /reminders -> 200
--   R1.6  PUT  /reminders/:id                 -> 200;  DELETE -> 200
--   R1.7  PATCH /profile                      -> 200 (users UPDATE)
--   R1.8  PATCH /profile/settings             -> 200 (user_settings INSERT/UPDATE)
--   R1.9  GET  /profile/sessions              -> 200 (login_sessions SELECT)
--   R1.10 POST /profile/support               -> 201 (support_tickets INSERT)
--   R1.11 GET  /profile/export                -> 200 (SELECT * over 6 tables)
--   R1.12 POST /api/export/export             -> 200 (exports INSERT — the
--                                                 sequence path)
--   R1.13 GET  /dashboard                      -> 200 (documents + reminders)
--
--   Expected: every route answers exactly as it did before the change.
--   Failure signal: a 500 with `permission denied for table <x>` or
--   `permission denied for sequence <x>`.  That is a migration defect:
--   the role set in section 2.1 is wrong.  Do NOT work around it by
--   granting the role more.

-- ----------------------------------------------------------------------------
-- R2  PostgREST mirror path — THE HIGHEST-VALUE TEST.
--     The mirror swallows its own failures
--     (DocuGuard-Server/services/dataSyncService.js:191-196), so a
--     broken mirror presents as a STALE MIRROR, not as an error.
-- ----------------------------------------------------------------------------
--   R2.1  POST /documents, then read the row back through the service-role
--         PostgREST API and confirm the mirror row exists and matches.
--         This exercises service_role INSERT/UPDATE plus the
--         update_modified_column() trigger.
--   R2.2  POST /documents/verify on a document with an expiry_date and an
--         s3_key, then confirm the row STILL HAS expiry_date and s3_key.
--         A nulled value here means the partial-payload mirror defect
--         (audit P0-1) is active, not that the migration failed.
--   R2.3  Create a reminder, then confirm the mirrored reminder row exists.
--   R2.4  PATCH /profile, then confirm the profiles mirror row was updated.
--   R2.5  POST /api/export/export, then confirm the exports row exists and
--         that the exports sequence advanced (id is assigned).
--   R2.6  DELETE a document, then confirm the mirror row is gone.
--   R2.7  Confirm the server still opens its three Realtime channels at
--         boot and that a documents write produces a server-side event.
--         (No client consumes these; the assertion is server-side.)

-- ----------------------------------------------------------------------------
-- R3  Storage — signed upload, signed download, ownership, expiry.
-- ----------------------------------------------------------------------------
--   R3.1  GET  {API}/documents/upload-url      -> 200; the response carries
--         uploadUrl, fileUrl, s3Key and maxBytes.
--   R3.2  PUT the bytes to uploadUrl            -> 2xx.  The upload URL
--         carries a signed token, not an API key, and is valid for the
--         platform's fixed window (2 hours) — the SDK exposes no TTL
--         parameter, so this cannot be shortened in code today.
--   R3.3  GET  {API}/documents/:id/file-url    -> 200 with a fresh signed
--         URL; fetch that URL with no credentials -> 200 and the bytes.
--   R3.4  EXPIRY: wait for the 15-minute signed-URL TTL to pass, then
--         fetch the same signed URL -> 400/403, never the bytes.
--   R3.5  OWNERSHIP: mint a file URL for user A's document, then try to
--         resolve user B's document against user A's s3_key.  The route
--         must refuse (the ownership check is
--         DocuGuard-Server/controllers/documentController.js:1262-1267 and
--         shared/sync/storageObjectPolicy.js).
--   R3.6  DELETE {API}/documents/storage        -> 200 and the object is
--         gone from the bucket.
--   R3.7  Confirm the bucket is still private: the storage query in
--         section 2.6 must show public = false for the `documents` bucket,
--         and the unauthenticated object URL must NOT resolve.

-- ----------------------------------------------------------------------------
-- R4  Authentication, email verification, password reset, 2FA, sessions.
-- ----------------------------------------------------------------------------
--   R4.1  POST /auth/register                  -> 201; a verification email
--         is sent; the row has is_verified = false.
--   R4.2  POST /auth/verify-email with the token -> 200 and a JWT.
--         (NOTE: this statement is `RETURNING id, email, role` and the
--         `role` column does not exist in the repository schema — audit
--         P1-3.  If it fails, that is the pre-existing defect, NOT a
--         migration regression.  Capture the error either way.)
--   R4.3  GET  /auth/verify-email-web          -> 200 (unaffected path).
--   R4.4  POST /auth/login with the wrong password -> 401.
--   R4.5  POST /auth/login with the right password -> 200 and a JWT.
--   R4.6  POST /auth/forgot-password           -> 200; a password_resets
--         row is created.
--   R4.7  POST /auth/reset-password with the token -> 200; the hash
--         changes; the reset row is marked used.
--   R4.8  2FA: POST /profile/security/2fa/setup -> 200 (secret stored);
--         POST /profile/security/2fa/verify with a valid code -> 200
--         (two_factor = true, two_factor_enabled_at set).
--   R4.9  2FA LOGIN GATE: log in again with 2FA enabled and no code -> 403;
--         with a valid code -> 200.
--   R4.10 SESSIONS: GET /profile/sessions -> 200.  The list is EMPTY by
--         design today (audit P1-5: nothing ever inserts into
--         login_sessions).  The assertion is that the behaviour is
--         UNCHANGED, not that it works.
--   R4.11 POST /api/notifications/push-token   -> 200; the token is
--         detached from any other account; DELETE -> 200 and the token is
--         cleared.
--   R4.12 GET /health and GET /health/ready     -> 200 and 200.  If the
--         readiness route returns 503 the database connection is broken;
--         investigate the connection before assuming a privilege problem.

-- ----------------------------------------------------------------------------
-- R5  Document lifecycle — OCR, processing, editing, deletion.
-- ----------------------------------------------------------------------------
--   R5.1  POST /documents/ocr-draft            -> 201; processing_status is
--         'pending'.
--   R5.2  POST /documents/process              -> 200; processing_status
--         becomes 'completed'; the extracted fields are filled only where
--         they were empty.
--   R5.3  TRIGGER CHECK: after every UPDATE, `updated_at` must have
--         advanced and must match the canonical revision format
--         YYYY-MM-DDTHH24:MI:SS.USZ.  This is the direct behavioural test
--         of the search_path hardening: a wrong search_path would change
--         how NOW() resolves, and a broken function would stop the
--         timestamp advancing at all.
--   R5.4  PUT /documents/:id with a stale revision -> 409 with
--         serverUpdatedAt (the revision guard must still work).
--   R5.5  PUT /documents/:id with the current revision -> 200.
--   R5.6  DELETE /documents/:id                 -> 200; the row is gone and
--         the storage object is removed on a best-effort basis.
--   R5.7  Delete the document twice -> the second delete is 404, not 500.

-- ----------------------------------------------------------------------------
-- R6  External client-role denial — the check the audit's P0-3 calls for.
-- ----------------------------------------------------------------------------
--   R6.1  GET {SUPA}/rest/v1/users?select=id&limit=1  with {ANON}
--          -> 401/403, or 200 with zero rows and a permission error.
--          NEVER 200 with rows.  A 200 with rows is a confirmed
--          disclosure and blocks the change.
--   R6.2  GET {SUPA}/rest/v1/documents?select=id&limit=1 with {ANON}
--          -> the same expectation.
--   R6.3  GET {SUPA}/rest/v1/exports?select=id&limit=1 with {ANON}
--          -> the same expectation.
--   R6.4  POST {SUPA}/rest/v1/documents with {ANON}
--          -> 401/403.  A 2xx would mean a write path is still open.
--   R6.5  DELETE {SUPA}/rest/v1/documents?id=eq.1 with {ANON}
--          -> 401/403.
--   R6.6  GET the unauthenticated object URL of a known document
--          -> 400/403/404, never the bytes.
--   R6.7  The same checks with a Supabase-Auth-derived token (the
--          `authenticated` role) -> the same expectation.

-- ----------------------------------------------------------------------------
-- R7  Security Advisor re-run.
-- ----------------------------------------------------------------------------
--   R7.1  The `function_search_path_mutable` finding should be CLEARED.
--   R7.2  The 12 `rls_enabled_no_policy` findings will PERSIST.  That is
--         the expected and intended outcome: RLS with no policy is
--         deny-by-default, and no client role can reach these tables.
--         Dismiss them with the justification text in section 5.3 of
--         docs/PHASE2B_SUPABASE_REMEDIATION_PLAN.md.
--         DO NOT add a permissive policy to make them disappear.

-- ----------------------------------------------------------------------------
-- R8  The change is only closed when all of the following are true.
-- ----------------------------------------------------------------------------
--   [ ] Section 1 reports no failures.
--   [ ] Section 2.2 (normalised fingerprint) is identical to the
--       pre-migration capture.
--   [ ] Section 2.4 (row counts) and 2.5 (content checksums) are
--       identical to the pre-migration capture.
--   [ ] Section 2.6 shows the same Storage object count and a private
--       bucket.
--   [ ] R1 through R6 all pass.
--   [ ] R7.1 shows the search_path finding cleared.
--   [ ] R7.2 is dismissed with a written justification.
--   [ ] The rollback has been rehearsed in a non-production project, and
--       the rehearsal output is attached to the change ticket.
--   [ ] A human has read all three SQL artifacts end to end.

-- ============================================================================
-- End of the verification runbook.  NOT EXECUTED.
-- ============================================================================
