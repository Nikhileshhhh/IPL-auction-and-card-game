-- 130: noncritical UI preferences (phase 16, ADR-031).
-- Motion, sound effects and low-data mode follow the member across devices.
-- Nothing here affects gameplay, authority or results; a missing row means
-- the defaults (follow the system motion setting, sound off, full images).
CREATE TABLE app_private.ui_preferences (
  user_id uuid PRIMARY KEY REFERENCES app_private.profiles (user_id) ON DELETE CASCADE,
  motion text NOT NULL DEFAULT 'system' CHECK (motion IN ('system', 'reduce', 'full')),
  sound_effects boolean NOT NULL DEFAULT false,
  low_data boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER ui_preferences_touch BEFORE UPDATE ON app_private.ui_preferences
  FOR EACH ROW EXECUTE FUNCTION app_private.touch_updated_at();

ALTER TABLE app_private.ui_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.ui_preferences FORCE ROW LEVEL SECURITY;
CREATE POLICY backend_runtime ON app_private.ui_preferences TO app_runtime USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON app_private.ui_preferences TO app_runtime;
