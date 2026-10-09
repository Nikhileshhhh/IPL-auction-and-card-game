-- 020: cricket catalog, provenance, versioned snapshots, media and definitions.
-- Published data versions and rulesets are immutable; corrections publish a
-- new version (rules §3, master §3). Enforced below by triggers, not only by code.

-- ------------------------------------------------------------- data_sources (P)
CREATE TABLE app_private.data_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publisher text NOT NULL CHECK (char_length(publisher) BETWEEN 1 AND 120),
  -- https:// for external evidence, stumps: for original in-house generators.
  url text NOT NULL CHECK (url ~ '^(https://|stumps:)' AND char_length(url) <= 500),
  fetched_at timestamptz NOT NULL,
  licence_label text NOT NULL CHECK (char_length(licence_label) BETWEEN 1 AND 120),
  attribution text NOT NULL DEFAULT '' CHECK (char_length(attribution) <= 500),
  verification_status text NOT NULL DEFAULT 'draft'
    CHECK (verification_status IN ('draft', 'reviewed', 'rejected')),
  checksum text CHECK (checksum IS NULL OR checksum ~ '^[0-9a-f]{64}$'),
  scope text NOT NULL DEFAULT '' CHECK (char_length(scope) <= 500),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------------ seasons (P)
CREATE TABLE app_private.seasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition text NOT NULL CHECK (char_length(competition) BETWEEN 1 AND 80),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 40),
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  snapshot_cutoff timestamptz NOT NULL,
  UNIQUE (competition, label),
  CHECK (starts_on <= ends_on)
);

-- ------------------------------------------------------------- media_assets (P)
-- One logical image; WebP variants stored as {object_key}/{width}.webp.
CREATE TABLE app_private.media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket text NOT NULL CHECK (bucket IN ('catalog-media', 'avatars', 'original-assets')),
  object_key text NOT NULL UNIQUE CHECK (object_key ~ '^[a-z0-9][a-z0-9/_-]{2,200}$' AND object_key !~ '\.\.'),
  purpose text NOT NULL CHECK (purpose IN ('portrait', 'card_art', 'emblem', 'avatar')),
  mime text NOT NULL CHECK (mime IN ('image/webp', 'image/png', 'image/jpeg', 'image/avif')),
  size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 2097152),
  width integer NOT NULL CHECK (width BETWEEN 16 AND 4096),
  height integer NOT NULL CHECK (height BETWEEN 16 AND 4096),
  variant_widths integer[] NOT NULL DEFAULT '{}',
  owner_user_id uuid REFERENCES app_private.profiles (user_id) ON DELETE CASCADE,
  source_id uuid REFERENCES app_private.data_sources (id) ON DELETE RESTRICT,
  rights_basis text NOT NULL CHECK (rights_basis IN ('original-generated', 'licensed', 'user-upload')),
  rights_status text NOT NULL DEFAULT 'pending'
    CHECK (rights_status IN ('pending', 'approved', 'rejected', 'expired')),
  attribution text CHECK (attribution IS NULL OR char_length(attribution) <= 300),
  alt_text text NOT NULL CHECK (char_length(alt_text) BETWEEN 1 AND 200),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (rights_basis <> 'licensed' OR source_id IS NOT NULL),
  CHECK (rights_basis <> 'user-upload' OR owner_user_id IS NOT NULL)
);
CREATE INDEX media_assets_owner ON app_private.media_assets (owner_user_id);
CREATE INDEX media_assets_source ON app_private.media_assets (source_id);

ALTER TABLE app_private.profiles
  ADD CONSTRAINT profiles_avatar_fk FOREIGN KEY (avatar_asset_id)
  REFERENCES app_private.media_assets (id) ON DELETE SET NULL;
CREATE INDEX profiles_avatar ON app_private.profiles (avatar_asset_id);

-- --------------------------------------------------------------- franchises (P)
CREATE TABLE app_private.franchises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{2,40}$'),
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 60),
  short_name text NOT NULL CHECK (char_length(short_name) BETWEEN 2 AND 5),
  primary_hex char(7) NOT NULL CHECK (primary_hex ~ '^#[0-9A-Fa-f]{6}$'),
  secondary_hex char(7) NOT NULL CHECK (secondary_hex ~ '^#[0-9A-Fa-f]{6}$'),
  emblem_asset_id uuid REFERENCES app_private.media_assets (id) ON DELETE RESTRICT,
  is_fictional boolean NOT NULL,
  archived_at timestamptz
);
CREATE INDEX franchises_emblem ON app_private.franchises (emblem_asset_id);

