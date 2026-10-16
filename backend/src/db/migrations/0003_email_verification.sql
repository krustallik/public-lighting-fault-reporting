-- Short-lived, one-time email verification state for the public report flow.
-- Email addresses, OTPs, and verification capabilities are stored only as keyed digests.
CREATE TABLE email_verification_challenges (
    intent_id UUID PRIMARY KEY,
    email_digest BYTEA NOT NULL CHECK (octet_length(email_digest) = 32),
    otp_digest BYTEA NOT NULL CHECK (octet_length(otp_digest) = 32),
    verification_token_digest BYTEA CHECK (
        verification_token_digest IS NULL OR octet_length(verification_token_digest) = 32
    ),
    attempt_count SMALLINT NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 5),
    send_count SMALLINT NOT NULL DEFAULT 1 CHECK (send_count BETWEEN 1 AND 3),
    last_sent_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    expires_at TIMESTAMPTZ NOT NULL,
    verified_at TIMESTAMPTZ,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CHECK ((verified_at IS NULL) = (verification_token_digest IS NULL)),
    CHECK (consumed_at IS NULL OR verified_at IS NOT NULL)
);

CREATE INDEX email_verification_challenges_expiry_idx
    ON email_verification_challenges (expires_at);

CREATE INDEX email_verification_challenges_email_idx
    ON email_verification_challenges (email_digest, created_at DESC);

-- Distributed fixed-window counters use keyed digests so neither raw email nor IP is retained.
CREATE TABLE email_verification_rate_limits (
    scope TEXT NOT NULL CHECK (scope IN ('send_email', 'send_ip', 'verify_email', 'verify_ip')),
    key_digest BYTEA NOT NULL CHECK (octet_length(key_digest) = 32),
    window_started_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    attempt_count INTEGER NOT NULL CHECK (attempt_count > 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (scope, key_digest)
);

CREATE INDEX email_verification_rate_limits_updated_idx
    ON email_verification_rate_limits (updated_at);
