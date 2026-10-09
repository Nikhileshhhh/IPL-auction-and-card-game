-- 010: profiles, administration roots, access gate, sessions and security tables.
-- Retention classes per docs/migration-manifest.md. Every table: RLS enabled
-- and forced, a backend-only policy for app_runtime, no browser grants.

-- ---------------------------------------------------------------- profiles (P)
CREATE TABLE app_private.profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  username text NOT NULL CHECK (username ~ '^[a-z0-9_]{3,24}$'),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 50),
  bio text CHECK (bio IS NULL OR char_length(bio) <= 240),
  avatar_asset_id uuid,
  visibility text NOT NULL DEFAULT 'members' CHECK (visibility IN ('members', 'friends', 'private')),
  activity_visible boolean NOT NULL DEFAULT true,
  suspended_until timestamptz,
  -- NULL until the member completes onboarding (S03); a temporary username is assigned at enrollment.
  onboarded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX profiles_username_uq ON app_private.profiles (lower(username));
CREATE INDEX profiles_username_prefix ON app_private.profiles (lower(username) text_pattern_ops);
CREATE TRIGGER profiles_touch BEFORE UPDATE ON app_private.profiles
  FOR EACH ROW EXECUTE FUNCTION app_private.touch_updated_at();

-- ------------------------------------------------------- admin_assignments (P)
-- Runtime can only READ assignments; assignment happens through the protected
-- operator script (scripts/bootstrap-admin) using migration credentials.
CREATE TABLE app_private.admin_assignments (
  user_id uuid PRIMARY KEY REFERENCES app_private.profiles (user_id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('super_admin', 'operator')),
  assigned_by uuid REFERENCES app_private.profiles (user_id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CHECK (assigned_by IS NULL OR assigned_by <> user_id)
);
CREATE INDEX admin_assignments_active ON app_private.admin_assignments (role) WHERE revoked_at IS NULL;
CREATE INDEX admin_assignments_assigned_by ON app_private.admin_assignments (assigned_by);

-- ---------------------------------------------------------------- app_config (P)
CREATE TABLE app_private.app_config (
  id smallint PRIMARY KEY CHECK (id = 1),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  gameplay_defaults jsonb NOT NULL DEFAULT '{}'::jsonb,
  limits jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid REFERENCES app_private.profiles (user_id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX app_config_updated_by ON app_private.app_config (updated_by);
INSERT INTO app_private.app_config (id) VALUES (1);

-- ------------------------------------------------------------- access_config (P)
-- Singleton. code_hash NULL means the gate is closed (fail closed) until an
-- operator sets the first code. Old hashes are overwritten, never retained.
CREATE TABLE app_private.access_config (
  id smallint PRIMARY KEY CHECK (id = 1),
  version bigint NOT NULL CHECK (version > 0),
  min_valid_version bigint NOT NULL CHECK (min_valid_version > 0),
  code_hash text,
  pepper_version integer NOT NULL DEFAULT 1 CHECK (pepper_version > 0),
  expires_at timestamptz,
  max_failures integer NOT NULL DEFAULT 3 CHECK (max_failures = 3),
  window_seconds integer NOT NULL DEFAULT 900 CHECK (window_seconds BETWEEN 60 AND 86400),
  lockout_seconds integer NOT NULL DEFAULT 900 CHECK (lockout_seconds BETWEEN 60 AND 86400),
  rotation_policy text NOT NULL DEFAULT 'REVOKE_EXISTING'
    CHECK (rotation_policy IN ('REVOKE_EXISTING', 'PRESERVE_EXISTING')),
  updated_by uuid REFERENCES app_private.profiles (user_id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (min_valid_version <= version)
);
CREATE INDEX access_config_updated_by ON app_private.access_config (updated_by);
INSERT INTO app_private.access_config (id, version, min_valid_version) VALUES (1, 1, 1);

-- ---------------------------------------------------------- access_attempts (S)
CREATE TABLE app_private.access_attempts (
  bucket_hash bytea PRIMARY KEY CHECK (octet_length(bucket_hash) = 32),
  kind text NOT NULL CHECK (kind IN ('cookie', 'user', 'ip', 'prefix', 'global')),
  window_started_at timestamptz NOT NULL,
  failures integer NOT NULL DEFAULT 0 CHECK (failures >= 0),
  locked_until timestamptz,
  expires_at timestamptz NOT NULL
);
CREATE INDEX access_attempts_expires ON app_private.access_attempts (expires_at);

-- --------------------------------------------------------------- gate_grants (S)
CREATE TABLE app_private.gate_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  token_ciphertext bytea NOT NULL,
  user_id uuid REFERENCES app_private.profiles (user_id) ON DELETE CASCADE,
  auth_session_id uuid,
  access_version bigint NOT NULL CHECK (access_version > 0),
  kind text NOT NULL CHECK (kind IN ('preauth', 'bound')),
  issued_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK ((kind = 'preauth' AND user_id IS NULL) OR (kind = 'bound' AND user_id IS NOT NULL)),
  CHECK (expires_at > issued_at)
);
CREATE INDEX gate_grants_expires ON app_private.gate_grants (expires_at);
CREATE INDEX gate_grants_user_version ON app_private.gate_grants (user_id, access_version);

-- -------------------------------------------------- access_request_receipts (S)
-- Durable admission idempotency (DB/realtime §11). Never stores the attempted code.
CREATE TABLE app_private.access_request_receipts (
  bucket_hash bytea NOT NULL REFERENCES app_private.access_attempts (bucket_hash) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('granted', 'rejected', 'locked')),
  response jsonb NOT NULL CHECK (octet_length(response::text) <= 4096),
  grant_id uuid REFERENCES app_private.gate_grants (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (bucket_hash, request_id)
);
CREATE INDEX access_request_receipts_expires ON app_private.access_request_receipts (expires_at);
CREATE INDEX access_request_receipts_grant ON app_private.access_request_receipts (grant_id);

-- -------------------------------------------------------- enrollment_invites (S)
CREATE TABLE app_private.enrollment_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_hash bytea NOT NULL CHECK (octet_length(email_hash) = 32),
  nonce_hash bytea NOT NULL UNIQUE CHECK (octet_length(nonce_hash) = 32),
  access_version bigint NOT NULL CHECK (access_version > 0),
  gate_grant_id uuid NOT NULL REFERENCES app_private.gate_grants (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CHECK (expires_at <= created_at + interval '1 hour')
);
CREATE UNIQUE INDEX enrollment_invites_pending_email ON app_private.enrollment_invites (email_hash)
  WHERE consumed_at IS NULL;
CREATE INDEX enrollment_invites_expires ON app_private.enrollment_invites (expires_at);
CREATE INDEX enrollment_invites_grant ON app_private.enrollment_invites (gate_grant_id);

-- -------------------------------------------------------------- app_sessions (S)
-- No refresh tokens here; Auth tokens live only in HttpOnly cookies on the BFF.
CREATE TABLE app_private.app_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_private.profiles (user_id) ON DELETE CASCADE,
  supabase_session_id uuid NOT NULL,
  gate_grant_id uuid REFERENCES app_private.gate_grants (id) ON DELETE SET NULL,
  scope text NOT NULL CHECK (scope IN ('member', 'admin')),
  aal smallint NOT NULL DEFAULT 1 CHECK (aal IN (1, 2)),
  step_up_at timestamptz,
  refresh_lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  UNIQUE (supabase_session_id, scope),
  CHECK (scope = 'admin' OR gate_grant_id IS NOT NULL OR revoked_at IS NOT NULL)
);
CREATE INDEX app_sessions_expires ON app_private.app_sessions (expires_at);
CREATE INDEX app_sessions_user ON app_private.app_sessions (user_id);
CREATE INDEX app_sessions_grant ON app_private.app_sessions (gate_grant_id);

-- ------------------------------------------------------------ socket_tickets (S)
CREATE TABLE app_private.socket_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  session_id uuid NOT NULL REFERENCES app_private.app_sessions (id) ON DELETE CASCADE,
  grant_id uuid NOT NULL REFERENCES app_private.gate_grants (id) ON DELETE CASCADE,
  origin text NOT NULL CHECK (char_length(origin) <= 255),
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CHECK (expires_at <= issued_at + interval '30 seconds')
);
CREATE INDEX socket_tickets_expires ON app_private.socket_tickets (expires_at);
CREATE INDEX socket_tickets_session ON app_private.socket_tickets (session_id);
CREATE INDEX socket_tickets_grant ON app_private.socket_tickets (grant_id);

-- ----------------------------------------------------------- request_receipts (S)
-- resource_id gains its FK to rooms (ON DELETE CASCADE) in migration 040.
CREATE TABLE app_private.request_receipts (
  actor_id uuid NOT NULL,
  command_id uuid NOT NULL,
  body_hash bytea NOT NULL CHECK (octet_length(body_hash) = 32),
  response jsonb NOT NULL CHECK (octet_length(response::text) <= 16384),
  resource_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (actor_id, command_id),
  CHECK (expires_at <= created_at + interval '24 hours')
);
CREATE INDEX request_receipts_expires ON app_private.request_receipts (expires_at);
CREATE INDEX request_receipts_resource ON app_private.request_receipts (resource_id);

-- ----------------------------------------------------------- security_events (O)
CREATE TABLE app_private.security_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_hash bytea,
  ip_hash bytea,
  reason text NOT NULL CHECK (char_length(reason) <= 64),
  severity text NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CHECK (expires_at <= occurred_at + interval '30 days')
);
CREATE INDEX security_events_expires ON app_private.security_events (expires_at);
CREATE INDEX security_events_time ON app_private.security_events (occurred_at, severity);