CREATE TABLE app_private.season_franchises (
  season_id uuid NOT NULL REFERENCES app_private.seasons (id) ON DELETE RESTRICT,
  franchise_id uuid NOT NULL REFERENCES app_private.franchises (id) ON DELETE RESTRICT,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 2 AND 60),
  PRIMARY KEY (season_id, franchise_id)
);
CREATE INDEX season_franchises_franchise ON app_private.season_franchises (franchise_id);

-- ------------------------------------------------------------------ players (P)
CREATE TABLE app_private.players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name text NOT NULL CHECK (char_length(btrim(canonical_name)) BETWEEN 1 AND 80),
  country_code char(2) NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  primary_role text NOT NULL CHECK (primary_role IN ('batter', 'bowler', 'all_rounder', 'wicketkeeper')),
  batting_style text CHECK (batting_style IS NULL OR batting_style IN ('right_hand', 'left_hand')),
  bowling_style text CHECK (bowling_style IS NULL OR char_length(bowling_style) <= 40),
  is_fictional boolean NOT NULL,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Manual dedup support only; no name-only uniqueness (master §3).
CREATE INDEX players_normalized_name ON app_private.players (lower(canonical_name));

CREATE TABLE app_private.player_external_ids (
  player_id uuid NOT NULL REFERENCES app_private.players (id) ON DELETE RESTRICT,
  source text NOT NULL CHECK (char_length(source) BETWEEN 1 AND 40),
  external_id text NOT NULL CHECK (char_length(external_id) BETWEEN 1 AND 80),
  PRIMARY KEY (source, external_id),
  UNIQUE (player_id, source, external_id)
);

-- ------------------------------------------------------------- data_versions (P)
CREATE TABLE app_private.data_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id uuid NOT NULL REFERENCES app_private.seasons (id) ON DELETE RESTRICT,
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 60),
  kind text NOT NULL CHECK (kind IN ('demo', 'factual')),
  cutoff_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  derived_from uuid REFERENCES app_private.data_versions (id) ON DELETE RESTRICT,
  source_manifest jsonb NOT NULL DEFAULT '[]'::jsonb,
  content_hash text UNIQUE CHECK (content_hash IS NULL OR content_hash ~ '^[0-9a-f]{64}$'),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (season_id, label),
  CHECK ((status = 'draft') = (published_at IS NULL)),
  CHECK (status = 'draft' OR content_hash IS NOT NULL)
);
CREATE INDEX data_versions_derived ON app_private.data_versions (derived_from);

-- Season facts per immutable data version (keyed by version so a published
-- snapshot never changes). Holds the mandatory portrait (ADR-017).
CREATE TABLE app_private.player_seasons (
  data_version_id uuid NOT NULL REFERENCES app_private.data_versions (id) ON DELETE RESTRICT,
  player_id uuid NOT NULL REFERENCES app_private.players (id) ON DELETE RESTRICT,
  franchise_id uuid REFERENCES app_private.franchises (id) ON DELETE RESTRICT,
  capped_status text NOT NULL CHECK (capped_status IN ('capped', 'uncapped', 'unknown')),
  overseas boolean NOT NULL,
  availability text NOT NULL DEFAULT 'unknown' CHECK (availability IN ('available', 'unavailable', 'unknown')),
  capability_tags text[] NOT NULL DEFAULT '{}' CHECK (
    capability_tags <@ ARRAY['top_order', 'middle_order', 'finisher', 'keeper', 'pace', 'spin',
      'powerplay_bowler', 'death_bowler', 'batting_capable', 'bowling_capable', 'all_round']::text[]
  ),
  portrait_asset_id uuid REFERENCES app_private.media_assets (id) ON DELETE RESTRICT,
  source_id uuid NOT NULL REFERENCES app_private.data_sources (id) ON DELETE RESTRICT,
  PRIMARY KEY (data_version_id, player_id)
);
CREATE INDEX player_seasons_player ON app_private.player_seasons (player_id);
CREATE INDEX player_seasons_franchise ON app_private.player_seasons (franchise_id);
CREATE INDEX player_seasons_portrait ON app_private.player_seasons (portrait_asset_id);
CREATE INDEX player_seasons_source ON app_private.player_seasons (source_id);

