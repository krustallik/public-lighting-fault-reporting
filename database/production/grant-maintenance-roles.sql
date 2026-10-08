-- Run as a controlled DBA after canonical migrations and application grants.
-- Current object names are an explicit allowlist: no default privileges are
-- granted, so future schema additions require deliberate review and reapply.
BEGIN;

DO $$
DECLARE
  application_roles TEXT[] := ARRAY[
    'lighting_migrator', 'lighting_runtime', 'lighting_bootstrap'
  ];
  maintenance_roles TEXT[] := ARRAY[
    'lighting_backup', 'lighting_retention'
  ];
  protected_roles TEXT[] := ARRAY[
    'lighting_migrator', 'lighting_runtime', 'lighting_bootstrap',
    'lighting_backup', 'lighting_retention'
  ];
  required_table TEXT;
  required_sequence TEXT;
  role_count INTEGER;
  current_database_oid OID;
BEGIN
  SELECT oid INTO current_database_oid FROM pg_database WHERE datname = current_database();

  IF session_user = ANY (protected_roles) OR current_user = ANY (protected_roles) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Refusing maintenance grants under an application or maintenance identity';
  END IF;

  SELECT count(*)
    INTO role_count
    FROM pg_roles
   WHERE rolname = ANY (application_roles)
     AND rolcanlogin
     AND NOT rolsuper
     AND NOT rolcreatedb
     AND NOT rolcreaterole
     AND NOT rolreplication
     AND NOT rolbypassrls
     AND NOT rolinherit;
  IF role_count <> cardinality(application_roles) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Application roles are missing or have unsafe attributes';
  END IF;

  SELECT count(*)
    INTO role_count
    FROM pg_roles
   WHERE rolname = ANY (maintenance_roles)
     AND rolcanlogin
     AND NOT rolsuper
     AND NOT rolcreatedb
     AND NOT rolcreaterole
     AND NOT rolreplication
     AND NOT rolbypassrls
     AND NOT rolinherit;
  IF role_count <> cardinality(maintenance_roles) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Maintenance roles are missing or have unsafe attributes';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_auth_members AS membership
      JOIN pg_roles AS granted_role ON granted_role.oid = membership.roleid
      JOIN pg_roles AS member_role ON member_role.oid = membership.member
     WHERE granted_role.rolname = ANY (protected_roles)
        OR member_role.rolname = ANY (protected_roles)
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Application and maintenance roles must have no role memberships in either direction';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_shdepend AS dependency
      JOIN pg_roles AS role ON role.oid = dependency.refobjid
     WHERE dependency.refclassid = 'pg_authid'::regclass
       AND dependency.deptype = 'o'
       AND role.rolname = ANY (maintenance_roles)
       AND (
         dependency.dbid = current_database_oid
         OR (dependency.dbid = 0 AND dependency.classid = 'pg_database'::regclass)
       )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Maintenance roles must not own database or schema objects';
  END IF;

  IF has_database_privilege('lighting_backup', current_database(), 'CREATE')
     OR has_database_privilege('lighting_retention', current_database(), 'CREATE')
     OR has_database_privilege('lighting_backup', current_database(), 'TEMP')
     OR has_database_privilege('lighting_retention', current_database(), 'TEMP')
     OR has_schema_privilege('lighting_backup', 'public', 'CREATE')
     OR has_schema_privilege('lighting_retention', 'public', 'CREATE') THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Maintenance identities have unexpected database or schema creation privileges';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_namespace AS namespace
     WHERE namespace.nspname NOT LIKE 'pg_temp_%'
       AND (
         has_schema_privilege('lighting_backup', namespace.oid, 'CREATE')
         OR has_schema_privilege('lighting_retention', namespace.oid, 'CREATE')
       )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Maintenance identities must not have CREATE on any schema';
  END IF;

  FOREACH required_table IN ARRAY ARRAY[
    'schema_migrations', 'light_points', 'admins', 'admin_refresh_sessions',
    'integration_logs', 'import_batches', 'admin_activity_logs',
    'import_batch_rows', 'inventory_audit_events'
  ] LOOP
    IF to_regclass(format('public.%I', required_table)) IS NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = format('Required maintenance-grant table is missing: public.%I', required_table),
        HINT = 'Review this allowlist against the canonical schema; do not silently omit an object.';
    END IF;
  END LOOP;

  FOREACH required_sequence IN ARRAY ARRAY[
    'light_points_id_seq', 'admins_id_seq', 'integration_logs_id_seq',
    'import_batches_id_seq', 'admin_activity_logs_id_seq',
    'import_batch_rows_id_seq', 'inventory_audit_events_id_seq'
  ] LOOP
    IF to_regclass(format('public.%I', required_sequence)) IS NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = format('Required maintenance-grant sequence is missing: public.%I', required_sequence),
        HINT = 'Review this allowlist against the canonical schema; do not silently omit an object.';
    END IF;
  END LOOP;
