-- P3 target schema. The runner performs the read-only UTF8/schema/data preflight first.
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE FUNCTION canonical_inventory_number(value text)
RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
AS $$
  SELECT normalize(
    btrim(value, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'),
    NFC
  )
$$;

ALTER TABLE light_points ADD COLUMN inventory_number TEXT;
ALTER TABLE light_points ADD COLUMN geom geometry(Point, 4326);

UPDATE light_points
   SET inventory_number = canonical_inventory_number(external_id::text),
       external_id = NULL,
       geom = ST_SetSRID(ST_MakePoint(longitude::double precision, latitude::double precision), 4326);

ALTER TABLE light_points ALTER COLUMN inventory_number SET NOT NULL;
ALTER TABLE light_points ALTER COLUMN geom SET NOT NULL;
ALTER TABLE light_points
  ADD CONSTRAINT light_points_inventory_number_canonical_check
  CHECK (
    inventory_number COLLATE "C" <> '' COLLATE "C"
    AND inventory_number IS NFC NORMALIZED
    AND inventory_number COLLATE "C" = canonical_inventory_number(inventory_number) COLLATE "C"
  );
ALTER TABLE light_points
  ADD CONSTRAINT light_points_geom_valid_check
  CHECK (
    NOT ST_IsEmpty(geom)
    AND ST_X(geom) BETWEEN -180 AND 180
    AND ST_Y(geom) BETWEEN -90 AND 90
  );
CREATE UNIQUE INDEX light_points_inventory_number_c_idx
  ON light_points (inventory_number COLLATE "C");
CREATE INDEX light_points_geom_gist_idx ON light_points USING GIST (geom);

DROP INDEX IF EXISTS idx_light_points_coords;
ALTER TABLE light_points DROP COLUMN latitude;
ALTER TABLE light_points DROP COLUMN longitude;

ALTER TABLE import_batches
  ADD COLUMN status VARCHAR(24) NOT NULL DEFAULT 'completed'
    CHECK (status IN ('preview', 'queued', 'processing', 'completed', 'completed_with_errors', 'failed', 'system_failed')),
  ADD COLUMN uploaded_by_username_snapshot VARCHAR(80),
  ADD COLUMN update_existing BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN successful_rows INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN applied_rows INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN unchanged_rows INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN queued_at TIMESTAMPTZ,
  ADD COLUMN preview_expires_at TIMESTAMPTZ,
  ADD COLUMN started_at TIMESTAMPTZ,
  ADD COLUMN completed_at TIMESTAMPTZ,
  ADD COLUMN lease_until TIMESTAMPTZ,
  ADD COLUMN worker_token UUID,
  ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN confirmation_key UUID;

UPDATE import_batches
   SET queued_at = created_at,
       completed_at = created_at,
       successful_rows = created_rows + updated_rows,
       applied_rows = created_rows + updated_rows,
       unchanged_rows = 0;

CREATE UNIQUE INDEX import_batches_confirmation_key_uq
  ON import_batches (confirmation_key) WHERE confirmation_key IS NOT NULL;
CREATE INDEX import_batches_queue_order_idx ON import_batches (queued_at, id) WHERE status IN ('queued', 'processing');
CREATE UNIQUE INDEX import_batches_single_processing_uq ON import_batches ((status)) WHERE status = 'processing';

CREATE TABLE import_batch_rows (
  id BIGSERIAL PRIMARY KEY,
  batch_id INTEGER NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  source_row_number INTEGER NOT NULL CHECK (source_row_number > 0),
  inventory_number TEXT,
  outcome VARCHAR(20) NOT NULL CHECK (outcome IN ('pending', 'created', 'updated', 'unchanged', 'skipped', 'failed')),
  preview_action VARCHAR(20) CHECK (preview_action IN ('create', 'update', 'unchanged', 'skip', 'error')),
  preview_existing_id INTEGER,
  entity_id INTEGER,
  reason_code VARCHAR(80),
  safe_reason TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (batch_id, source_row_number),
  CHECK ((outcome = 'pending' AND payload IS NOT NULL) OR (outcome <> 'pending' AND payload IS NULL))
);
CREATE INDEX import_batch_rows_batch_outcome_idx ON import_batch_rows (batch_id, outcome, source_row_number);

CREATE TABLE inventory_audit_events (
  id BIGSERIAL PRIMARY KEY,
  actor_admin_id INTEGER REFERENCES admins(id) ON DELETE SET NULL,
  actor_username_snapshot VARCHAR(80),
  entity_id_snapshot INTEGER NOT NULL,
  inventory_number_snapshot TEXT NOT NULL,
  action VARCHAR(20) NOT NULL CHECK (action IN ('create', 'update', 'delete')),
  import_batch_id INTEGER REFERENCES import_batches(id) ON DELETE SET NULL,
  changed_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX inventory_audit_events_created_idx ON inventory_audit_events (created_at DESC, id DESC);
CREATE INDEX inventory_audit_events_entity_idx ON inventory_audit_events (entity_id_snapshot, created_at DESC);
