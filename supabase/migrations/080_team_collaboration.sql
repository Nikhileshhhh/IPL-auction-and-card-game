-- 080: team collaboration — capability versions, one co-captain, explicit
-- captain handover, private shortlists and advisory votes (phase 11,
-- ADR-026). A captain or capability change bumps the franchise control epoch
-- from migration 060, which fences automated control (phase 12). Team rows are private to the team's own
-- approved members; the API enforces that, the database only stores them.

-- One designated co-captain per team (vote representative and failover, rules §9).
CREATE UNIQUE INDEX franchise_members_one_cocaptain ON app_private.franchise_members (auction_franchise_id)
  WHERE role = 'cocaptain';
ALTER TABLE app_private.franchise_members
  ADD COLUMN capability_version bigint NOT NULL DEFAULT 0 CHECK (capability_version >= 0);

-- Explicit captain consent: one pending handover per team, 60-second expiry.
CREATE TABLE app_private.team_handovers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL,
  auction_franchise_id uuid NOT NULL,
  from_member_id uuid NOT NULL,
  to_member_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'cancelled')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  CHECK (from_member_id <> to_member_id),
  CHECK ((status = 'pending') = (decided_at IS NULL)),
  FOREIGN KEY (room_id, auction_franchise_id) REFERENCES app_private.auction_franchises (room_id, id) ON DELETE CASCADE,
  FOREIGN KEY (auction_franchise_id, from_member_id) REFERENCES app_private.franchise_members (auction_franchise_id, member_id) ON DELETE CASCADE,
  FOREIGN KEY (auction_franchise_id, to_member_id) REFERENCES app_private.franchise_members (auction_franchise_id, member_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX team_handovers_one_pending ON app_private.team_handovers (auction_franchise_id)
  WHERE status = 'pending';
CREATE INDEX team_handovers_team ON app_private.team_handovers (room_id, auction_franchise_id);
CREATE INDEX team_handovers_from ON app_private.team_handovers (auction_franchise_id, from_member_id);
CREATE INDEX team_handovers_to ON app_private.team_handovers (auction_franchise_id, to_member_id);

-- Private targets: a recommendation list, never a purchase authorization.
CREATE TABLE app_private.team_shortlists (
  room_id uuid NOT NULL,
  auction_franchise_id uuid NOT NULL,
  player_id uuid NOT NULL,
  priority integer NOT NULL CHECK (priority BETWEEN 0 AND 100),
  private_note text CHECK (private_note IS NULL OR char_length(private_note) <= 500),
  max_price bigint CHECK (max_price IS NULL OR max_price >= 0),
  proposed_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (auction_franchise_id, player_id),
  FOREIGN KEY (room_id, auction_franchise_id) REFERENCES app_private.auction_franchises (room_id, id) ON DELETE CASCADE,
  FOREIGN KEY (room_id, player_id) REFERENCES app_private.auction_pool (room_id, player_id) ON DELETE CASCADE,
  FOREIGN KEY (room_id, proposed_by) REFERENCES app_private.room_members (room_id, id) ON DELETE SET NULL (proposed_by)
);
CREATE INDEX team_shortlists_team ON app_private.team_shortlists (room_id, auction_franchise_id);
CREATE INDEX team_shortlists_player ON app_private.team_shortlists (room_id, player_id);
CREATE INDEX team_shortlists_proposer ON app_private.team_shortlists (room_id, proposed_by);

-- Advisory votes on a target (+1 / −1), one per member.
CREATE TABLE app_private.shortlist_votes (
  room_id uuid NOT NULL,
  auction_franchise_id uuid NOT NULL,
  player_id uuid NOT NULL,
  member_id uuid NOT NULL,
  value smallint NOT NULL CHECK (value IN (-1, 1)),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (auction_franchise_id, player_id, member_id),
  FOREIGN KEY (auction_franchise_id, player_id) REFERENCES app_private.team_shortlists (auction_franchise_id, player_id) ON DELETE CASCADE,
  FOREIGN KEY (auction_franchise_id, member_id) REFERENCES app_private.franchise_members (auction_franchise_id, member_id) ON DELETE CASCADE,
  FOREIGN KEY (room_id, auction_franchise_id) REFERENCES app_private.auction_franchises (room_id, id) ON DELETE CASCADE
);
CREATE INDEX shortlist_votes_team ON app_private.shortlist_votes (room_id, auction_franchise_id);
CREATE INDEX shortlist_votes_member ON app_private.shortlist_votes (auction_franchise_id, member_id);

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['team_handovers', 'team_shortlists', 'shortlist_votes'] LOOP
    EXECUTE format('ALTER TABLE app_private.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE app_private.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY backend_runtime ON app_private.%I TO app_runtime USING (true) WITH CHECK (true)', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON app_private.%I TO app_runtime', t);
  END LOOP;
END
$$;
