'use client';

import Link from 'next/link';
import type { RoomMemberSummary } from '@stumps/contracts';
import { Surface } from '@stumps/ui';
import { FINISH_LABELS, seatName, type CardGame } from './model';

const PLACES = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'];

/** Final standings and the fairness audit (seed disclosed after completion). */
export function MatchResult({
  game,
  result,
  members,
  me,
}: {
  game: CardGame;
  result: NonNullable<CardGame['result']>;
  members: readonly RoomMemberSummary[];
  me: string;
}) {
  const won = result.standings[0] === me;
  return (
    <Surface className="flex flex-col gap-4 p-5">
      <div>
        <h2 className="font-display text-2xl text-ink">
          {won ? 'You won the match!' : 'Match complete'}
        </h2>
        <p className="text-sm text-ink-2">{FINISH_LABELS[result.reason]}</p>
      </div>
      <ol aria-label="Final standings" className="flex flex-col gap-2">
        {result.standings.map((id, i) => {
          const seat = game.seats.find((s) => s.memberId === id);
          return (
            <li
              key={id}
              className="flex items-center justify-between rounded-lg border border-line bg-raised px-3 py-2"
            >
              <span className="text-ink">
                <span className="mr-2 font-semibold">{PLACES[i]}</span>
                {seatName(members, id)}
                {id === me ? ' (you)' : ''}
              </span>
              <span className="text-sm tabular-nums text-ink-2">
                {seat?.deckCount ?? 0} cards · {seat?.contestsWon ?? 0} won
              </span>
            </li>
          );
        })}
      </ol>
      <details className="text-sm text-ink-2">
        <summary className="cursor-pointer text-ink">Check the fair deal</summary>
        <p className="mt-2">
          Before dealing, the server published a commitment to a secret seed. The seed is now
          revealed: SHA-256(seed ‖ room ID ‖ rules hash) must equal the commitment (
          {game.rngVersion}).
        </p>
        <dl className="mt-2 grid gap-1 break-all font-mono text-xs">
          <dt className="text-ink-3">Commitment</dt>
          <dd className="text-ink">{game.seedCommitment}</dd>
          <dt className="text-ink-3">Seed</dt>
          <dd className="text-ink">{game.auditSeed ?? 'Not yet available'}</dd>
        </dl>
      </details>
      <Link href="/play/cards" className="text-sm text-card underline">
        Back to Card Battle
      </Link>
    </Surface>
  );
}