CREATE TABLE app_private.player_statistics (
  data_version_id uuid NOT NULL REFERENCES app_private.data_versions (id) ON DELETE RESTRICT,
  player_id uuid NOT NULL REFERENCES app_private.players (id) ON DELETE RESTRICT,
  metric text NOT NULL CHECK (metric ~ '^[a-z_]{2,40}$'),
  segment text NOT NULL CHECK (segment IN ('overall', 'powerplay', 'middle', 'death', 'recent')),
  -- NULL means unavailable; it is never coerced to zero (rules §3.1).
  value numeric,
  exposure numeric CHECK (exposure IS NULL OR exposure >= 0),
  units text NOT NULL CHECK (char_length(units) BETWEEN 1 AND 30),
  source_id uuid NOT NULL REFERENCES app_private.data_sources (id) ON DELETE RESTRICT,
  confidence numeric NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  PRIMARY KEY (data_version_id, player_id, metric, segment)
);
CREATE INDEX player_statistics_player ON app_private.player_statistics (player_id);
CREATE INDEX player_statistics_source ON app_private.player_statistics (source_id);

CREATE TABLE app_private.player_ratings (
  data_version_id uuid NOT NULL REFERENCES app_private.data_versions (id) ON DELETE RESTRICT,
  player_id uuid NOT NULL REFERENCES app_private.players (id) ON DELETE RESTRICT,
  model_version text NOT NULL CHECK (char_length(model_version) BETWEEN 1 AND 40),
  metric text NOT NULL CHECK (metric IN ('batting', 'bowling', 'fielding', 'form', 'experience', 'versatility',
    'powerplay_batting', 'middle_batting', 'death_batting', 'powerplay_bowling', 'middle_bowling',
    'death_bowling', 'keeping', 'role_strength')),
  points integer NOT NULL CHECK (points BETWEEN 0 AND 1000),
  completeness numeric NOT NULL CHECK (completeness BETWEEN 0 AND 1),
  provenance text NOT NULL CHECK (provenance IN ('observed', 'estimated', 'demo')),
  PRIMARY KEY (data_version_id, player_id, model_version, metric)
);
CREATE INDEX player_ratings_rank ON app_private.player_ratings (data_version_id, metric, points);
CREATE INDEX player_ratings_player ON app_private.player_ratings (player_id);

-- --------------------------------------------------------- card definitions (P)
CREATE TABLE app_private.card_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data_version_id uuid NOT NULL REFERENCES app_private.data_versions (id) ON DELETE RESTRICT,
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 120),
  rarity text NOT NULL CHECK (rarity IN ('normal', 'bronze', 'silver', 'gold', 'platinum', 'dual_platinum')),
  stars smallint NOT NULL CHECK (stars BETWEEN 1 AND 5),
  stars_provisional boolean NOT NULL DEFAULT false,
  -- {batting, bowling, fielding, form, experience, versatility}: integers 0..1000.
  ratings jsonb NOT NULL CHECK (
    jsonb_typeof(ratings) = 'object'
    AND ratings ?& ARRAY['batting', 'bowling', 'fielding', 'form', 'experience', 'versatility']
  ),
  art_asset_id uuid REFERENCES app_private.media_assets (id) ON DELETE RESTRICT,
  model_version text NOT NULL,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX card_definitions_version_rarity ON app_private.card_definitions (data_version_id, rarity);
CREATE INDEX card_definitions_art ON app_private.card_definitions (art_asset_id);

CREATE TABLE app_private.card_players (
  card_id uuid NOT NULL REFERENCES app_private.card_definitions (id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES app_private.players (id) ON DELETE RESTRICT,
  position smallint NOT NULL CHECK (position IN (1, 2)),
  PRIMARY KEY (card_id, player_id),
  UNIQUE (card_id, position)
);
CREATE INDEX card_players_player ON app_private.card_players (player_id);

-- --------------------------------------------------------- auction rulesets (P)
CREATE TABLE app_private.auction_rulesets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (name ~ '^[A-Z0-9_]{3,60}$'),
  season_id uuid NOT NULL REFERENCES app_private.seasons (id) ON DELETE RESTRICT,
  data_version_id uuid NOT NULL REFERENCES app_private.data_versions (id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  rules jsonb NOT NULL CHECK (jsonb_typeof(rules) = 'object'),
  source_manifest jsonb NOT NULL DEFAULT '[]'::jsonb,
  rules_hash text NOT NULL UNIQUE CHECK (rules_hash ~ '^[0-9a-f]{64}$'),
  evaluator_version text NOT NULL,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name, version)
);
CREATE INDEX auction_rulesets_season ON app_private.auction_rulesets (season_id);
CREATE INDEX auction_rulesets_data_version ON app_private.auction_rulesets (data_version_id);

