-- 040: temporary room scope (class T): rooms, membership, connections,
-- command receipts, audience streams, transactional outbox and deadlines.
-- Every T table cascades from rooms; same-room references use composite
-- (room_id, id) foreign keys so a row can never point into another room.

CREATE TABLE app_private.rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_type text NOT NULL CHECK (game_type IN ('card', 'auction')),
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 64),
  host_user_id uuid NOT NULL REFERENCES app_private.profiles (user_id) ON DELETE RESTRICT,
  lifecycle text NOT NULL DEFAULT 'LOBBY'
    CHECK (lifecycle IN ('LOBBY', 'RUNNING', 'FINALIZING', 'RESULTS', 'PURGING', 'ABORTED')),
  phase text NOT NULL DEFAULT 'LOBBY' CHECK (char_length(phase) BETWEEN 1 AND 40),
  settings jsonb NOT NULL CHECK (jsonb_typeof(settings) = 'object' AND octet_length(settings::text) <= 8192),
  max_members integer NOT NULL CHECK (max_members BETWEEN 2 AND 60),
  results_ttl_seconds integer NOT NULL DEFAULT 120 CHECK (results_ttl_seconds BETWEEN 30 AND 300),
  saved_phase jsonb,
  match_deadline timestamptz,
  hard_deadline timestamptz,
  last_healthy_at timestamptz NOT NULL DEFAULT now(),
  pause_count integer NOT NULL DEFAULT 0 CHECK (pause_count >= 0),
  vote_failures integer NOT NULL DEFAULT 0 CHECK (vote_failures BETWEEN 0 AND 3),
  last_vote_resolved_at timestamptz,
  config_version bigint NOT NULL DEFAULT 1 CHECK (config_version > 0),
  state_version bigint NOT NULL DEFAULT 0 CHECK (state_version >= 0),
  code_hash bytea NOT NULL UNIQUE CHECK (octet_length(code_hash) = 32),
  code_ciphertext bytea NOT NULL,
  password_hash text,
  ruleset_id uuid REFERENCES app_private.auction_rulesets (id) ON DELETE RESTRICT,
  data_version_id uuid REFERENCES app_private.data_versions (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  started_at timestamptz,
  result_expires_at timestamptz,
  generation bigint NOT NULL DEFAULT 0 CHECK (generation >= 0),
  award_batch uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  seed_commitment text,
  seed_ciphertext bytea,
  finalized_at timestamptz,
  CHECK (lifecycle = 'LOBBY' OR started_at IS NOT NULL),
  CHECK (lifecycle IN ('LOBBY', 'ABORTED') OR data_version_id IS NOT NULL)
);
CREATE INDEX rooms_lifecycle_expiry ON app_private.rooms (lifecycle, expires_at);
CREATE INDEX rooms_host ON app_private.rooms (host_user_id);
CREATE INDEX rooms_ruleset ON app_private.rooms (ruleset_id);
CREATE INDEX rooms_data_version ON app_private.rooms (data_version_id);

CREATE TABLE app_private.room_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES app_private.rooms (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_private.profiles (user_id) ON DELETE CASCADE,
  seat integer CHECK (seat IS NULL OR seat >= 0),
  role text NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'spectator')),
  ready boolean NOT NULL DEFAULT false,
  approved_at timestamptz NOT NULL DEFAULT now(),
  joined_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz,
  participation_ms bigint NOT NULL DEFAULT 0 CHECK (participation_ms >= 0),
  participation_opened_at timestamptz,
  participation_closed_at timestamptz,
  eligible_at_start boolean NOT NULL DEFAULT false,
  control_epoch bigint NOT NULL DEFAULT 1 CHECK (control_epoch > 0),
  UNIQUE (room_id, user_id),
  UNIQUE (room_id, id),
  CHECK (role = 'player' OR (seat IS NULL AND ready = false))
);
CREATE UNIQUE INDEX room_members_seat ON app_private.room_members (room_id, seat) WHERE seat IS NOT NULL;
CREATE INDEX room_members_user ON app_private.room_members (user_id);
CREATE INDEX room_members_left ON app_private.room_members (room_id, left_at);

