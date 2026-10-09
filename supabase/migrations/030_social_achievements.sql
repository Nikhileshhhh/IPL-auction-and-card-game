-- 030: social graph, personal notifications and durable achievement roots.

-- -------------------------------------------------------------- friendships (P)
CREATE TABLE app_private.friendships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  low_user_id uuid NOT NULL REFERENCES app_private.profiles (user_id) ON DELETE CASCADE,
  high_user_id uuid NOT NULL REFERENCES app_private.profiles (user_id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES app_private.profiles (user_id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('pending', 'accepted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (low_user_id, high_user_id),
  CHECK (low_user_id < high_user_id),
  CHECK (requested_by IN (low_user_id, high_user_id))
);
CREATE INDEX friendships_high ON app_private.friendships (high_user_id);
CREATE INDEX friendships_requested_by ON app_private.friendships (requested_by);
CREATE INDEX friendships_status ON app_private.friendships (status);
CREATE TRIGGER friendships_touch BEFORE UPDATE ON app_private.friendships
  FOR EACH ROW EXECUTE FUNCTION app_private.touch_updated_at();

-- -------------------------------------------------------------- user_blocks (P)
CREATE TABLE app_private.user_blocks (
  blocker_id uuid NOT NULL REFERENCES app_private.profiles (user_id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES app_private.profiles (user_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
CREATE INDEX user_blocks_blocked ON app_private.user_blocks (blocked_id);

-- ------------------------------------------------------------ notifications (O)
CREATE TABLE app_private.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_private.profiles (user_id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type ~ '^[a-z]+(\.[a-zA-Z]+)+$'),
  -- Safe projection only: never room codes, passwords or chat bodies.
  safe_payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (octet_length(safe_payload::text) <= 4096),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  read_at timestamptz,
  CHECK (expires_at <= created_at + interval '30 days')
);
CREATE INDEX notifications_user_time ON app_private.notifications (user_id, created_at DESC);
CREATE INDEX notifications_expires ON app_private.notifications (expires_at);

-- ----------------------------------------------------- achievement_receipts (P)
-- Compact, immutable grants. No room FK, transcript, squad, bids or chat.
CREATE TABLE app_private.achievement_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  award_batch uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES app_private.profiles (user_id) ON DELETE CASCADE,
  game_type text NOT NULL CHECK (game_type IN ('card', 'auction')),
  rank smallint CHECK (rank IS NULL OR rank >= 1),
  medal_place smallint CHECK (medal_place IS NULL OR medal_place BETWEEN 1 AND 3),
  medal text CHECK (medal IS NULL OR medal IN ('gold', 'silver', 'bronze')),
  scope text NOT NULL CHECK (scope IN ('personal', 'franchise')),
  credited_role text NOT NULL CHECK (credited_role IN ('player', 'captain', 'cocaptain', 'bidder', 'advisor')),
  completion_day date NOT NULL,
  ruleset_version text NOT NULL CHECK (char_length(ruleset_version) BETWEEN 1 AND 80),
  evaluator_version text CHECK (evaluator_version IS NULL OR char_length(evaluator_version) <= 80),
  qualifies boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (award_batch, user_id),
  CHECK (
    (medal IS NULL AND medal_place IS NULL)
    OR (medal = 'gold' AND medal_place = 1)
    OR (medal = 'silver' AND medal_place = 2)
    OR (medal = 'bronze' AND medal_place = 3)
  ),
  CHECK (medal IS NULL OR qualifies),
  CHECK (game_type = 'auction' OR scope = 'personal')
);
CREATE INDEX achievement_receipts_user_day ON app_private.achievement_receipts (user_id, completion_day DESC);

-- ---------------------------------------------------- achievement_summaries (P)
-- Rebuildable cache of qualifying receipts; never written from profile forms.
CREATE TABLE app_private.achievement_summaries (
  user_id uuid PRIMARY KEY REFERENCES app_private.profiles (user_id) ON DELETE CASCADE,
  gold bigint NOT NULL DEFAULT 0 CHECK (gold >= 0),
  silver bigint NOT NULL DEFAULT 0 CHECK (silver >= 0),
  bronze bigint NOT NULL DEFAULT 0 CHECK (bronze >= 0),
  games bigint NOT NULL DEFAULT 0 CHECK (games >= 0),
  card_wins bigint NOT NULL DEFAULT 0 CHECK (card_wins >= 0),
  auction_wins bigint NOT NULL DEFAULT 0 CHECK (auction_wins >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER achievement_summaries_touch BEFORE UPDATE ON app_private.achievement_summaries
  FOR EACH ROW EXECUTE FUNCTION app_private.touch_updated_at();

-- ------------------------------------------------------------------ security
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['friendships', 'user_blocks', 'notifications', 'achievement_receipts',
    'achievement_summaries'] LOOP
    EXECUTE format('ALTER TABLE app_private.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE app_private.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY backend_runtime ON app_private.%I TO app_runtime USING (true) WITH CHECK (true)', t);
  END LOOP;
END
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON app_private.friendships TO app_runtime;
GRANT SELECT, INSERT, DELETE ON app_private.user_blocks TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON app_private.notifications TO app_runtime;
-- Receipts are append-only for the runtime (finalizer inserts; no edits).
GRANT SELECT, INSERT ON app_private.achievement_receipts TO app_runtime;
GRANT SELECT, INSERT, UPDATE ON app_private.achievement_summaries TO app_runtime;
