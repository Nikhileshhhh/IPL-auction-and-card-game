-- 090: reconnect, failover and safe automation (phase 12, ADR-027).
-- Private automated-bidding limits with spend/purchase counters, franchise
-- failover and control reason, room recovery pauses after an outage, and a
-- presence index for "is any authorised bidder still connected".

-- Private limits for automated bidding while every authorised bidder is away.
CREATE TABLE app_private.auto_strategies (
  room_id uuid NOT NULL,
  auction_franchise_id uuid PRIMARY KEY,
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  enabled boolean NOT NULL DEFAULT false,
  strategy jsonb NOT NULL CHECK (jsonb_typeof(strategy) = 'object' AND octet_length(strategy::text) <= 16384),
  -- Counters move only at a sale won by an automated bid (or match).
  spent_auto bigint NOT NULL DEFAULT 0 CHECK (spent_auto >= 0),
  purchases_auto integer NOT NULL DEFAULT 0 CHECK (purchases_auto >= 0),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (room_id, auction_franchise_id) REFERENCES app_private.auction_franchises (room_id, id) ON DELETE CASCADE,
  FOREIGN KEY (room_id, updated_by) REFERENCES app_private.room_members (room_id, id) ON DELETE SET NULL (updated_by)
);
CREATE INDEX auto_strategies_team ON app_private.auto_strategies (room_id, auction_franchise_id);
CREATE INDEX auto_strategies_updater ON app_private.auto_strategies (room_id, updated_by);

-- Failover: the co-captain who holds control while the bidders are away, and why control changed.
ALTER TABLE app_private.auction_franchises
  ADD COLUMN failover_member_id uuid,
  ADD COLUMN control_reason text CHECK (control_reason IS NULL OR char_length(control_reason) <= 40),
  ADD COLUMN control_changed_at timestamptz,
  ADD CONSTRAINT auction_franchises_failover_fk FOREIGN KEY (room_id, failover_member_id)
    REFERENCES app_private.room_members (room_id, id) ON DELETE SET NULL (failover_member_id);
CREATE INDEX auction_franchises_failover ON app_private.auction_franchises (room_id, failover_member_id);

-- Outage recovery pause: gameplay clocks frozen, a visible countdown, then resume.
ALTER TABLE app_private.rooms
  ADD COLUMN recovery_until timestamptz,
  ADD COLUMN recovery_generation bigint NOT NULL DEFAULT 0 CHECK (recovery_generation >= 0);

-- "Is any authorised bidder still connected?" and the heartbeat sweep.
CREATE INDEX room_connections_member_expiry ON app_private.room_connections (member_id, expires_at);

ALTER TABLE app_private.auto_strategies ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.auto_strategies FORCE ROW LEVEL SECURITY;
CREATE POLICY backend_runtime ON app_private.auto_strategies TO app_runtime USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON app_private.auto_strategies TO app_runtime;