-- -------------------------------------------------------------- admin_audit (O)
CREATE TABLE app_private.admin_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES app_private.profiles (user_id) ON DELETE SET NULL,
  action text NOT NULL CHECK (char_length(action) <= 64),
  target_class text NOT NULL CHECK (char_length(target_class) <= 64),
  safe_diff jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (octet_length(safe_diff::text) <= 8192),
  request_hash text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_audit_time ON app_private.admin_audit (occurred_at, action);
CREATE INDEX admin_audit_actor ON app_private.admin_audit (actor_id);

-- ------------------------------------------------------------ runtime_leases (O)
CREATE TABLE app_private.runtime_leases (
  name text PRIMARY KEY CHECK (char_length(name) <= 64),
  owner_id uuid NOT NULL,
  generation bigint NOT NULL CHECK (generation >= 0),
  heartbeat_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX runtime_leases_expires ON app_private.runtime_leases (expires_at);

-- ------------------------------------------------------------- announcements (P)
CREATE TABLE app_private.announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 100),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  author_id uuid NOT NULL REFERENCES app_private.profiles (user_id) ON DELETE RESTRICT,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (starts_at < ends_at)
);
CREATE INDEX announcements_window ON app_private.announcements (starts_at, ends_at);
CREATE INDEX announcements_author ON app_private.announcements (author_id);

