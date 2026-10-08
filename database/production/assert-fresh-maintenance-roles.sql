-- Fail closed before creating the reserved maintenance identities. This is
-- deliberately separate from the one-shot application-role provisioning.
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
  existing_maintenance_roles TEXT[];
  application_role_count INTEGER;
BEGIN
  IF session_user = ANY (protected_roles) OR current_user = ANY (protected_roles) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Refusing maintenance-role provisioning under an application or maintenance identity';
  END IF;

  SELECT array_agg(rolname ORDER BY rolname)
    INTO existing_maintenance_roles
    FROM pg_roles
   WHERE rolname = ANY (maintenance_roles);

  IF COALESCE(cardinality(existing_maintenance_roles), 0) > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = format(
        'Refusing maintenance-role provisioning because reserved name(s) already exist: %s',
        array_to_string(existing_maintenance_roles, ', ')
      ),
      HINT = 'Stop and investigate provenance; do not adopt, normalize, or mutate an existing role automatically.';
  END IF;

  SELECT count(*)
    INTO application_role_count
    FROM pg_roles
   WHERE rolname = ANY (application_roles)
     AND rolcanlogin
     AND NOT rolsuper
     AND NOT rolcreatedb
     AND NOT rolcreaterole
     AND NOT rolreplication
     AND NOT rolbypassrls
     AND NOT rolinherit;

  IF application_role_count <> cardinality(application_roles) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Application roles are missing or have unsafe attributes; refusing maintenance-role provisioning';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_auth_members AS membership
      JOIN pg_roles AS granted_role ON granted_role.oid = membership.roleid
      JOIN pg_roles AS member_role ON member_role.oid = membership.member
     WHERE granted_role.rolname = ANY (application_roles)
        OR member_role.rolname = ANY (application_roles)
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Application roles must not have role memberships before maintenance provisioning';
  END IF;
END
$$;
