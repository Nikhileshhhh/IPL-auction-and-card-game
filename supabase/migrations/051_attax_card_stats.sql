-- 051: Attax card stats (ADR-022). Cards carry Batting, Bowling and Runs, and
-- those are the game's categories. Published versions are immutable, so rows
-- written before this migration keep the earlier six-stat shape: the new
-- checks apply to new rows only (NOT VALID) and existing rows stay untouched.

ALTER TABLE app_private.card_definitions DROP CONSTRAINT card_definitions_ratings_check;
ALTER TABLE app_private.card_definitions ADD CONSTRAINT card_definitions_ratings_check CHECK (
  jsonb_typeof(ratings) = 'object' AND ratings ?& ARRAY['batting', 'bowling', 'runs']
) NOT VALID;

ALTER TABLE app_private.card_comparisons DROP CONSTRAINT card_comparisons_metric_check;
ALTER TABLE app_private.card_comparisons ADD CONSTRAINT card_comparisons_metric_check CHECK (
  metric IS NULL OR metric IN ('batting', 'bowling', 'runs')
) NOT VALID;
