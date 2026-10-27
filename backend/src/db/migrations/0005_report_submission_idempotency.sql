-- Short-lived opaque retry receipts. The permanent history remains metadata-only.
CREATE TABLE report_submission_attempts (
  attempt_id UUID PRIMARY KEY,
  history_id BIGINT NOT NULL UNIQUE REFERENCES fault_report_history(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (statement_timestamp() + interval '30 days'),
  CHECK (expires_at = created_at + interval '30 days')
);

CREATE INDEX report_submission_attempts_expiry_idx
  ON report_submission_attempts (expires_at, attempt_id);
