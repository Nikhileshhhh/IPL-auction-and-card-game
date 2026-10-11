'use client';

import { METRIC_LABELS, type CardMetric } from '@stumps/contracts';
import { cx } from '@stumps/ui';
import { metricRows, type ArenaView } from './model';

/**
 * Category buttons (S09 `CategoryControls`). Rows keep enum order between
 * rounds; values are the viewer's own revealed card. Only the selector's
 * buttons are enabled, and they freeze while a choice is pending.
 */
export function CategoryControls({
  view,
  pending,
  chosen,
  onChoose,
  waitingLabel,
}: {
  view: ArenaView;
  pending: boolean;
  chosen: CardMetric | null;
  onChoose: (metric: CardMetric) => void;
  waitingLabel: string;
}) {
  const enabled = view.canSelect && !pending;
  return (
    <section aria-labelledby="categories-heading" className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="categories-heading" className="text-sm font-semibold text-ink">
          {view.canSelect ? 'Choose a category' : 'Categories'}
        </h2>
        {!view.canSelect ? <p className="text-xs text-ink-2">{waitingLabel}</p> : null}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {metricRows(view.myCard).map(({ metric, value }) => (
          <button
            key={metric}
            type="button"
            disabled={!enabled}
            aria-pressed={chosen === metric}
            onClick={() => onChoose(metric)}
            className={cx(
              'flex min-h-12 items-center justify-between rounded-lg border px-3 text-left text-sm',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
              enabled
                ? 'border-card/60 bg-raised text-ink hover:bg-overlay'
                : 'cursor-not-allowed border-line bg-raised/40 text-ink-2 opacity-70',
              chosen === metric && 'border-card bg-card/15',
            )}
          >
            <span>{METRIC_LABELS[metric]}</span>
            <span className="font-semibold tabular-nums text-ink">
              {value === null ? <span className="sr-only">no card</span> : value}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
