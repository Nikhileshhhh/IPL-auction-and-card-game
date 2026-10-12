-- 060: auction setup — franchises, teams, pool, retentions (phase 09, ADR-024).
-- Class T tables cascade from rooms (DB spec §5.2). A room team row exists once
-- a member claims a franchise; the captain is set by the server. The pool is the
-- room's frozen copy of the ruleset's pool entries. auction_acquisitions is the
-- squad authority (UQ room/player); a deferred trigger keeps every team's purse
-- conserved: initial = retention charge + purchases + remaining.

-- Pool entry facts the room copies (catalog, immutable once the ruleset is published).
ALTER TABLE app_private.auction_pool_entries
  ADD COLUMN overseas boolean NOT NULL DEFAULT false,
  ADD COLUMN role text NOT NULL DEFAULT 'batter'
    CHECK (role IN ('batter', 'bowler', 'all_rounder', 'wicketkeeper')),
  ADD COLUMN current_salary bigint CHECK (current_salary IS NULL OR current_salary >= 0),
  ADD COLUMN price_source text NOT NULL DEFAULT 'registered'
    CHECK (price_source IN ('registered', 'not_registered', 'demo'));

CREATE TABLE app_private.auction_games (
  room_id uuid PRIMARY KEY REFERENCES app_private.rooms (id) ON DELETE CASCADE,
  ruleset_id uuid NOT NULL REFERENCES app_private.auction_rulesets (id) ON DELETE RESTRICT,
  rules_hash text NOT NULL CHECK (rules_hash ~ '^[0-9a-f]{64}$'),
  format text NOT NULL CHECK (format IN ('fresh', 'retention')),
  lowest_base_price bigint NOT NULL CHECK (lowest_base_price > 0),
  nomination_index integer NOT NULL DEFAULT 0 CHECK (nomination_index >= 0),
  pool_pass integer NOT NULL DEFAULT 1 CHECK (pool_pass BETWEEN 1 AND 2),
  active_nomination_id uuid,
  completed_nominations integer NOT NULL DEFAULT 0 CHECK (completed_nominations >= 0),
  pacing_deadline timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auction_games_ruleset ON app_private.auction_games (ruleset_id);

CREATE TABLE app_private.auction_franchises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES app_private.auction_games (room_id) ON DELETE CASCADE,
  franchise_id uuid NOT NULL REFERENCES app_private.franchises (id) ON DELETE RESTRICT,
  captain_member_id uuid NOT NULL,
  initial_purse bigint NOT NULL CHECK (initial_purse > 0),
  remaining_purse bigint NOT NULL,
  retention_charge bigint NOT NULL DEFAULT 0 CHECK (retention_charge >= 0),
  control_mode text NOT NULL DEFAULT 'manual' CHECK (control_mode IN ('manual', 'auto', 'observe')),
  control_epoch bigint NOT NULL DEFAULT 0 CHECK (control_epoch >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (room_id, franchise_id),
  UNIQUE (room_id, id),
  CHECK (remaining_purse >= 0 AND remaining_purse <= initial_purse),
  FOREIGN KEY (room_id, captain_member_id) REFERENCES app_private.room_members (room_id, id) ON DELETE RESTRICT
);
CREATE INDEX auction_franchises_franchise ON app_private.auction_franchises (franchise_id);
CREATE INDEX auction_franchises_captain ON app_private.auction_franchises (room_id, captain_member_id);
CREATE INDEX auction_franchises_control ON app_private.auction_franchises (room_id, control_mode);

CREATE TABLE app_private.franchise_members (
  room_id uuid NOT NULL,
  auction_franchise_id uuid NOT NULL,
  member_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('captain', 'cocaptain', 'bidder', 'advisor')),
  can_bid boolean NOT NULL DEFAULT false,
  can_invite boolean NOT NULL DEFAULT false,
  can_strategy boolean NOT NULL DEFAULT false,
  can_retain_propose boolean NOT NULL DEFAULT false,
  can_rtm boolean NOT NULL DEFAULT false,
  can_manage_limits boolean NOT NULL DEFAULT false,
  approved_at timestamptz NOT NULL DEFAULT now(),
  eligible_at_start boolean NOT NULL DEFAULT false,
  failover_order integer CHECK (failover_order IS NULL OR failover_order >= 0),
  PRIMARY KEY (auction_franchise_id, member_id),
  -- One team per member in a room (rules §9).
  UNIQUE (room_id, member_id),
  FOREIGN KEY (room_id, auction_franchise_id) REFERENCES app_private.auction_franchises (room_id, id) ON DELETE CASCADE,
  FOREIGN KEY (room_id, member_id) REFERENCES app_private.room_members (room_id, id) ON DELETE CASCADE,
  -- A captain holds every capability.
  CHECK (role <> 'captain' OR (can_bid AND can_invite AND can_strategy AND can_retain_propose AND can_rtm AND can_manage_limits))
);
CREATE UNIQUE INDEX franchise_members_one_captain ON app_private.franchise_members (auction_franchise_id)
  WHERE role = 'captain';
