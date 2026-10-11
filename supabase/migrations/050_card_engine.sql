-- 050: authoritative card engine (class T, cascades from rooms; DB spec §5.2).
-- card_instances is the sole location authority: every dealt card is in exactly
-- one of DECK / ACTIVE / POT, and a deferred trigger checks at commit that each
-- room still holds exactly total_cards instances. Contributions are history only.

CREATE TABLE app_private.card_games (
  room_id uuid PRIMARY KEY REFERENCES app_private.rooms (id) ON DELETE CASCADE,
  total_cards integer NOT NULL CHECK (total_cards BETWEEN 8 AND 240),
  tie_cap integer NOT NULL CHECK (tie_cap BETWEEN 4 AND 30),
  deal_mode text NOT NULL CHECK (deal_mode IN ('stratified', 'random')),
  selector_member_id uuid,
  chain_selector_id uuid,
  chain_index integer NOT NULL DEFAULT 0 CHECK (chain_index >= -1),
  comparison_index integer NOT NULL DEFAULT -1 CHECK (comparison_index >= -1),
  tie_count integer NOT NULL DEFAULT 0 CHECK (tie_count >= 0),
  tied_member_ids uuid[] NOT NULL DEFAULT '{}',
  allowed_metrics text[] NOT NULL,
  phase_deadline timestamptz,
  timer_generation bigint NOT NULL DEFAULT 0 CHECK (timer_generation >= 0),
  finish_pending boolean NOT NULL DEFAULT false,
  rng_version text NOT NULL CHECK (char_length(rng_version) BETWEEN 1 AND 40),
  rng_draws jsonb NOT NULL DEFAULT '{}',
  room_nonce text NOT NULL CHECK (char_length(room_nonce) BETWEEN 8 AND 128),
  config_hash text NOT NULL CHECK (config_hash ~ '^[0-9a-f]{64}$'),
  fallback_order uuid[] NOT NULL,
  completed_contests integer NOT NULL DEFAULT 0 CHECK (completed_contests >= 0),
  eliminations integer NOT NULL DEFAULT 0 CHECK (eliminations >= 0),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (room_id, selector_member_id) REFERENCES app_private.room_members (room_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (room_id, chain_selector_id) REFERENCES app_private.room_members (room_id, id) ON DELETE RESTRICT
);
CREATE INDEX card_games_selector ON app_private.card_games (room_id, selector_member_id);
CREATE INDEX card_games_chain_selector ON app_private.card_games (room_id, chain_selector_id);

CREATE TABLE app_private.card_seats (
  room_id uuid NOT NULL REFERENCES app_private.card_games (room_id) ON DELETE CASCADE,
  member_id uuid NOT NULL,
  seat_order integer NOT NULL CHECK (seat_order BETWEEN 0 AND 7),
  eliminated_chain integer,
  elimination_order integer CHECK (elimination_order IS NULL OR elimination_order >= 1),
  chain_start_count integer NOT NULL DEFAULT 0 CHECK (chain_start_count >= 0),
  contests_won integer NOT NULL DEFAULT 0 CHECK (contests_won >= 0),
  next_tail_ordinal bigint NOT NULL DEFAULT 0 CHECK (next_tail_ordinal >= 0),
  PRIMARY KEY (room_id, member_id),
  UNIQUE (room_id, seat_order),
  FOREIGN KEY (room_id, member_id) REFERENCES app_private.room_members (room_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX card_seats_elimination_order ON app_private.card_seats (room_id, elimination_order)
  WHERE elimination_order IS NOT NULL;

CREATE TABLE app_private.card_comparisons (
  id uuid PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES app_private.card_games (room_id) ON DELETE CASCADE,
  chain_index integer NOT NULL CHECK (chain_index >= 0),
  comparison_index integer NOT NULL CHECK (comparison_index >= 0),
  selector_id uuid NOT NULL,
  metric text CHECK (metric IS NULL OR metric IN ('batting', 'bowling', 'fielding', 'form', 'experience', 'versatility')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'tied', 'awarded', 'cancelled')),
  is_tie boolean NOT NULL DEFAULT false,
  by_timeout boolean NOT NULL DEFAULT false,
  reason text,
  eligible_ids uuid[] NOT NULL,
  tied_ids uuid[] NOT NULL DEFAULT '{}',
  winner_id uuid,
  opened_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE (room_id, comparison_index),
  UNIQUE (room_id, id),
  CHECK (cardinality(eligible_ids) BETWEEN 1 AND 8),
  CHECK (tied_ids <@ eligible_ids),
  CHECK (selector_id = ANY (eligible_ids)),
  CHECK (winner_id IS NULL OR winner_id = ANY (eligible_ids) OR status = 'awarded'),
  CHECK ((status = 'open') = (resolved_at IS NULL)),
  FOREIGN KEY (room_id, selector_id) REFERENCES app_private.room_members (room_id, id) ON DELETE RESTRICT
);
CREATE INDEX card_comparisons_selector ON app_private.card_comparisons (room_id, selector_id);
CREATE UNIQUE INDEX card_comparisons_one_open ON app_private.card_comparisons (room_id) WHERE status = 'open';

CREATE TABLE app_private.card_instances (
  id uuid PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES app_private.card_games (room_id) ON DELETE CASCADE,
  definition_id uuid NOT NULL REFERENCES app_private.card_definitions (id) ON DELETE RESTRICT,
  ratings jsonb NOT NULL CHECK (jsonb_typeof(ratings) = 'object'),
  location text NOT NULL CHECK (location IN ('DECK', 'ACTIVE', 'POT')),
  owner_member_id uuid,
  ordinal bigint,
  comparison_id uuid,
  contributor_member_id uuid,
  pot_order bigint,
  UNIQUE (room_id, id),
  CONSTRAINT card_instance_location_shape CHECK (
    (location = 'DECK' AND owner_member_id IS NOT NULL AND ordinal IS NOT NULL
      AND comparison_id IS NULL AND contributor_member_id IS NULL AND pot_order IS NULL)
    OR (location = 'ACTIVE' AND owner_member_id IS NULL AND ordinal IS NULL
      AND comparison_id IS NOT NULL AND contributor_member_id IS NOT NULL AND pot_order IS NULL)
    OR (location = 'POT' AND owner_member_id IS NULL AND ordinal IS NULL
      AND comparison_id IS NOT NULL AND contributor_member_id IS NOT NULL AND pot_order IS NOT NULL)
  ),
  -- One card per deck position; deferred so a transition can renumber a deck.
  CONSTRAINT one_deck_position UNIQUE (room_id, owner_member_id, ordinal) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (room_id, owner_member_id) REFERENCES app_private.room_members (room_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (room_id, contributor_member_id) REFERENCES app_private.room_members (room_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (room_id, comparison_id) REFERENCES app_private.card_comparisons (room_id, id) ON DELETE RESTRICT
);
CREATE INDEX card_instances_location ON app_private.card_instances (room_id, location);
CREATE INDEX card_instances_definition ON app_private.card_instances (definition_id);
CREATE INDEX card_instances_owner ON app_private.card_instances (room_id, owner_member_id);
CREATE INDEX card_instances_contributor ON app_private.card_instances (room_id, contributor_member_id);
CREATE INDEX card_instances_comparison ON app_private.card_instances (room_id, comparison_id);

CREATE TABLE app_private.card_contributions (
  room_id uuid NOT NULL REFERENCES app_private.card_games (room_id) ON DELETE CASCADE,
  comparison_id uuid NOT NULL,
  instance_id uuid NOT NULL,
  contributor_id uuid NOT NULL,
  metric_points integer CHECK (metric_points IS NULL OR metric_points BETWEEN 0 AND 1000),
  seat_order integer NOT NULL CHECK (seat_order BETWEEN 0 AND 7),
  original_ordinal bigint NOT NULL,
  PRIMARY KEY (comparison_id, instance_id),
  UNIQUE (comparison_id, contributor_id),
  FOREIGN KEY (room_id, comparison_id) REFERENCES app_private.card_comparisons (room_id, id) ON DELETE CASCADE,
  FOREIGN KEY (room_id, instance_id) REFERENCES app_private.card_instances (room_id, id) ON DELETE CASCADE,
  FOREIGN KEY (room_id, contributor_id) REFERENCES app_private.room_members (room_id, id) ON DELETE RESTRICT
);
CREATE INDEX card_contributions_room ON app_private.card_contributions (room_id, comparison_id);
CREATE INDEX card_contributions_instance ON app_private.card_contributions (room_id, instance_id);
CREATE INDEX card_contributions_contributor ON app_private.card_contributions (room_id, contributor_id);

CREATE TABLE app_private.card_cycle_counts (
  room_id uuid NOT NULL REFERENCES app_private.card_games (room_id) ON DELETE CASCADE,
  state_hash bytea NOT NULL CHECK (octet_length(state_hash) = 32),
  occurrences integer NOT NULL CHECK (occurrences >= 1),
  PRIMARY KEY (room_id, state_hash)
);

-- Conservation at commit: each touched room still holds exactly total_cards
-- instances (rules §1). Location shapes are row CHECKs; deck positions are the
-- deferred unique constraint above.
CREATE FUNCTION app_private.card_conservation_check() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  rid uuid := COALESCE(NEW.room_id, OLD.room_id);
  expected integer;
  actual integer;
BEGIN
  SELECT total_cards INTO expected FROM app_private.card_games WHERE room_id = rid;
  IF expected IS NULL THEN
    RETURN NULL; -- the game itself is being removed with its room
  END IF;
  SELECT count(*) INTO actual FROM app_private.card_instances WHERE room_id = rid;
  IF actual <> expected THEN
    RAISE EXCEPTION 'card conservation violated in room %: % of % cards', rid, actual, expected
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;
CREATE CONSTRAINT TRIGGER card_conservation
  AFTER INSERT OR UPDATE OR DELETE ON app_private.card_instances
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION app_private.card_conservation_check();

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['card_games', 'card_seats', 'card_comparisons', 'card_instances',
    'card_contributions', 'card_cycle_counts'] LOOP
    EXECUTE format('ALTER TABLE app_private.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE app_private.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY backend_runtime ON app_private.%I TO app_runtime USING (true) WITH CHECK (true)', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON app_private.%I TO app_runtime', t);
  END LOOP;
END
$$;
