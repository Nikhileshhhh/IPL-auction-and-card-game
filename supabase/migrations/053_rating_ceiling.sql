-- 053: rating ceiling 1010 (display 101) for product-owner card overrides
-- (ADR-022 amendment). The computed model never exceeds 1000; only Sachin
-- Tendulkar's Gold card shows 101. Widening the check keeps every existing row valid.

ALTER TABLE app_private.card_contributions DROP CONSTRAINT card_contributions_metric_points_check;
ALTER TABLE app_private.card_contributions ADD CONSTRAINT card_contributions_metric_points_check
  CHECK (metric_points IS NULL OR metric_points BETWEEN 0 AND 1010);
