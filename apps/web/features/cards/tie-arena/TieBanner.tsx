'use client';

import type { RoomMemberSummary } from '@stumps/contracts';
import { seatName, type CardGame } from '../arena/model';

/**
 * S11 eligibility banner: who is still tied, who started the contest, how many
 * tie rounds are left before the fallback decides, and who is waiting. Players
 * outside the tie keep their cards and return at the next normal round.
 */
export function TieBanner({
  game,
  members,
  me,
}: {
  game: CardGame;
  members: readonly RoomMemberSummary[];
  me: string;
}) {
  if (!game.isTie) return null;
  const names = (ids: readonly string[]) => ids.map((id) => seatName(members, id)).join(', ');
  const roundsLeft = Math.max(0, game.tieCap - game.tieCount);
  const waiting = game.waitingSeats.includes(me);
  return (
    <section
      aria-label="Tie"
      className="relative z-10 flex flex-col gap-2 rounded-2xl border border-[#ffd36b]/60 bg-[#ffd36b]/10 px-4 py-3"
    >
      <p className="font-display text-xl font-bold tracking-wide text-ink uppercase">
        Tie! {names(game.tiedSeats)} reveal again
      </p>
      <ul className="flex flex-col gap-1 text-sm text-ink-2">
        <li>
          The pot holds <strong className="text-ink">{game.potCount} cards</strong>. Only tied
          players with cards left play the next comparison; the winner takes the whole pot.
        </li>
        {game.chainSelector ? (
          <li>
            {seatName(members, game.chainSelector)} started this contest
            {game.selectorSeat && game.selectorSeat !== game.chainSelector
              ? `; ${seatName(members, game.selectorSeat)} chooses now because they are still tied.`
              : ' and chooses again.'}
          </li>
        ) : null}
        <li>
          Tie round {game.tieCount} of {game.tieCap}.{' '}
          {roundsLeft > 0
            ? `After ${roundsLeft} more tie${roundsLeft === 1 ? '' : 's'}, the fallback decides.`
            : 'The fallback decides now.'}
        </li>
        {game.waitingSeats.length > 0 ? (
          <li>
            Waiting until the tie ends: {names(game.waitingSeats)}. They keep their cards and play
            again next round.
          </li>
        ) : null}
      </ul>
      {waiting ? (
        <p role="status" className="text-sm font-semibold text-ink">
          You are waiting until the tie ends.
        </p>
      ) : null}
    </section>
  );
}
