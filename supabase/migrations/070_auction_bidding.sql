-- 070: live auction — lots, accepted bids, RTM stages, passes and pauses
-- (phase 10, ADR-025). One open lot per room; accepted bids only, serialised
-- by bid_version; the deadline and timer generation live on the lot and every
-- deadline job is re-checked under the room lock. Purchases still go through
-- auction_acquisitions (UQ room/player, UQ nomination) and the purse trigger.

CREATE TABLE app_private.auction_nominations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES app_private.auction_games (room_id) ON DELETE CASCADE,
  player_id uuid NOT NULL,
  lot_number integer NOT NULL CHECK (lot_number >= 1),
  pass integer NOT NULL CHECK (pass BETWEEN 1 AND 2),
  base_price bigint NOT NULL CHECK (base_price > 0),
  stage text NOT NULL DEFAULT 'bidding'
    CHECK (stage IN ('bidding', 'rtm_intent', 'rtm_raise', 'rtm_match', 'settled')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'sold', 'unsold', 'skipped', 'cancelled')),
  high_franchise_id uuid,
  high_bid bigint CHECK (high_bid IS NULL OR high_bid > 0),
  bid_version bigint NOT NULL DEFAULT 0 CHECK (bid_version >= 0),
  deadline timestamptz,
  timer_generation bigint NOT NULL DEFAULT 0 CHECK (timer_generation >= 0),
  rtm_franchise_id uuid,
  rtm_final_bid bigint CHECK (rtm_final_bid IS NULL OR rtm_final_bid > 0),
  sold_to uuid,
  sold_price bigint CHECK (sold_price IS NULL OR sold_price > 0),
  opened_at timestamptz NOT NULL,
  settled_at timestamptz,
  UNIQUE (room_id, id),
  UNIQUE (room_id, lot_number),
  CHECK ((status = 'open') = (stage <> 'settled')),
  CHECK ((high_franchise_id IS NULL) = (high_bid IS NULL)),
  CHECK (status <> 'sold' OR (sold_to IS NOT NULL AND sold_price IS NOT NULL)),
  FOREIGN KEY (room_id, player_id) REFERENCES app_private.auction_pool (room_id, player_id) ON DELETE CASCADE,
  FOREIGN KEY (room_id, high_franchise_id) REFERENCES app_private.auction_franchises (room_id, id) ON DELETE CASCADE,
  FOREIGN KEY (room_id, rtm_franchise_id) REFERENCES app_private.auction_franchises (room_id, id) ON DELETE CASCADE,
  FOREIGN KEY (room_id, sold_to) REFERENCES app_private.auction_franchises (room_id, id) ON DELETE CASCADE
);
-- Exactly one open lot per room (rules §8).
CREATE UNIQUE INDEX auction_nominations_one_open ON app_private.auction_nominations (room_id)
  WHERE status = 'open';
CREATE INDEX auction_nominations_player ON app_private.auction_nominations (room_id, player_id);
CREATE INDEX auction_nominations_high ON app_private.auction_nominations (room_id, high_franchise_id);
CREATE INDEX auction_nominations_rtm ON app_private.auction_nominations (room_id, rtm_franchise_id);
CREATE INDEX auction_nominations_sold ON app_private.auction_nominations (room_id, sold_to);
CREATE INDEX auction_nominations_deadline ON app_private.auction_nominations (deadline) WHERE status = 'open';

CREATE TABLE app_private.auction_bids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL,
  nomination_id uuid NOT NULL,
  auction_franchise_id uuid NOT NULL,
  actor_member_id uuid,
  actor_type text NOT NULL DEFAULT 'human' CHECK (actor_type IN ('human', 'auto')),
  kind text NOT NULL DEFAULT 'normal' CHECK (kind IN ('normal', 'rtm_raise', 'rtm_match')),
  amount bigint NOT NULL CHECK (amount > 0),
  bid_version bigint NOT NULL CHECK (bid_version >= 1),
  command_id uuid NOT NULL,
  accepted_at timestamptz NOT NULL,
  -- Accepted offers only, one per version (rules §8.2: serial accepted bids).
  UNIQUE (nomination_id, bid_version),
  FOREIGN KEY (room_id, nomination_id) REFERENCES app_private.auction_nominations (room_id, id) ON DELETE CASCADE,
  FOREIGN KEY (room_id, auction_franchise_id) REFERENCES app_private.auction_franchises (room_id, id) ON DELETE CASCADE,
  FOREIGN KEY (room_id, actor_member_id) REFERENCES app_private.room_members (room_id, id) ON DELETE SET NULL (actor_member_id)
);
CREATE INDEX auction_bids_nomination ON app_private.auction_bids (room_id, nomination_id, accepted_at);
CREATE INDEX auction_bids_team ON app_private.auction_bids (room_id, auction_franchise_id);
CREATE INDEX auction_bids_actor ON app_private.auction_bids (room_id, actor_member_id);

-- Lot order, passes and skips; pace/spin for the legal-XI check.
ALTER TABLE app_private.auction_pool
  ADD COLUMN bowl_type text CHECK (bowl_type IS NULL OR bowl_type IN ('pace', 'spin')),
  ADD COLUMN skipped boolean NOT NULL DEFAULT false;

-- Committed lot-order seed (sealed until the auction ends), pauses and the end.
ALTER TABLE app_private.auction_games
  ADD COLUMN seed_ciphertext bytea,
  ADD COLUMN seed_commitment text CHECK (seed_commitment IS NULL OR seed_commitment ~ '^[0-9a-f]{64}$'),
  ADD COLUMN rng_version text,
  ADD COLUMN paused_until timestamptz,
  ADD COLUMN pause_count integer NOT NULL DEFAULT 0 CHECK (pause_count BETWEEN 0 AND 3),
  ADD COLUMN lot_generation bigint NOT NULL DEFAULT 0 CHECK (lot_generation >= 0),
  ADD COLUMN finished_reason text CHECK (finished_reason IS NULL OR finished_reason IN ('pool_complete', 'no_buyers', 'time_limit', 'vote'));
ALTER TABLE app_private.auction_games
  ADD CONSTRAINT auction_games_active_nomination_fk FOREIGN KEY (room_id, active_nomination_id)
  REFERENCES app_private.auction_nominations (room_id, id) ON DELETE SET NULL (active_nomination_id)
  DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX auction_games_active_nomination ON app_private.auction_games (room_id, active_nomination_id);

-- A purchase names the lot it settled; at most one purchase per lot.
ALTER TABLE app_private.auction_acquisitions
  ADD CONSTRAINT auction_acquisitions_nomination_fk FOREIGN KEY (room_id, nomination_id)
  REFERENCES app_private.auction_nominations (room_id, id) ON DELETE CASCADE;
CREATE INDEX auction_acquisitions_nomination ON app_private.auction_acquisitions (room_id, nomination_id);

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['auction_nominations', 'auction_bids'] LOOP
    EXECUTE format('ALTER TABLE app_private.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE app_private.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY backend_runtime ON app_private.%I TO app_runtime USING (true) WITH CHECK (true)', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON app_private.%I TO app_runtime', t);
  END LOOP;
END
$$;