-- ------------------------------------------------------------------ security
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'profiles', 'admin_assignments', 'app_config', 'access_config', 'access_attempts',
    'gate_grants', 'access_request_receipts', 'enrollment_invites', 'app_sessions',
    'socket_tickets', 'request_receipts', 'security_events', 'admin_audit',
    'runtime_leases', 'announcements'
  ] LOOP
    EXECUTE format('ALTER TABLE app_private.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE app_private.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY backend_runtime ON app_private.%I TO app_runtime USING (true) WITH CHECK (true)', t);
  END LOOP;
END
$$;

GRANT SELECT, INSERT, UPDATE ON app_private.profiles TO app_runtime;
GRANT SELECT ON app_private.admin_assignments TO app_runtime;
GRANT SELECT, UPDATE ON app_private.app_config TO app_runtime;
GRANT SELECT, UPDATE ON app_private.access_config TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON app_private.access_attempts TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON app_private.gate_grants TO app_runtime;
GRANT SELECT, INSERT, DELETE ON app_private.access_request_receipts TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON app_private.enrollment_invites TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON app_private.app_sessions TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON app_private.socket_tickets TO app_runtime;
GRANT SELECT, INSERT, DELETE ON app_private.request_receipts TO app_runtime;
GRANT SELECT, INSERT, DELETE ON app_private.security_events TO app_runtime;
GRANT SELECT, INSERT, DELETE ON app_private.admin_audit TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON app_private.runtime_leases TO app_runtime;
GRANT SELECT, INSERT, UPDATE ON app_private.announcements TO app_runtime;