CREATE TABLE app_private.room_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES app_private.rooms (id) ON DELETE CASCADE,
  inviter_id uuid NOT NULL REFERENCES app_private.profiles (user_id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES app_private.profiles (user_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  UNIQUE (room_id, recipient_id),
  CHECK (inviter_id <> recipient_id)
);
CREATE INDEX room_invites_recipient ON app_private.room_invites (recipient_id, expires_at);
CREATE INDEX room_invites_inviter ON app_private.room_invites (inviter_id);

CREATE TABLE app_private.room_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES app_private.rooms (id) ON DELETE CASCADE,
  member_id uuid NOT NULL,
  socket_id text NOT NULL UNIQUE CHECK (char_length(socket_id) <= 64),
  instance_id uuid NOT NULL,
  last_heartbeat_at timestamptz NOT NULL DEFAULT now(),
  is_controller boolean NOT NULL DEFAULT false,
  lease_epoch bigint NOT NULL DEFAULT 1,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (room_id, member_id) REFERENCES app_private.room_members (room_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX room_connections_one_controller ON app_private.room_connections (member_id) WHERE is_controller;
CREATE INDEX room_connections_member ON app_private.room_connections (room_id, member_id);
CREATE INDEX room_connections_expires ON app_private.room_connections (expires_at);

CREATE TABLE app_private.room_commands (
  room_id uuid NOT NULL REFERENCES app_private.rooms (id) ON DELETE CASCADE,
  actor_key text NOT NULL CHECK (char_length(actor_key) BETWEEN 1 AND 80),
  command_id uuid NOT NULL,
  body_hash bytea NOT NULL CHECK (octet_length(body_hash) = 32),
  response jsonb NOT NULL CHECK (octet_length(response::text) <= 16384),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, actor_key, command_id)
);
CREATE INDEX room_commands_created ON app_private.room_commands (created_at);

CREATE TABLE app_private.room_streams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES app_private.rooms (id) ON DELETE CASCADE,
  audience_kind text NOT NULL CHECK (audience_kind IN ('public', 'team', 'member')),
  audience_id uuid,
  seq bigint NOT NULL DEFAULT 0 CHECK (seq >= 0),
  UNIQUE NULLS NOT DISTINCT (room_id, audience_kind, audience_id),
  UNIQUE (room_id, id),
  CHECK ((audience_kind = 'public') = (audience_id IS NULL))
);

CREATE TABLE app_private.room_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Monotonic dispatch order across streams; per-stream order is (stream_id, seq).
  position bigserial NOT NULL UNIQUE,
  room_id uuid NOT NULL REFERENCES app_private.rooms (id) ON DELETE CASCADE,
  stream_id uuid NOT NULL,
  seq bigint NOT NULL CHECK (seq > 0),
  state_version bigint NOT NULL CHECK (state_version >= 0),
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  type text NOT NULL CHECK (type ~ '^[a-z]+(\.[a-zA-Z]+)+$'),
  payload jsonb NOT NULL CHECK (octet_length(payload::text) <= 65536),
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  retry_at timestamptz,
  UNIQUE (stream_id, seq),
  FOREIGN KEY (room_id, stream_id) REFERENCES app_private.room_streams (room_id, id) ON DELETE CASCADE
);
CREATE INDEX room_events_room_stream ON app_private.room_events (room_id, stream_id);
CREATE INDEX room_events_unpublished ON app_private.room_events (position) WHERE published_at IS NULL;

CREATE TABLE app_private.deadline_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES app_private.rooms (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind ~ '^[a-z]+(\.[a-z_]+)+$'),
  subject_id uuid,
  generation bigint NOT NULL CHECK (generation >= 0),
  due_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error_code text,
  UNIQUE NULLS NOT DISTINCT (room_id, kind, subject_id, generation)
);
CREATE INDEX deadline_jobs_due ON app_private.deadline_jobs (due_at);

CREATE TABLE app_private.host_handovers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES app_private.rooms (id) ON DELETE CASCADE,
  from_member_id uuid NOT NULL,
  to_member_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CHECK (from_member_id <> to_member_id),
  CHECK (expires_at <= created_at + interval '60 seconds'),
  FOREIGN KEY (room_id, from_member_id) REFERENCES app_private.room_members (room_id, id) ON DELETE CASCADE,
  FOREIGN KEY (room_id, to_member_id) REFERENCES app_private.room_members (room_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX host_handovers_one_pending ON app_private.host_handovers (room_id) WHERE status = 'pending';
CREATE INDEX host_handovers_from ON app_private.host_handovers (room_id, from_member_id);
CREATE INDEX host_handovers_to ON app_private.host_handovers (room_id, to_member_id);

-- Non-room receipts that created a room keep only a pointer and vanish with it.
ALTER TABLE app_private.request_receipts
  ADD CONSTRAINT request_receipts_room_fk FOREIGN KEY (resource_id)
  REFERENCES app_private.rooms (id) ON DELETE CASCADE;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['rooms', 'room_members', 'room_invites', 'room_connections', 'room_commands',
    'room_streams', 'room_events', 'deadline_jobs', 'host_handovers'] LOOP
    EXECUTE format('ALTER TABLE app_private.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE app_private.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY backend_runtime ON app_private.%I TO app_runtime USING (true) WITH CHECK (true)', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON app_private.%I TO app_runtime', t);
  END LOOP;
END
$$;
GRANT USAGE ON SEQUENCE app_private.room_events_position_seq TO app_runtime;