CREATE INDEX franchise_members_team ON app_private.franchise_members (room_id, auction_franchise_id);
CREATE INDEX franchise_members_member ON app_private.franchise_members (room_id, member_id);

CREATE TABLE app_private.franchise_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL,
  auction_franchise_id uuid NOT NULL,
  code_hash bytea NOT NULL UNIQUE CHECK (octet_length(code_hash) = 32),
  code_ciphertext bytea NOT NULL,
  auto_join_user_ids uuid[] NOT NULL DEFAULT '{}',
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- One active join code per team.
  UNIQUE (auction_franchise_id),
  FOREIGN KEY (room_id, auction_franchise_id) REFERENCES app_private.auction_franchises (room_id, id) ON DELETE CASCADE
);
CREATE INDEX franchise_invites_team ON app_private.franchise_invites (room_id, auction_franchise_id);

CREATE TABLE app_private.franchise_join_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL,
  auction_franchise_id uuid NOT NULL,
  member_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by uuid,
  UNIQUE (auction_franchise_id, member_id),
  CHECK ((status = 'pending') = (decided_at IS NULL)),
  FOREIGN KEY (room_id, auction_franchise_id) REFERENCES app_private.auction_franchises (room_id, id) ON DELETE CASCADE,
  FOREIGN KEY (room_id, member_id) REFERENCES app_private.room_members (room_id, id) ON DELETE CASCADE,
  FOREIGN KEY (room_id, decided_by) REFERENCES app_private.room_members (room_id, id) ON DELETE SET NULL (decided_by)
);
CREATE INDEX franchise_join_requests_status ON app_private.franchise_join_requests (auction_franchise_id, status);
CREATE INDEX franchise_join_requests_team ON app_private.franchise_join_requests (room_id, auction_franchise_id);
CREATE INDEX franchise_join_requests_member ON app_private.franchise_join_requests (room_id, member_id);
CREATE INDEX franchise_join_requests_decider ON app_private.franchise_join_requests (room_id, decided_by);

CREATE TABLE app_private.auction_pool (
  room_id uuid NOT NULL REFERENCES app_private.auction_games (room_id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES app_private.players (id) ON DELETE RESTRICT,
  base_price bigint NOT NULL CHECK (base_price > 0),
  previous_franchise_id uuid REFERENCES app_private.franchises (id) ON DELETE RESTRICT,
  capped_status text NOT NULL CHECK (capped_status IN ('capped', 'uncapped', 'unknown')),
  overseas boolean NOT NULL,
  role text NOT NULL CHECK (role IN ('batter', 'bowler', 'all_rounder', 'wicketkeeper')),
  current_salary bigint CHECK (current_salary IS NULL OR current_salary >= 0),
  set_label text NOT NULL CHECK (char_length(set_label) BETWEEN 1 AND 40),
  order_index integer NOT NULL CHECK (order_index >= 0),
  status text NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'retained', 'sold', 'unsold', 'skipped')),
  pass integer NOT NULL DEFAULT 1 CHECK (pass BETWEEN 1 AND 2),
  PRIMARY KEY (room_id, player_id),
  UNIQUE (room_id, order_index)
);
CREATE INDEX auction_pool_player ON app_private.auction_pool (player_id);
CREATE INDEX auction_pool_previous ON app_private.auction_pool (previous_franchise_id);

CREATE TABLE app_private.retention_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL,
  auction_franchise_id uuid NOT NULL,
  proposed_by uuid NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  players_and_allocations jsonb NOT NULL CHECK (jsonb_typeof(players_and_allocations) = 'array'),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'locked')),
  total_charge bigint NOT NULL CHECK (total_charge >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  -- One package per team, versioned in place; locking is final.
  UNIQUE (auction_franchise_id),
  CHECK ((status = 'locked') = (locked_at IS NOT NULL)),
  FOREIGN KEY (room_id, auction_franchise_id) REFERENCES app_private.auction_franchises (room_id, id) ON DELETE CASCADE,
  FOREIGN KEY (room_id, proposed_by) REFERENCES app_private.room_members (room_id, id) ON DELETE CASCADE
);
CREATE INDEX retention_packages_team ON app_private.retention_packages (room_id, auction_franchise_id);
CREATE INDEX retention_packages_proposer ON app_private.retention_packages (room_id, proposed_by);

