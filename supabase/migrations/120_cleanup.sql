-- 120: recoverable automatic cleanup (phase 15, ADR-030).
-- Storage and PostgreSQL cannot share a transaction, so deletion is a
-- recoverable task: freeze the room (PURGING), delete every room object from
-- Storage and verify the prefix is empty, then delete the root row, whose
-- cascade removes every temporary (T) row, the asset manifest and the task.

-- External deletion manifest: registered before any Storage write.
CREATE TABLE app_private.room_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES app_private.rooms (id) ON DELETE CASCADE,
  bucket text NOT NULL CHECK (char_length(bucket) BETWEEN 1 AND 64),
  object_key text NOT NULL UNIQUE,
  purpose text NOT NULL CHECK (purpose IN ('room_image')),
  status text NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading', 'ready', 'deleting', 'deleted')),
  upload_expires_at timestamptz NOT NULL,
  size_bytes bigint CHECK (size_bytes IS NULL OR size_bytes BETWEEN 1 AND 2097152),
  checksum text CHECK (checksum IS NULL OR checksum ~ '^[0-9a-f]{64}$'),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Room objects live only under the room's own prefix (never shared media).
  CHECK (object_key LIKE 'rooms/' || room_id::text || '/%'),
  FOREIGN KEY (room_id, created_by) REFERENCES app_private.room_members (room_id, id) ON DELETE SET NULL (created_by)
);
CREATE INDEX room_assets_room ON app_private.room_assets (room_id, status);
CREATE INDEX room_assets_upload_expiry ON app_private.room_assets (upload_expires_at) WHERE status = 'uploading';
CREATE INDEX room_assets_creator ON app_private.room_assets (room_id, created_by);

-- One idempotent cleanup task per room; it disappears with the root.
CREATE TABLE app_private.cleanup_tasks (
  room_id uuid PRIMARY KEY REFERENCES app_private.rooms (id) ON DELETE CASCADE,
  stage text NOT NULL DEFAULT 'freeze' CHECK (stage IN ('freeze', 'assets', 'rows')),
  reason text NOT NULL CHECK (reason IN ('results', 'aborted', 'abandoned', 'admin', 'lobby')),
  next_attempt_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error_code text CHECK (last_error_code IS NULL OR last_error_code ~ '^[A-Z_]{1,40}$'),
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cleanup_tasks_due ON app_private.cleanup_tasks (next_attempt_at);

-- Expiry scans: results past their TTL, stranded rooms by state.
CREATE INDEX rooms_results_expiry ON app_private.rooms (lifecycle, result_expires_at);

-- Started card rooms must be deletable by the root cascade. These member and
-- comparison references were RESTRICT (checked mid-cascade, before the card
-- rows that hold them are gone); they are now checked at commit, when the
-- whole room has been removed. Deleting a referenced member directly still
-- fails at commit.
ALTER TABLE app_private.card_games
  DROP CONSTRAINT card_games_room_id_selector_member_id_fkey,
  DROP CONSTRAINT card_games_room_id_chain_selector_id_fkey,
  ADD CONSTRAINT card_games_room_id_selector_member_id_fkey FOREIGN KEY (room_id, selector_member_id)
    REFERENCES app_private.room_members (room_id, id) DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT card_games_room_id_chain_selector_id_fkey FOREIGN KEY (room_id, chain_selector_id)
    REFERENCES app_private.room_members (room_id, id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE app_private.card_seats
  DROP CONSTRAINT card_seats_room_id_member_id_fkey,
  ADD CONSTRAINT card_seats_room_id_member_id_fkey FOREIGN KEY (room_id, member_id)
    REFERENCES app_private.room_members (room_id, id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE app_private.card_comparisons
  DROP CONSTRAINT card_comparisons_room_id_selector_id_fkey,
  ADD CONSTRAINT card_comparisons_room_id_selector_id_fkey FOREIGN KEY (room_id, selector_id)
    REFERENCES app_private.room_members (room_id, id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE app_private.card_instances
  DROP CONSTRAINT card_instances_room_id_owner_member_id_fkey,
  DROP CONSTRAINT card_instances_room_id_contributor_member_id_fkey,
  DROP CONSTRAINT card_instances_room_id_comparison_id_fkey,
  ADD CONSTRAINT card_instances_room_id_owner_member_id_fkey FOREIGN KEY (room_id, owner_member_id)
    REFERENCES app_private.room_members (room_id, id) DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT card_instances_room_id_contributor_member_id_fkey FOREIGN KEY (room_id, contributor_member_id)
    REFERENCES app_private.room_members (room_id, id) DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT card_instances_room_id_comparison_id_fkey FOREIGN KEY (room_id, comparison_id)
    REFERENCES app_private.card_comparisons (room_id, id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE app_private.card_contributions
  DROP CONSTRAINT card_contributions_room_id_contributor_id_fkey,
  ADD CONSTRAINT card_contributions_room_id_contributor_id_fkey FOREIGN KEY (room_id, contributor_id)
    REFERENCES app_private.room_members (room_id, id) DEFERRABLE INITIALLY DEFERRED;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['room_assets', 'cleanup_tasks'] LOOP
    EXECUTE format('ALTER TABLE app_private.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE app_private.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY backend_runtime ON app_private.%I TO app_runtime USING (true) WITH CHECK (true)', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON app_private.%I TO app_runtime', t);
  END LOOP;
END
$$;