CREATE TABLE app_private.auction_pool_entries (
  ruleset_id uuid NOT NULL REFERENCES app_private.auction_rulesets (id) ON DELETE RESTRICT,
  player_id uuid NOT NULL REFERENCES app_private.players (id) ON DELETE RESTRICT,
  previous_franchise_id uuid REFERENCES app_private.franchises (id) ON DELETE RESTRICT,
  base_price bigint NOT NULL CHECK (base_price > 0),
  capped_status text NOT NULL CHECK (capped_status IN ('capped', 'uncapped', 'unknown')),
  set_label text NOT NULL DEFAULT 'pool' CHECK (char_length(set_label) BETWEEN 1 AND 40),
  set_order integer NOT NULL CHECK (set_order >= 0),
  source_id uuid NOT NULL REFERENCES app_private.data_sources (id) ON DELETE RESTRICT,
  PRIMARY KEY (ruleset_id, player_id)
);
CREATE INDEX auction_pool_entries_order ON app_private.auction_pool_entries (ruleset_id, set_order);
CREATE INDEX auction_pool_entries_player ON app_private.auction_pool_entries (player_id);
CREATE INDEX auction_pool_entries_previous ON app_private.auction_pool_entries (previous_franchise_id);
CREATE INDEX auction_pool_entries_source ON app_private.auction_pool_entries (source_id);

-- ------------------------------------------------------ immutability triggers
CREATE OR REPLACE FUNCTION app_private.guard_data_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'published data version % cannot be deleted; archive it', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'archived' THEN
    RAISE EXCEPTION 'archived data version % is immutable', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'published' THEN
    IF NEW.status <> 'archived'
       OR (to_jsonb(NEW) - 'status') <> (to_jsonb(OLD) - 'status') THEN
      RAISE EXCEPTION 'published data version % is immutable; publish a new version', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER data_versions_guard BEFORE UPDATE OR DELETE ON app_private.data_versions
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_data_version();

-- Child rows of a non-draft version cannot be inserted, changed or removed.
CREATE OR REPLACE FUNCTION app_private.guard_version_child()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  version_ids uuid[];
  frozen integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    version_ids := ARRAY[NEW.data_version_id];
  ELSIF TG_OP = 'DELETE' THEN
    version_ids := ARRAY[OLD.data_version_id];
  ELSE
    version_ids := ARRAY[OLD.data_version_id, NEW.data_version_id];
  END IF;
  SELECT count(*) INTO frozen FROM app_private.data_versions
   WHERE id = ANY (version_ids) AND status <> 'draft';
  IF frozen > 0 THEN
    RAISE EXCEPTION '% rows of a published data version are immutable', TG_TABLE_NAME
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;
CREATE TRIGGER player_seasons_guard BEFORE INSERT OR UPDATE OR DELETE ON app_private.player_seasons
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_version_child();
CREATE TRIGGER player_statistics_guard BEFORE INSERT OR UPDATE OR DELETE ON app_private.player_statistics
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_version_child();
CREATE TRIGGER player_ratings_guard BEFORE INSERT OR UPDATE OR DELETE ON app_private.player_ratings
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_version_child();
CREATE TRIGGER card_definitions_guard BEFORE INSERT OR UPDATE OR DELETE ON app_private.card_definitions
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_version_child();

CREATE OR REPLACE FUNCTION app_private.guard_card_players()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  card_ids uuid[];
  frozen integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    card_ids := ARRAY[NEW.card_id];
  ELSIF TG_OP = 'DELETE' THEN
    card_ids := ARRAY[OLD.card_id];
  ELSE
    card_ids := ARRAY[OLD.card_id, NEW.card_id];
  END IF;
  SELECT count(*) INTO frozen
    FROM app_private.card_definitions d JOIN app_private.data_versions v ON v.id = d.data_version_id
   WHERE d.id = ANY (card_ids) AND v.status <> 'draft';
  IF frozen > 0 THEN
    RAISE EXCEPTION 'card players of a published data version are immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;
