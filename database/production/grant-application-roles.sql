-- Run as the DBA after the current canonical migrations. Re-run after future
-- schema changes so runtime grants remain an explicit, reviewed allowlist.
BEGIN;

DO $$
DECLARE
  relation_name TEXT;
  sequence_name TEXT;
  database_name TEXT := current_database();
  reserved_roles TEXT[] := ARRAY[
    'lighting_migrator', 'lighting_runtime', 'lighting_bootstrap'
  ];
  application_role_count INTEGER;
BEGIN
  IF session_user = ANY (reserved_roles) OR current_user = ANY (reserved_roles) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Refusing to apply application grants while connected as an application role';
  END IF;

  SELECT count(*)
    INTO application_role_count
    FROM pg_roles
   WHERE rolname = ANY (reserved_roles)
     AND rolcanlogin
     AND NOT rolsuper
     AND NOT rolcreatedb
     AND NOT rolcreaterole
     AND NOT rolreplication
     AND NOT rolbypassrls
     AND NOT rolinherit;

  IF application_role_count <> cardinality(reserved_roles) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Application roles are missing or have unsafe role-level attributes';
  END IF;

  -- Reject membership in either direction. The member direction is the
  -- privilege-escalation boundary: NOINHERIT does not prevent SET ROLE.
  IF EXISTS (
    SELECT 1
      FROM pg_auth_members AS membership
      JOIN pg_roles AS granted_role ON granted_role.oid = membership.roleid
      JOIN pg_roles AS member_role ON member_role.oid = membership.member
     WHERE granted_role.rolname = ANY (reserved_roles)
        OR member_role.rolname = ANY (reserved_roles)
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Application roles must not have role memberships';
  END IF;

  EXECUTE format('GRANT CONNECT ON DATABASE %I TO lighting_migrator, lighting_runtime, lighting_bootstrap', database_name);
  EXECUTE format('REVOKE CREATE, TEMPORARY ON DATABASE %I FROM PUBLIC, lighting_runtime, lighting_bootstrap', database_name);
  REVOKE CREATE ON SCHEMA public FROM PUBLIC;
  REVOKE CREATE ON SCHEMA public FROM lighting_runtime, lighting_bootstrap;
  GRANT USAGE, CREATE ON SCHEMA public TO lighting_migrator;
  GRANT USAGE ON SCHEMA public TO lighting_runtime, lighting_bootstrap;

  FOREACH relation_name IN ARRAY ARRAY[
    'schema_migrations', 'light_points', 'admins', 'admin_refresh_sessions',
    'integration_logs', 'import_batches', 'admin_activity_logs',
    'import_batch_rows', 'inventory_audit_events'
  ] LOOP
    IF to_regclass(format('public.%I', relation_name)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I OWNER TO lighting_migrator', relation_name);
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', relation_name);
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM lighting_runtime, lighting_bootstrap', relation_name);
    END IF;
  END LOOP;

  FOREACH sequence_name IN ARRAY ARRAY[
    'light_points_id_seq', 'admins_id_seq', 'integration_logs_id_seq',
    'import_batches_id_seq', 'admin_activity_logs_id_seq',
    'import_batch_rows_id_seq', 'inventory_audit_events_id_seq'
  ] LOOP
    IF to_regclass(format('public.%I', sequence_name)) IS NOT NULL THEN
      EXECUTE format('ALTER SEQUENCE public.%I OWNER TO lighting_migrator', sequence_name);
      EXECUTE format('REVOKE ALL ON SEQUENCE public.%I FROM PUBLIC', sequence_name);
      EXECUTE format('REVOKE ALL ON SEQUENCE public.%I FROM lighting_runtime, lighting_bootstrap', sequence_name);
    END IF;
  END LOOP;

  IF to_regprocedure('public.canonical_inventory_number(text)') IS NOT NULL THEN
    ALTER FUNCTION public.canonical_inventory_number(text) OWNER TO lighting_migrator;
  END IF;

  IF to_regclass('public.schema_migrations') IS NOT NULL THEN
    GRANT SELECT ON TABLE public.schema_migrations TO lighting_runtime;
  END IF;

  IF to_regclass('public.light_points') IS NOT NULL THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.light_points TO lighting_runtime;
    GRANT USAGE, SELECT ON SEQUENCE public.light_points_id_seq TO lighting_runtime;
  END IF;
  IF to_regclass('public.admins') IS NOT NULL THEN
    REVOKE SELECT (id, username, password_hash, full_name, is_active) ON TABLE public.admins FROM lighting_runtime;
    REVOKE SELECT (id) ON TABLE public.admins FROM lighting_bootstrap;
    REVOKE INSERT (username, password_hash, full_name) ON TABLE public.admins FROM lighting_bootstrap;
    GRANT SELECT (id, username, password_hash, full_name, is_active) ON TABLE public.admins TO lighting_runtime;
    GRANT SELECT (id) ON TABLE public.admins TO lighting_bootstrap;
    GRANT INSERT (username, password_hash, full_name) ON TABLE public.admins TO lighting_bootstrap;
    GRANT USAGE ON SEQUENCE public.admins_id_seq TO lighting_bootstrap;
  END IF;
  IF to_regclass('public.admin_refresh_sessions') IS NOT NULL THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.admin_refresh_sessions TO lighting_runtime;
  END IF;
  IF to_regclass('public.integration_logs') IS NOT NULL THEN
    GRANT SELECT ON TABLE public.integration_logs TO lighting_runtime;
  END IF;
  IF to_regclass('public.import_batches') IS NOT NULL THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.import_batches TO lighting_runtime;
    GRANT USAGE, SELECT ON SEQUENCE public.import_batches_id_seq TO lighting_runtime;
  END IF;
  IF to_regclass('public.import_batch_rows') IS NOT NULL THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.import_batch_rows TO lighting_runtime;
    GRANT USAGE, SELECT ON SEQUENCE public.import_batch_rows_id_seq TO lighting_runtime;
  END IF;
  IF to_regclass('public.admin_activity_logs') IS NOT NULL THEN
    REVOKE INSERT (admin_id, action, entity_type, entity_id, details) ON TABLE public.admin_activity_logs FROM lighting_bootstrap;
    GRANT SELECT, INSERT ON TABLE public.admin_activity_logs TO lighting_runtime;
    GRANT USAGE, SELECT ON SEQUENCE public.admin_activity_logs_id_seq TO lighting_runtime;
    GRANT INSERT (admin_id, action, entity_type, entity_id, details) ON TABLE public.admin_activity_logs TO lighting_bootstrap;
    GRANT USAGE ON SEQUENCE public.admin_activity_logs_id_seq TO lighting_bootstrap;
  END IF;
  IF to_regclass('public.inventory_audit_events') IS NOT NULL THEN
    GRANT SELECT, INSERT ON TABLE public.inventory_audit_events TO lighting_runtime;
    GRANT USAGE, SELECT ON SEQUENCE public.inventory_audit_events_id_seq TO lighting_runtime;
  END IF;
END
$$;

COMMIT;
