-- Public lighting fault reporting — database schema

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Street lighting points (map markers)
CREATE TABLE light_points (
    id              SERIAL PRIMARY KEY,
    external_id     VARCHAR(50),
    latitude        DECIMAL(10, 8) NOT NULL,
    longitude       DECIMAL(11, 8) NOT NULL,
    address         TEXT,
    address_geocoded_at TIMESTAMPTZ,
    district        VARCHAR(100),
    lamp_type       VARCHAR(100),
    status          VARCHAR(20) NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'inactive', 'maintenance')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_light_points_status ON light_points (status);
CREATE INDEX idx_light_points_coords ON light_points (latitude, longitude);

-- Admin users (authentication to be implemented later)
CREATE TABLE admins (
    id              SERIAL PRIMARY KEY,
    username        VARCHAR(100) NOT NULL UNIQUE,
    password_hash   VARCHAR(255) NOT NULL,
    full_name       VARCHAR(200),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Logs for external integrations (AUSEMIO / DPMK)
CREATE TABLE integration_logs (
    id              SERIAL PRIMARY KEY,
    reference_code  VARCHAR(100),
    integration_type VARCHAR(50) NOT NULL,
    request_payload JSONB,
    response_payload JSONB,
    status          VARCHAR(50) NOT NULL DEFAULT 'pending',
    error_message   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_integration_logs_type ON integration_logs (integration_type);
CREATE INDEX idx_integration_logs_created ON integration_logs (created_at DESC);

-- Admin refresh sessions (hashed refresh token identifiers only)
CREATE TABLE admin_refresh_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id        INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
    token_hash      VARCHAR(255) NOT NULL,
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_admin_refresh_sessions_admin ON admin_refresh_sessions (admin_id);
CREATE INDEX idx_admin_refresh_sessions_hash ON admin_refresh_sessions (token_hash);

CREATE TABLE import_batches (
    id                  SERIAL PRIMARY KEY,
    filename            VARCHAR(255) NOT NULL,
    uploaded_by_admin_id INTEGER REFERENCES admins(id) ON DELETE SET NULL,
    total_rows          INTEGER NOT NULL DEFAULT 0,
    created_rows        INTEGER NOT NULL DEFAULT 0,
    updated_rows        INTEGER NOT NULL DEFAULT 0,
    skipped_rows        INTEGER NOT NULL DEFAULT 0,
    failed_rows         INTEGER NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE admin_activity_logs (
    id          SERIAL PRIMARY KEY,
    admin_id    INTEGER REFERENCES admins(id) ON DELETE SET NULL,
    action      VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50),
    entity_id   INTEGER,
    details     JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_admin_activity_created ON admin_activity_logs (created_at DESC);
