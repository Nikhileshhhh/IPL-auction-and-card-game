-- 052: complete tie engine and card termination (phase 08, ADR-023).
-- card_comparisons.fallback audits how an exhausted or capped tie was settled
-- (stat sums, or the committed seat order). card_games.pending_reason records an
-- end that waits for the current chain to settle (soft time limit or vote);
-- finish_pending stays the boolean view of it.

ALTER TABLE app_private.card_comparisons
  ADD COLUMN fallback jsonb CHECK (fallback IS NULL OR jsonb_typeof(fallback) = 'object');

ALTER TABLE app_private.card_games
  ADD COLUMN pending_reason text CHECK (pending_reason IS NULL OR pending_reason IN ('time_limit', 'vote'));
ALTER TABLE app_private.card_games
  ADD CONSTRAINT card_games_pending_consistent CHECK (finish_pending = (pending_reason IS NOT NULL));
