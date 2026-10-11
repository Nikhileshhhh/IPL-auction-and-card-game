'use client';

import { useState } from 'react';
import type { CardMetric, RoomMemberSummary } from '@stumps/contracts';
import { cx } from '@stumps/ui';
import { PremiumCricketCard } from '@/components/cards/PremiumCricketCard';
import { PlayerPlate } from './ArenaParts';
import { seatName, type ArenaView } from './model';

type Seat = ArenaView['seats'][number];

function statusOf(seat: Seat, selector: string | null, tie: boolean): string {
  if (seat.eliminated) return 'Out of cards';
  if (seat.memberId === selector) return 'Choosing';
  if (tie && !seat.eligible) return 'Waiting until the tie ends';
  return seat.card ? 'Card revealed' : 'Waiting';
}

function SeatColumn({
  seat,
  members,
  me,
  selector,
  tie,
  highlight,
  hidden,
}: {
  seat: Seat;
  members: readonly RoomMemberSummary[];
  me: string;
  selector: string | null;
  tie: boolean;
  highlight: CardMetric | undefined;
  hidden: boolean;
}) {
  const choosing = seat.memberId === selector;
  return (
    <div
      className={cx(
        'flex w-full max-w-[300px] flex-col items-center gap-3',
        hidden && 'max-sm:hidden',
      )}
    >
      <PlayerPlate
        memberId={seat.memberId}
        members={members}
        me={me}
        deckCount={seat.deckCount}
        contestsWon={seat.contestsWon}
        status={statusOf(seat, selector, tie)}
        active={choosing}
      />
      {seat.card ? (
        <div
          key={seat.card.instanceId}
          data-testid="revealed-card"
          className={cx('arena-deal-in rounded-[20px]', choosing && 'arena-selector')}
        >
          <PremiumCricketCard
            card={seat.card}
            size="standard"
            priority={seat.memberId === me}
            className="max-sm:w-[260px]"
            {...(highlight ? { highlight } : {})}
          />
        </div>
      ) : (
        <div className="stumps-card-back grid aspect-[5/7] w-[260px] place-items-center rounded-[18px] p-6 text-center text-sm text-ink-2 sm:w-[300px]">
          {seat.eliminated ? 'Out of cards' : 'Not in this round'}
        </div>
      )}
    </div>
  );
}

/**
 * The battle zone (S09 `VisibleCards`): the viewer's card in play against the
 * other revealed cards, in fixed seat order. On small screens with several
 * opponents, tabs choose which opponent card is shown (no swiping needed).
 */
export function BattleZone({
  view,
  members,
  me,
  selector,
  tie,
  highlight,
}: {
  view: ArenaView;
  members: readonly RoomMemberSummary[];
  me: string;
  selector: string | null;
  tie: boolean;
  highlight: CardMetric | undefined;
}) {
  const mine = view.seats.find((s) => s.memberId === me);
  const opponents = view.seats.filter((s) => s.memberId !== me);
  const [focus, setFocus] = useState<string | null>(null);
  const focused = opponents.find((o) => o.memberId === focus)?.memberId ?? opponents[0]?.memberId;
  const common = { members, me, selector, tie, highlight };
  return (
    <section aria-labelledby="revealed-heading" className="flex flex-col gap-4">
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
                  : 'border-white/15 text-ink-2',
              )}
            >
              {seatName(members, o.memberId)}
            </button>
          ))}
        </div>
      ) : null}
      <div className="flex flex-col items-center gap-5 lg:flex-row lg:items-start lg:justify-center lg:gap-8">
        {mine ? <SeatColumn seat={mine} hidden={false} {...common} /> : null}
        {mine && opponents.length > 0 ? (
          <div
            aria-hidden="true"
            className="arena-vs grid h-14 w-14 shrink-0 place-items-center rounded-full font-display text-xl font-bold text-card lg:mt-56"
          >
            VS
          </div>
        ) : null}
        <div className="flex flex-wrap justify-center gap-6">
          {opponents.map((o) => (
            <SeatColumn key={o.memberId} seat={o} hidden={o.memberId !== focused} {...common} />
          ))}
        </div>
      </div>
    </section>
  );
}
