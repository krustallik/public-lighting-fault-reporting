-- noinspection SqlDialectInspection
-- Admin refresh sessions (hashed token identifiers only)
CREATE TABLE IF NOT EXISTS admin_refresh_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id        INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
    token_hash      VARCHAR(255) NOT NULL,
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_refresh_sessions_admin ON admin_refresh_sessions (admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_refresh_sessions_hash ON admin_refresh_sessions (token_hash);

CREATE TABLE IF NOT EXISTS import_batches (
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

CREATE TABLE IF NOT EXISTS admin_activity_logs (
    id          SERIAL PRIMARY KEY,
    admin_id    INTEGER REFERENCES admins(id) ON DELETE SET NULL,
    action      VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50),
    entity_id   INTEGER,
    details     JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_activity_created ON admin_activity_logs (created_at DESC);
