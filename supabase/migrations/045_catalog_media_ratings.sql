-- 045: real-data catalog (Cricsheet facts), photo rights evidence, ratings
-- presentation and import bookkeeping (phase 06, ADR-017, ADR-018).
-- Forward-only: alters 020 tables without editing that applied file.

-- --------------------------------------------------------------- players (P)
-- Cricsheet supplies no country or batting/bowling style. Unknown is NULL and
-- renders "Not available"; it is never guessed (rules §3.1).
ALTER TABLE app_private.players ALTER COLUMN country_code DROP NOT NULL;
ALTER TABLE app_private.players
  ADD COLUMN role_reviewed boolean NOT NULL DEFAULT false,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

-- ------------------------------------------------------------ player_seasons
-- Overseas status is unknown until reviewed; the role is derived per version.
ALTER TABLE app_private.player_seasons ALTER COLUMN overseas DROP NOT NULL;
ALTER TABLE app_private.player_seasons
  ADD COLUMN role text CHECK (role IS NULL OR role IN ('batter', 'bowler', 'all_rounder', 'wicketkeeper')),
  ADD COLUMN team_name text CHECK (team_name IS NULL OR char_length(team_name) <= 80);

-- --------------------------------------------------------------- media_assets
-- 'free-license': a freely licensed photo (e.g. Wikimedia Commons CC BY-SA)
-- with the licence, author and file page recorded and credited on the card.
ALTER TABLE app_private.media_assets DROP CONSTRAINT media_assets_rights_basis_check;
ALTER TABLE app_private.media_assets
  ADD CONSTRAINT media_assets_rights_basis_check
    CHECK (rights_basis IN ('original-generated', 'licensed', 'user-upload', 'free-license')),
  ADD COLUMN licence_label text CHECK (licence_label IS NULL OR char_length(licence_label) <= 80),
  ADD COLUMN licence_url text CHECK (licence_url IS NULL OR (licence_url ~ '^https://' AND char_length(licence_url) <= 300)),
  ADD COLUMN author text CHECK (author IS NULL OR char_length(author) <= 200),
  ADD COLUMN source_page_url text CHECK (source_page_url IS NULL OR (source_page_url ~ '^https://' AND char_length(source_page_url) <= 500)),
  ADD COLUMN content_sha256 text CHECK (content_sha256 IS NULL OR content_sha256 ~ '^[0-9a-f]{64}$'),
  ADD COLUMN player_id uuid REFERENCES app_private.players (id) ON DELETE RESTRICT,
  ADD COLUMN reviewed_by uuid REFERENCES app_private.profiles (user_id) ON DELETE SET NULL,
  ADD COLUMN reviewed_at timestamptz,
  ADD COLUMN review_note text CHECK (review_note IS NULL OR char_length(review_note) <= 300),
  ADD CONSTRAINT media_assets_free_license_evidence CHECK (
    rights_basis <> 'free-license'
    OR (licence_label IS NOT NULL AND author IS NOT NULL AND source_page_url IS NOT NULL AND attribution IS NOT NULL)
  );
CREATE INDEX media_assets_player ON app_private.media_assets (player_id, purpose, rights_status);
CREATE INDEX media_assets_reviewer ON app_private.media_assets (reviewed_by);
CREATE UNIQUE INDEX media_assets_content ON app_private.media_assets (content_sha256) WHERE content_sha256 IS NOT NULL;

-- --------------------------------------------------------------- data_versions
ALTER TABLE app_private.data_versions
  ADD COLUMN window_label text CHECK (window_label IS NULL OR char_length(window_label) <= 120),
  ADD COLUMN ratings_model text CHECK (ratings_model IS NULL OR char_length(ratings_model) <= 40),
  ADD COLUMN validation_report jsonb CHECK (validation_report IS NULL OR octet_length(validation_report::text) <= 65536);

-- ----------------------------------------------------------- card_definitions
ALTER TABLE app_private.card_definitions
  ADD COLUMN card_key text CHECK (card_key IS NULL OR char_length(card_key) <= 200),
  ADD COLUMN completeness_permille smallint CHECK (completeness_permille IS NULL OR completeness_permille BETWEEN 0 AND 1000),
  ADD COLUMN estimated text[] NOT NULL DEFAULT '{}';
CREATE UNIQUE INDEX card_definitions_key ON app_private.card_definitions (data_version_id, card_key)
  WHERE card_key IS NOT NULL;

-- ------------------------------------------------------------ catalog_imports (O)
CREATE TABLE app_private.catalog_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('cricsheet', 'demo', 'photos')),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'failed')),
  data_version_id uuid REFERENCES app_private.data_versions (id) ON DELETE SET NULL,
  source_id uuid REFERENCES app_private.data_sources (id) ON DELETE SET NULL,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (octet_length(summary::text) <= 65536),
  created_by uuid REFERENCES app_private.profiles (user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX catalog_imports_version ON app_private.catalog_imports (data_version_id);
CREATE INDEX catalog_imports_source ON app_private.catalog_imports (source_id);
CREATE INDEX catalog_imports_creator ON app_private.catalog_imports (created_by);
CREATE INDEX catalog_imports_time ON app_private.catalog_imports (created_at);

ALTER TABLE app_private.catalog_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.catalog_imports FORCE ROW LEVEL SECURITY;
CREATE POLICY backend_runtime ON app_private.catalog_imports TO app_runtime USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON app_private.catalog_imports TO app_runtime;
