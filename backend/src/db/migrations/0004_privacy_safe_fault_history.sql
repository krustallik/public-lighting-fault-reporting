-- Anonymous service-2 fault metadata for operator recurrence context.
-- Deliberately excludes contact details, free text, attachments, network data and OTP state.
CREATE TABLE fault_report_history (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  submitted_at TIMESTAMPTZ NOT NULL,
  service_code SMALLINT NOT NULL CHECK (service_code = 2),
  locality VARCHAR(100) NOT NULL,
  location_block_code VARCHAR(3),
  fault_type_code VARCHAR(3),
  target_kind VARCHAR(16) NOT NULL CHECK (target_kind IN ('light-point', 'custom', 'device', 'manual')),
  light_point_id INTEGER,
  target_geom geometry(Point, 4326),
  automatic_notes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  CHECK ((target_kind = 'light-point') = (light_point_id IS NOT NULL)),
  CHECK ((target_kind = 'manual') = (target_geom IS NULL)),
  CHECK (target_geom IS NULL OR (
    NOT ST_IsEmpty(target_geom)
    AND ST_SRID(target_geom) = 4326
    AND ST_X(target_geom) BETWEEN -180 AND 180
    AND ST_Y(target_geom) BETWEEN -90 AND 90
  ))
);

CREATE INDEX fault_report_history_point_time_idx
  ON fault_report_history (light_point_id, submitted_at DESC, id DESC)
  WHERE light_point_id IS NOT NULL;

CREATE INDEX fault_report_history_time_idx
  ON fault_report_history (submitted_at DESC, id DESC);
