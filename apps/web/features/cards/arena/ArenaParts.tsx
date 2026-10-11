'use client';

import type { RoomMemberSummary } from '@stumps/contracts';
import { cx } from '@stumps/ui';
import { secondsLeft } from './model';
import { useServerNow } from './useServerClock';

/** Screen readers hear the countdown only at milestones, never every second. */
function milestone(left: number | null): string {
  if (left === null || left > 10) return '';
  return left > 5 ? '10 seconds left' : '5 seconds left';
}

/** Circular countdown on the server clock; the server alone decides the deadline. */
export function TimerRing({
  deadline,
  serverNow,
  total,
}: {
  deadline: string | null;
  serverNow: string;
  total: number;
}) {
  const now = useServerNow(serverNow);
  const left = secondsLeft(deadline, now);
  if (left === null) return null;
  const r = 20;
  const c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, left / Math.max(1, total)));
  const urgent = left <= 5;
  return (
    <div className="relative grid h-14 w-14 place-items-center">
      <svg
        aria-hidden="true"
        viewBox="0 0 48 48"
        className="absolute inset-0 h-full w-full -rotate-90"
      >
        <circle cx="24" cy="24" r={r} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="4" />
        <circle
          cx="24"
          cy="24"
          r={r}
          fill="none"
          stroke={urgent ? 'var(--status-warning)' : 'var(--accent-card)'}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
          className="transition-[stroke-dashoffset] duration-300 ease-linear"
        />
      </svg>
      <span
        aria-hidden="true"
        className={cx(
          'font-display text-lg font-bold tabular-nums',
          urgent ? 'text-warn' : 'text-ink',
        )}
      >
        {left}
      </span>
      <span className="sr-only" aria-live="polite">
        {milestone(left)}
      </span>
    </div>
  );
}

function initials(name: string) {
  return (
    name
      .split(/[\s_]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join('') || '?'
  );
}

/** A small stack of card backs with the count on top (deck sizes, never identities). */
export function DeckStack({ count, label }: { count: number; label: string }) {
  const layers = Math.min(3, Math.max(1, Math.ceil(count / 8)));
  return (
    <span
      className="relative inline-grid h-10 w-8 place-items-center"
      aria-hidden="true"
      data-label={label}
    >
      {Array.from({ length: layers }, (_, i) => (
        <span
          key={i}
          aria-hidden="true"
          className="stumps-card-back absolute h-9 w-7"
          style={{ transform: `translate(${i * 2}px, ${-i * 2}px)` }}
        />
      ))}
      <span aria-hidden="true" className="relative font-display text-sm font-bold text-white">
        {count}
      </span>
    </span>
  );
}

/** Seat plate: avatar, name, deck stack, wins and the current status. */
export function PlayerPlate({
  memberId,
  members,
  me,
  deckCount,
  contestsWon,
  status,
  active,
}: {
  memberId: string;
  members: readonly RoomMemberSummary[];
  me: string;
  deckCount: number;
  contestsWon: number;
  status: string;
  active: boolean;
}) {
  const name = members.find((m) => m.id === memberId)?.displayName ?? 'Former player';
  const mine = memberId === me;
  return (
    <div
      className={cx(
        'flex items-center gap-3 rounded-2xl border px-3 py-2 backdrop-blur-sm',
        active ? 'border-card/70 bg-card/10' : 'border-white/10 bg-black/30',
      )}
    >
      <span
        aria-hidden="true"
        className={cx(
          'grid h-9 w-9 shrink-0 place-items-center rounded-full font-display text-sm font-bold',
          mine ? 'bg-card text-midnight' : 'bg-white/10 text-ink',
        )}
      >
        {initials(name)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-ink">
          {name}
          {mine ? ' (you)' : ''}
        </span>
        <span className={cx('block text-xs', active ? 'text-card' : 'text-ink-2')}>{status}</span>
      </span>
      <span className="flex items-center gap-2 text-right">
        <span className="text-[11px] leading-tight text-ink-2">
          <span className="block">{contestsWon} won</span>
          <span className="block">{deckCount} in deck</span>
        </span>
        <DeckStack count={deckCount} label={`${deckCount} cards in deck`} />
      </span>
    </div>
  );
}
