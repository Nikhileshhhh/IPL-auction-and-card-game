'use client';

import { METRIC_LABELS, type CardMetric } from '@stumps/contracts';
import { cx } from '@stumps/ui';
import { metricRows, type ArenaView } from './model';

/**
 * Category buttons (S09 `CategoryControls`): the stats of the viewer's card in
 * play, in fixed enum order. Only the selector's tiles are enabled and they
 * freeze while a choice is pending. Hovering or focusing a tile previews it
 * on the card; choosing is a separate, explicit click.
 */
export function CategoryControls({
  view,
  pending,
  chosen,
  onChoose,
  onPreview,
  waitingLabel,
}: {
  view: ArenaView;
  pending: boolean;
  chosen: CardMetric | null;
  onChoose: (metric: CardMetric) => void;
  onPreview: (metric: CardMetric | null) => void;
  waitingLabel: string;
}) {
  const enabled = view.canSelect && !pending;
  return (
    <section aria-labelledby="categories-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2
          id="categories-heading"
          className="font-display text-lg font-bold tracking-wide text-ink uppercase"
        >
          {view.canSelect ? 'Pick a stat from your card' : 'Your card in play'}
        </h2>
        {!view.canSelect ? <p className="text-sm text-ink-2">{waitingLabel}</p> : null}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" onMouseLeave={() => onPreview(null)}>
        {metricRows(view.myCard).map(({ metric, value }) => (
          <button
            key={metric}
            type="button"
            disabled={!enabled}
            aria-pressed={chosen === metric}
            onClick={() => onChoose(metric)}
            onMouseEnter={() => onPreview(metric)}
            onFocus={() => onPreview(metric)}
            onBlur={() => onPreview(null)}
            className={cx(
              'group relative flex min-h-14 flex-col justify-center overflow-hidden rounded-xl border px-3 py-2 text-left',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
              enabled
                ? 'arena-pick border-card/60 bg-[#0f2236] text-ink hover:bg-[#143049]'
                : 'cursor-not-allowed border-white/10 bg-black/25 text-ink-2',
              chosen === metric && 'border-card bg-card/20',
            )}
          >
            <span className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium">{METRIC_LABELS[metric]}</span>
              <span className="font-display text-2xl leading-none font-bold text-ink tabular-nums">
                {value === null ? <span className="sr-only">no card</span> : value}
              </span>
            </span>
            {value !== null ? (
              <span aria-hidden="true" className="mt-1.5 block h-1 rounded-full bg-white/10">
                <span
                  className={cx('block h-full rounded-full', enabled ? 'bg-card' : 'bg-white/35')}
                  style={{ width: `${value}%` }}
                />
              </span>
            ) : null}
          </button>
        ))}
      </div>
    </section>
  );
}
