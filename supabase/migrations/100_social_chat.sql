-- 100: temporary room/team chat and social indexes (phase 13, ADR-028).
-- Chat lives only as long as its room (every row cascades from rooms); it is
-- never copied into persistent notifications. Bodies are plain text of at
-- most 500 Unicode code points. Team channels belong to one franchise and are
-- readable only by its approved members (enforced by the API and stream ACL).

CREATE TABLE app_private.chat_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES app_private.rooms (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('room', 'team')),
  franchise_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (room_id, kind, franchise_id),
  UNIQUE (room_id, id),
  CHECK ((kind = 'team') = (franchise_id IS NOT NULL)),
  FOREIGN KEY (room_id, franchise_id) REFERENCES app_private.auction_franchises (room_id, id) ON DELETE CASCADE
);
CREATE INDEX chat_channels_franchise ON app_private.chat_channels (room_id, franchise_id);

CREATE TABLE app_private.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL,
  channel_id uuid NOT NULL,
  sender_member_id uuid NOT NULL,
  client_message_id uuid NOT NULL,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  removed_by uuid,
  moderation_reason text CHECK (moderation_reason IS NULL OR char_length(moderation_reason) <= 120),
  -- A retried send returns the same message (idempotent per sender).
  UNIQUE (sender_member_id, client_message_id),
  FOREIGN KEY (room_id, channel_id) REFERENCES app_private.chat_channels (room_id, id) ON DELETE CASCADE,
  FOREIGN KEY (room_id, sender_member_id) REFERENCES app_private.room_members (room_id, id) ON DELETE CASCADE,
  FOREIGN KEY (room_id, removed_by) REFERENCES app_private.room_members (room_id, id) ON DELETE SET NULL (removed_by)
);
CREATE INDEX chat_messages_channel_time ON app_private.chat_messages (channel_id, created_at, id);
CREATE INDEX chat_messages_room_channel ON app_private.chat_messages (room_id, channel_id);
CREATE INDEX chat_messages_sender ON app_private.chat_messages (room_id, sender_member_id);
CREATE INDEX chat_messages_remover ON app_private.chat_messages (room_id, removed_by);

CREATE TABLE app_private.chat_mutes (
  room_id uuid NOT NULL,
  channel_id uuid NOT NULL,
  member_id uuid NOT NULL,
  muted_by uuid,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (channel_id, member_id),
  CHECK (expires_at <= created_at + interval '24 hours'),
  FOREIGN KEY (room_id, channel_id) REFERENCES app_private.chat_channels (room_id, id) ON DELETE CASCADE,
  FOREIGN KEY (room_id, member_id) REFERENCES app_private.room_members (room_id, id) ON DELETE CASCADE,
  FOREIGN KEY (room_id, muted_by) REFERENCES app_private.room_members (room_id, id) ON DELETE SET NULL (muted_by)
);
CREATE INDEX chat_mutes_member ON app_private.chat_mutes (room_id, member_id);
CREATE INDEX chat_mutes_muter ON app_private.chat_mutes (room_id, muted_by);
CREATE INDEX chat_mutes_expires ON app_private.chat_mutes (expires_at);
CREATE INDEX chat_mutes_channel ON app_private.chat_mutes (room_id, channel_id);

-- Deleting a room (empty lobby, cleanup) cascades to its members and its
-- franchises; the captain reference is checked at commit, once both are gone,
-- instead of immediately (a direct captain delete still fails at commit).
ALTER TABLE app_private.auction_franchises
  DROP CONSTRAINT auction_franchises_room_id_captain_member_id_fkey,
  ADD CONSTRAINT auction_franchises_room_id_captain_member_id_fkey
    FOREIGN KEY (room_id, captain_member_id) REFERENCES app_private.room_members (room_id, id)
    DEFERRABLE INITIALLY DEFERRED;

-- Social lookups: a user's incoming requests and their invites by room.
CREATE INDEX friendships_low ON app_private.friendships (low_user_id, status);
CREATE INDEX room_invites_room ON app_private.room_invites (room_id, expires_at);

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['chat_channels', 'chat_messages', 'chat_mutes'] LOOP
    EXECUTE format('ALTER TABLE app_private.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE app_private.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY backend_runtime ON app_private.%I TO app_runtime USING (true) WITH CHECK (true)', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON app_private.%I TO app_runtime', t);
  END LOOP;
END
$$;
