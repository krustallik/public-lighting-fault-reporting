-- Shared fail-closed precondition for the one-shot production role creation.
-- Keep this file executable by both psql provisioning and the disposable
-- PostgreSQL collision integration test.
DO $$
DECLARE
  reserved_roles TEXT[] := ARRAY[
    'lighting_migrator', 'lighting_runtime', 'lighting_bootstrap'
  ];
  existing_roles TEXT[];
BEGIN
  IF session_user = ANY (reserved_roles) OR current_user = ANY (reserved_roles) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'Refusing role provisioning when the DBA identity is an application role';
  END IF;

  SELECT array_agg(rolname ORDER BY rolname)
    INTO existing_roles
    FROM pg_roles
   WHERE rolname = ANY (reserved_roles);

  IF COALESCE(cardinality(existing_roles), 0) > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = format(
        'Refusing initial provisioning because reserved application role(s) already exist: %s',
        array_to_string(existing_roles, ', ')
      ),
      HINT = 'Stop and investigate role provenance; do not adopt or mutate existing roles automatically.';
  END IF;
END
$$;
