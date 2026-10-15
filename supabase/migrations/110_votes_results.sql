-- 110: end-game votes, finalization and temporary results (phase 14, ADR-029).
-- A vote lasts exactly 15 s on the database clock with a frozen electorate
-- (card seats still in the game, or one representative per franchise). Results
-- are temporary (deleted with the room); medals live only in the compact
-- achievement receipts from migration 030.

CREATE TABLE app_private.end_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES app_private.rooms (id) ON DELETE CASCADE,
  started_by uuid,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'passed', 'failed')),
  starts_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  electorate_count integer NOT NULL CHECK (electorate_count >= 1),
  threshold integer NOT NULL CHECK (threshold >= 1 AND threshold <= electorate_count),
  -- The frozen phase label and each gameplay timer's remaining milliseconds.
  saved_phase text NOT NULL CHECK (char_length(saved_phase) BETWEEN 1 AND 40),
  saved_timers jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(saved_timers) = 'array'),
  yes integer CHECK (yes IS NULL OR yes >= 0),
  no integer CHECK (no IS NULL OR no >= 0),
  resolved_at timestamptz,
  UNIQUE (room_id, id),
  CHECK (expires_at = starts_at + interval '15 seconds'),
  CHECK ((status = 'open') = (resolved_at IS NULL)),
  FOREIGN KEY (room_id, started_by) REFERENCES app_private.room_members (room_id, id) ON DELETE SET NULL (started_by)
);
CREATE UNIQUE INDEX one_open_end_vote ON app_private.end_votes (room_id) WHERE status = 'open';
CREATE INDEX end_votes_expires ON app_private.end_votes (expires_at);
CREATE INDEX end_votes_starter ON app_private.end_votes (room_id, started_by);

-- One immutable ballot per frozen elector (a card seat or a franchise).
CREATE TABLE app_private.vote_electorate (
  room_id uuid NOT NULL,
  vote_id uuid NOT NULL,
  voter_key uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('player', 'franchise')),
  representative_member_id uuid NOT NULL,
  choice text CHECK (choice IS NULL OR choice IN ('end', 'continue')),
  cast_at timestamptz,
  PRIMARY KEY (vote_id, voter_key),
  UNIQUE (vote_id, representative_member_id),
  CHECK ((choice IS NULL) = (cast_at IS NULL)),
  FOREIGN KEY (room_id, vote_id) REFERENCES app_private.end_votes (room_id, id) ON DELETE CASCADE,
  FOREIGN KEY (room_id, representative_member_id) REFERENCES app_private.room_members (room_id, id) ON DELETE CASCADE
);
CREATE INDEX vote_electorate_representative ON app_private.vote_electorate (room_id, representative_member_id);
CREATE INDEX vote_electorate_vote ON app_private.vote_electorate (room_id, vote_id);

-- A ballot is immutable once cast and must be cast before the original expiry.
CREATE FUNCTION app_private.vote_ballot_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v_expires timestamptz;
BEGIN
  IF OLD.choice IS NOT NULL THEN
    RAISE EXCEPTION 'ballot already cast' USING ERRCODE = 'check_violation';
  END IF;
  SELECT expires_at INTO v_expires FROM app_private.end_votes WHERE id = NEW.vote_id;
  IF NEW.cast_at IS NOT NULL AND NEW.cast_at >= v_expires THEN
    RAISE EXCEPTION 'ballot after vote expiry' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER vote_ballot_guard BEFORE UPDATE ON app_private.vote_electorate
  FOR EACH ROW EXECUTE FUNCTION app_private.vote_ballot_guard();

-- Temporary results: public podium and score reports, team-private reports.
CREATE TABLE app_private.room_results (
  room_id uuid PRIMARY KEY REFERENCES app_private.rooms (id) ON DELETE CASCADE,
  public_result jsonb NOT NULL CHECK (jsonb_typeof(public_result) = 'object' AND octet_length(public_result::text) <= 262144),
  private_team_reports jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(private_team_reports) = 'object'),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  source_state_hash text NOT NULL CHECK (source_state_hash ~ '^[0-9a-f]{64}$'),
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '300 seconds')
);
CREATE INDEX room_results_expires ON app_private.room_results (expires_at);

-- Card eligibility: presence up to personal elimination.
ALTER TABLE app_private.card_seats
  ADD COLUMN eliminated_at timestamptz,
  ADD COLUMN participation_at_exit bigint CHECK (participation_at_exit IS NULL OR participation_at_exit >= 0);

-- Vote and recovery pauses are excluded from the participation denominator.
ALTER TABLE app_private.rooms
  ADD COLUMN paused_ms bigint NOT NULL DEFAULT 0 CHECK (paused_ms >= 0);

-- Resumable exact XI evaluation: one checkpoint per franchise per input hash.
ALTER TABLE app_private.auction_games
  ADD COLUMN evaluation_input_hash text CHECK (evaluation_input_hash IS NULL OR evaluation_input_hash ~ '^[0-9a-f]{64}$'),
  ADD COLUMN evaluation_generation bigint NOT NULL DEFAULT 0 CHECK (evaluation_generation >= 0),
  ADD COLUMN evaluation_cursor jsonb CHECK (evaluation_cursor IS NULL OR jsonb_typeof(evaluation_cursor) = 'object'),
  ADD COLUMN evaluation_best jsonb CHECK (evaluation_best IS NULL OR jsonb_typeof(evaluation_best) = 'object');

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['end_votes', 'vote_electorate', 'room_results'] LOOP
    EXECUTE format('ALTER TABLE app_private.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE app_private.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY backend_runtime ON app_private.%I TO app_runtime USING (true) WITH CHECK (true)', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON app_private.%I TO app_runtime', t);
  END LOOP;
END
$$;