CREATE TABLE app_private.auction_acquisitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL,
  player_id uuid NOT NULL,
  auction_franchise_id uuid NOT NULL,
  nomination_id uuid UNIQUE,
  kind text NOT NULL CHECK (kind IN ('retention', 'auction', 'rtm')),
  charged_price bigint NOT NULL CHECK (charged_price >= 0),
  allocation_price bigint CHECK (allocation_price IS NULL OR allocation_price >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- A player belongs to at most one team in a room.
  UNIQUE (room_id, player_id),
  FOREIGN KEY (room_id, player_id) REFERENCES app_private.auction_pool (room_id, player_id) ON DELETE CASCADE,
  FOREIGN KEY (room_id, auction_franchise_id) REFERENCES app_private.auction_franchises (room_id, id) ON DELETE CASCADE
);
CREATE INDEX auction_acquisitions_team ON app_private.auction_acquisitions (room_id, auction_franchise_id);

-- Purse conservation at commit (rules §1.4): initial = retention charge +
-- non-retention purchases + remaining, and the retention charge is exactly the
-- sum of retention acquisitions.
CREATE FUNCTION app_private.auction_purse_check() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  team_id uuid;
  f record;
  retained bigint;
  bought bigint;
BEGIN
  IF TG_TABLE_NAME = 'auction_franchises' THEN
    team_id := COALESCE(NEW.id, OLD.id);
  ELSE
    team_id := COALESCE(NEW.auction_franchise_id, OLD.auction_franchise_id);
  END IF;
  SELECT initial_purse, remaining_purse, retention_charge INTO f
    FROM app_private.auction_franchises WHERE id = team_id;
  IF NOT FOUND THEN
    RETURN NULL; -- the team is being removed with its room
  END IF;
  SELECT COALESCE(sum(charged_price) FILTER (WHERE kind = 'retention'), 0),
         COALESCE(sum(charged_price) FILTER (WHERE kind <> 'retention'), 0)
    INTO retained, bought
    FROM app_private.auction_acquisitions WHERE auction_franchise_id = team_id;
  IF retained <> f.retention_charge OR f.initial_purse <> retained + bought + f.remaining_purse THEN
    RAISE EXCEPTION 'purse not conserved for team %: initial % <> retained % + bought % + remaining %',
      team_id, f.initial_purse, retained, bought, f.remaining_purse
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;
CREATE CONSTRAINT TRIGGER auction_purse_acquisitions
  AFTER INSERT OR UPDATE OR DELETE ON app_private.auction_acquisitions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION app_private.auction_purse_check();
CREATE CONSTRAINT TRIGGER auction_purse_franchises
  AFTER INSERT OR UPDATE ON app_private.auction_franchises
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION app_private.auction_purse_check();

-- The captain pointer and the captain membership row agree at commit.
CREATE FUNCTION app_private.auction_captain_check() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  team_id uuid;
  pointer uuid;
  holder uuid;
BEGIN
  IF TG_TABLE_NAME = 'auction_franchises' THEN
    team_id := COALESCE(NEW.id, OLD.id);
  ELSE
    team_id := COALESCE(NEW.auction_franchise_id, OLD.auction_franchise_id);
  END IF;
  SELECT captain_member_id INTO pointer FROM app_private.auction_franchises WHERE id = team_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT member_id INTO holder FROM app_private.franchise_members
    WHERE auction_franchise_id = team_id AND role = 'captain';
  IF holder IS DISTINCT FROM pointer THEN
    RAISE EXCEPTION 'team % captain pointer % does not match captain membership %', team_id, pointer, holder
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;
CREATE CONSTRAINT TRIGGER auction_captain_members
  AFTER INSERT OR UPDATE OR DELETE ON app_private.franchise_members
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION app_private.auction_captain_check();
CREATE CONSTRAINT TRIGGER auction_captain_franchises
  AFTER INSERT OR UPDATE ON app_private.auction_franchises
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION app_private.auction_captain_check();

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['auction_games', 'auction_franchises', 'franchise_members', 'franchise_invites',
    'franchise_join_requests', 'auction_pool', 'retention_packages', 'auction_acquisitions'] LOOP
    EXECUTE format('ALTER TABLE app_private.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE app_private.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY backend_runtime ON app_private.%I TO app_runtime USING (true) WITH CHECK (true)', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON app_private.%I TO app_runtime', t);
  END LOOP;
END
$$;