CREATE TRIGGER card_players_guard BEFORE INSERT OR UPDATE OR DELETE ON app_private.card_players
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_card_players();

-- Dual cards have exactly two distinct players; every other rarity exactly one.
CREATE OR REPLACE FUNCTION app_private.check_card_player_count()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  card uuid;
  card_rarity text;
  n integer;
BEGIN
  -- NEW/OLD have different shapes per table, so resolve the card id per table.
  IF TG_TABLE_NAME = 'card_definitions' THEN
    card := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    card := OLD.card_id;
  ELSE
    card := NEW.card_id;
  END IF;
  SELECT rarity INTO card_rarity FROM app_private.card_definitions WHERE id = card;
  IF card_rarity IS NULL THEN
    RETURN NULL; -- definition deleted in the same transaction
  END IF;
  SELECT count(*) INTO n FROM app_private.card_players WHERE card_id = card;
  IF (card_rarity = 'dual_platinum' AND n <> 2) OR (card_rarity <> 'dual_platinum' AND n <> 1) THEN
    RAISE EXCEPTION 'card % (%): expected % player(s), found %', card, card_rarity,
      CASE WHEN card_rarity = 'dual_platinum' THEN 2 ELSE 1 END, n
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;
CREATE CONSTRAINT TRIGGER card_players_count AFTER INSERT OR UPDATE OR DELETE ON app_private.card_players
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app_private.check_card_player_count();
CREATE CONSTRAINT TRIGGER card_definitions_count AFTER INSERT OR UPDATE ON app_private.card_definitions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app_private.check_card_player_count();

CREATE OR REPLACE FUNCTION app_private.guard_ruleset()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'published ruleset % cannot be deleted', OLD.id USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'archived'
     OR (OLD.status = 'published'
         AND (NEW.status <> 'archived' OR (to_jsonb(NEW) - 'status') <> (to_jsonb(OLD) - 'status'))) THEN
    RAISE EXCEPTION 'published ruleset % is immutable', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER auction_rulesets_guard BEFORE UPDATE OR DELETE ON app_private.auction_rulesets
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_ruleset();

CREATE OR REPLACE FUNCTION app_private.guard_pool_entry()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  ruleset_ids uuid[];
  frozen integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    ruleset_ids := ARRAY[NEW.ruleset_id];
  ELSIF TG_OP = 'DELETE' THEN
    ruleset_ids := ARRAY[OLD.ruleset_id];
  ELSE
    ruleset_ids := ARRAY[OLD.ruleset_id, NEW.ruleset_id];
  END IF;
  SELECT count(*) INTO frozen FROM app_private.auction_rulesets
   WHERE id = ANY (ruleset_ids) AND status <> 'draft';
  IF frozen > 0 THEN
    RAISE EXCEPTION 'pool entries of a published ruleset are immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;
CREATE TRIGGER auction_pool_entries_guard BEFORE INSERT OR UPDATE OR DELETE ON app_private.auction_pool_entries
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_pool_entry();

DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['guard_data_version()', 'guard_version_child()', 'guard_card_players()',
    'check_card_player_count()', 'guard_ruleset()', 'guard_pool_entry()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION app_private.%s FROM PUBLIC', f);
  END LOOP;
END
$$;

-- ------------------------------------------------------------------ security
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'data_sources', 'seasons', 'media_assets', 'franchises', 'season_franchises', 'players',
    'player_external_ids', 'data_versions', 'player_seasons', 'player_statistics',
    'player_ratings', 'card_definitions', 'card_players', 'auction_rulesets', 'auction_pool_entries'
  ] LOOP
    EXECUTE format('ALTER TABLE app_private.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE app_private.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY backend_runtime ON app_private.%I TO app_runtime USING (true) WITH CHECK (true)', t);
    -- Catalog drafts are authored through the admin module; deletes are limited
    -- to drafts by the triggers above.
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON app_private.%I TO app_runtime', t);
  END LOOP;
END
$$;
