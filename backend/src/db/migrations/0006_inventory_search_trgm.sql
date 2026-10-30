-- Speed up the existing server-side contains search used by the admin inventory.
-- The indexes were measured on a disposable PostGIS inventory of 20,000 synthetic points.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    RAISE EXCEPTION 'pg_trgm must be installed by a database administrator before migration 0006';
  END IF;
END
$$;

CREATE INDEX light_points_inventory_number_trgm_idx
  ON light_points USING GIN (inventory_number gin_trgm_ops);
CREATE INDEX light_points_external_id_trgm_idx
  ON light_points USING GIN (external_id gin_trgm_ops);
CREATE INDEX light_points_address_trgm_idx
  ON light_points USING GIN (address gin_trgm_ops);
CREATE INDEX light_points_district_trgm_idx
  ON light_points USING GIN (district gin_trgm_ops);
CREATE INDEX light_points_lamp_type_trgm_idx
  ON light_points USING GIN (lamp_type gin_trgm_ops);
