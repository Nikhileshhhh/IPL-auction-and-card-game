'use client';

import { cx } from '@stumps/ui';
import { useServerNow } from '@/features/cards/arena/useServerClock';

/** Screen readers hear the clock at 10 s, 5 s and when it runs out, never every second. */
function milestone(left: number): string {
  if (left <= 0) return 'Time is up';
  if (left <= 5) return '5 seconds left';
  if (left <= 10) return '10 seconds left';
  return '';
}

/**
 * The lot countdown on the server clock. It is a display only: the server
 * decides when bidding closes, and a bid that arrives at the deadline is late.
 */
export function LotClock({
  deadline,
  serverNow,
  total,
  label,
}: {
  deadline: string | null;
  serverNow: string;
  total: number;
  label: string;
}) {
  const now = useServerNow(serverNow);
  if (!deadline) return null;
  const ms = new Date(deadline).getTime() - now;
  const left = Math.max(0, Math.ceil(ms / 1000));
  const frac = Math.max(0, Math.min(1, ms / (Math.max(1, total) * 1000)));
  const urgent = left <= 5;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs tracking-wide text-ink-3 uppercase">{label}</span>
        <span
          aria-hidden="true"
          className={cx(
            'font-display text-2xl font-bold tabular-nums',
            urgent ? 'text-warn' : 'text-ink',
          )}
        >
          {left}s
        </span>
      </div>
      <div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-overlay">
        <div
          className={cx(
            'h-full rounded-full transition-[width] duration-300 ease-linear',
            urgent ? 'bg-warn' : 'bg-auction',
          )}
          style={{ width: `${frac * 100}%` }}
        />
      </div>
      <span className="sr-only" aria-live="polite">
        {milestone(left)}
      </span>
    </div>
  );
}