END
$$;

-- Reapplication clears direct table/sequence grants on current public objects
-- before restating the reviewed allowlist. No ALTER DEFAULT PRIVILEGES is used.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM lighting_backup, lighting_retention;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM lighting_backup, lighting_retention;

-- Clear any column-level grants too, including grants that table-level REVOKE
-- does not remove. This is limited to current tables in the public schema.
DO $$
DECLARE
  relation RECORD;
  column_list TEXT;
BEGIN
  FOR relation IN
    SELECT namespace.nspname, class.relname
      FROM pg_class AS class
      JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace
     WHERE namespace.nspname = 'public'
       AND class.relkind IN ('r', 'p', 'v', 'm', 'f')
  LOOP
    SELECT string_agg(format('%I', attribute.attname), ', ' ORDER BY attribute.attnum)
      INTO column_list
      FROM pg_attribute AS attribute
     WHERE attribute.attrelid = format('%I.%I', relation.nspname, relation.relname)::regclass
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped;

    IF column_list IS NOT NULL THEN
      EXECUTE format(
        'REVOKE ALL (%s) ON TABLE %I.%I FROM lighting_backup, lighting_retention',
        column_list, relation.nspname, relation.relname
      );
    END IF;
  END LOOP;
END
$$;

DO $$
DECLARE
  database_name TEXT := current_database();
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO lighting_backup, lighting_retention', database_name);
END
$$;

GRANT USAGE ON SCHEMA public TO lighting_backup, lighting_retention;

GRANT SELECT ON TABLE
  public.schema_migrations,
  public.light_points,
  public.admins,
  public.admin_refresh_sessions,
  public.integration_logs,
  public.import_batches,
  public.admin_activity_logs,
  public.import_batch_rows,
  public.inventory_audit_events
TO lighting_backup;

GRANT SELECT ON SEQUENCE
  public.light_points_id_seq,
  public.admins_id_seq,
  public.integration_logs_id_seq,
  public.import_batches_id_seq,
  public.admin_activity_logs_id_seq,
  public.import_batch_rows_id_seq,
  public.inventory_audit_events_id_seq
TO lighting_backup;

GRANT SELECT (id, created_at)
  ON TABLE public.admin_activity_logs TO lighting_retention;
GRANT SELECT (id, created_at, import_batch_id)
  ON TABLE public.inventory_audit_events TO lighting_retention;
GRANT SELECT (id, status, completed_at)
  ON TABLE public.import_batches TO lighting_retention;
GRANT SELECT (batch_id, outcome)
  ON TABLE public.import_batch_rows TO lighting_retention;
GRANT SELECT (id, expires_at)
  ON TABLE public.admin_refresh_sessions TO lighting_retention;

GRANT DELETE ON TABLE
  public.admin_activity_logs,
  public.inventory_audit_events,
  public.import_batches,
  public.admin_refresh_sessions
TO lighting_retention;

COMMIT;
