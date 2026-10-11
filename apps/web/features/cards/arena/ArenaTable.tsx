'use client';

import { useState } from 'react';
import type { CardMetric, RoomMemberSummary } from '@stumps/contracts';
import { Badge, cx } from '@stumps/ui';
import { PremiumCricketCard } from '@/components/cards/PremiumCricketCard';
import { seatName, type ArenaView } from './model';

/** S09 `DeckCounts`: every seat with its deck count, in fixed seat order. */
export function DeckCounts({
  view,
  members,
  me,
  selector,
}: {
  view: ArenaView;
  members: readonly RoomMemberSummary[];
  me: string;
  selector: string | null;
}) {
  return (
    <ul aria-label="Players and deck counts" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {view.seats.map((s) => (
        <li
          key={s.memberId}
          className={cx(
            'flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm',
            s.memberId === selector ? 'border-card bg-card/10' : 'border-line bg-raised',
            s.eliminated && 'opacity-60',
          )}
        >
          <span className="min-w-0">
            <span className="block truncate font-medium text-ink">
              {seatName(members, s.memberId)}
              {s.memberId === me ? ' (you)' : ''}
            </span>
            <span className="block text-xs text-ink-2">
              {s.eliminated
                ? 'Out of cards'
                : s.memberId === selector
                  ? 'Choosing'
                  : `${s.contestsWon} won`}
            </span>
          </span>
          <span className="text-right">
            <span className="block text-lg font-semibold tabular-nums text-ink">{s.deckCount}</span>
            <span className="block text-[11px] text-ink-2">in deck</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Revealed cards. Desktop shows every revealed card in seat order; on small
 * screens the viewer's own card is the main card and opponents are tabs, so
 * nothing needs a swipe. Each card is rendered once; tabs only toggle which
 * opponent card is visible below the `sm` breakpoint.
 */
export function VisibleCards({
  view,
  members,
  me,
  highlight,
}: {
  view: ArenaView;
  members: readonly RoomMemberSummary[];
  me: string;
  highlight: CardMetric | undefined;
}) {
  const revealed = view.seats.flatMap((s) => (s.card ? [{ ...s, card: s.card }] : []));
  const opponents = revealed.filter((s) => s.memberId !== me);
  const [focus, setFocus] = useState<string | null>(null);
  const focused = opponents.find((o) => o.memberId === focus)?.memberId ?? opponents[0]?.memberId;
  if (revealed.length === 0) return null;
  return (
    <section aria-labelledby="revealed-heading" className="flex flex-col gap-3">
      <h2 id="revealed-heading" className="sr-only">
        Revealed cards
      </h2>
      {opponents.length > 1 ? (
        <div
          role="tablist"
          aria-label="Opponent cards"
          className="flex gap-2 overflow-x-auto sm:hidden"
        >
          {opponents.map((o) => (
            <button
              key={o.memberId}
              type="button"
              role="tab"
              aria-selected={o.memberId === focused}
              onClick={() => setFocus(o.memberId)}
              className={cx(
                'min-h-11 shrink-0 rounded-full border px-3 text-sm',
                o.memberId === focused
                  ? 'border-card bg-card/15 text-ink'
                  : 'border-line text-ink-2',
              )}
            >
              {seatName(members, o.memberId)}
            </button>
          ))}
        </div>
      ) : null}
      <ul className="flex flex-wrap justify-center gap-4">
        {revealed.map((s) => {
          const mine = s.memberId === me;
          return (
            <li
              key={s.memberId}
              data-testid="revealed-card"
              className={cx(
                'flex flex-col items-center gap-2',
                mine && 'max-sm:order-first',
                !mine && s.memberId !== focused && 'hidden sm:flex',
              )}
            >
              <span className="flex items-center gap-2 text-sm text-ink">
                {seatName(members, s.memberId)}
                {mine ? <Badge tone="card">You</Badge> : null}
                {view.seats.length > 2 && !s.eligible ? <Badge>Waiting</Badge> : null}
              </span>
              <PremiumCricketCard
                card={s.card}
                size="compact"
                priority={mine}
                {...(highlight ? { highlight } : {})}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
