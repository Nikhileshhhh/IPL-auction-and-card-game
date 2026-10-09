-- 035: access gate, session and admin-MFA completion (phase 03).

-- Time-boxed TOTP enrollment window set by the operator bootstrap; an admin can
-- only enroll a first factor inside it, so a stolen password alone cannot
-- enroll an attacker's authenticator.
ALTER TABLE app_private.admin_assignments
  ADD COLUMN mfa_enrollment_until timestamptz;

-- Generic fixed-window counters for cheap pre-hash limits (login, enrollment
-- email, recovery, socket tickets, username checks). Bucket keys are HMACs;
-- no raw IPs or emails are stored (S/B, 24 h maximum).
CREATE TABLE app_private.rate_counters (
  bucket_hash bytea PRIMARY KEY CHECK (octet_length(bucket_hash) = 32),
  kind text NOT NULL CHECK (kind ~ '^[a-z_]{3,40}$'),
  window_started_at timestamptz NOT NULL,
  hits integer NOT NULL DEFAULT 0 CHECK (hits >= 0),
  expires_at timestamptz NOT NULL,
  CHECK (expires_at <= window_started_at + interval '24 hours')
);
CREATE INDEX rate_counters_expires ON app_private.rate_counters (expires_at);
ALTER TABLE app_private.rate_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.rate_counters FORCE ROW LEVEL SECURITY;
CREATE POLICY backend_runtime ON app_private.rate_counters TO app_runtime USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON app_private.rate_counters TO app_runtime;

-- Rotation audit needs the previous version only (never the old hash).
ALTER TABLE app_private.access_config
  ADD COLUMN rotated_at timestamptz;

-- TTL sweeps (security-cleanup job) scan by expiry; indexes exist from 010.
-- Grant expiry may never outlive the code that admitted it: enforced in code
-- (issue time) and re-checked on every verification.

-- The runtime may only close (or read) the MFA enrollment window after a
-- successful first verification; role assignment stays operator-only.
GRANT UPDATE (mfa_enrollment_until) ON app_private.admin_assignments TO app_runtime;
