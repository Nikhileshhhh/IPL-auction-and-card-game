-- DEV/TEST ONLY (ADR-016). Never part of supabase/migrations and never applied
-- to staging/production. Storage for LocalAuthProvider, mirroring the parts of
-- Supabase Auth (GoTrue) the application relies on.
CREATE SCHEMA IF NOT EXISTS auth_local;
REVOKE ALL ON SCHEMA auth_local FROM PUBLIC;

CREATE TABLE IF NOT EXISTS auth_local.credentials (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth_local.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  aal smallint NOT NULL DEFAULT 1 CHECK (aal IN (1, 2)),
  refresh_hash bytea NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS auth_local_sessions_user ON auth_local.sessions (user_id);

CREATE TABLE IF NOT EXISTS auth_local.one_time_tokens (
  token_hash bytea PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('invite', 'recovery')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
CREATE INDEX IF NOT EXISTS auth_local_ott_user ON auth_local.one_time_tokens (user_id);

CREATE TABLE IF NOT EXISTS auth_local.mfa_factors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  secret text NOT NULL,
  status text NOT NULL CHECK (status IN ('unverified', 'verified')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_local_factors_user ON auth_local.mfa_factors (user_id);

CREATE TABLE IF NOT EXISTS auth_local.mfa_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factor_id uuid NOT NULL REFERENCES auth_local.mfa_factors (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  verified_at timestamptz
);
CREATE INDEX IF NOT EXISTS auth_local_challenges_factor ON auth_local.mfa_challenges (factor_id);

-- Dev mailbox: what a real SMTP provider would have delivered.
CREATE TABLE IF NOT EXISTS auth_local.outbox (
  id bigserial PRIMARY KEY,
  email text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('invite', 'recovery')),
  link text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT USAGE ON SCHEMA auth_local TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA auth_local TO app_runtime;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA auth_local TO app_runtime;
-- Local stand-in for GoTrue's own writes to auth.users.
GRANT USAGE ON SCHEMA auth TO app_runtime;
GRANT SELECT, INSERT, UPDATE ON auth.users TO app_runtime;
