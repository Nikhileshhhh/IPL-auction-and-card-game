'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button, Skeleton, StatusMessage, Surface } from '@stumps/ui';
import { useRoom } from '@/features/room/useRoom';
import { seatName, type CardGame } from './model';

const FORWARD_MS = 1_200;

/**
 * S08 preparation. Dealing happens atomically in the server's start
 * transaction, so every stage shown here is already complete when the page
 * has a match snapshot; there is no client Deal button and no fake progress.
 */
export function PreparationView({ roomId }: { roomId: string }) {
  const router = useRouter();
  const { status, room } = useRoom(roomId);
  const [copied, setCopied] = useState(false);
  const game = (room?.snapshot.game ?? null) as CardGame | null;
  const lifecycle = room?.snapshot.room.lifecycle;

  useEffect(() => {
    if (lifecycle === 'LOBBY') router.replace(`/rooms/${roomId}/lobby`);
    if (!game) return;
    const id = setTimeout(() => router.replace(`/rooms/${roomId}/cards`), FORWARD_MS);
    return () => clearTimeout(id);
  }, [game, lifecycle, roomId, router]);

  if (status === 'unavailable') {
    return (
      <StatusMessage tone="warning" title="Room not available">
        <Link href="/play/cards" className="underline">
          Back to Card Battle
        </Link>
      </StatusMessage>
    );
  }
  if (!room || !game) {
    return (
      <div aria-busy="true" aria-label="Preparing the match" className="flex flex-col gap-4">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const members = room.snapshot.room.members;
  const steps = [
    'Roster frozen',
    'Card data version frozen',
    'Fairness commitment published',
    `${game.totalCards} cards dealt, ${game.totalCards / game.seats.length} each`,
  ];
  return (
    <Surface className="mx-auto flex w-full max-w-xl flex-col gap-5 p-5">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">Match ready</h1>
        <p className="text-sm text-ink-2">Taking you to the arena…</p>
      </div>
      <ol aria-label="Preparation" className="flex flex-col gap-2 text-sm">
        {steps.map((s) => (
          <li key={s} className="flex items-center gap-2 text-ink">
            <span aria-hidden="true" className="text-ok">
              ✓
            </span>
            {s}
            <span className="sr-only"> (done)</span>
          </li>
        ))}
      </ol>
      <div>
        <h2 className="text-sm font-semibold text-ink">Seat order</h2>
        <ol className="mt-1 flex flex-wrap gap-2 text-sm text-ink-2">
          {game.seats.map((s) => (
            <li key={s.memberId} className="rounded-full border border-line px-3 py-1">
              {s.seatOrder + 1}. {seatName(members, s.memberId)}
            </li>
          ))}
        </ol>
      </div>
      <div className="text-sm">
        <h2 className="font-semibold text-ink">Seed commitment ({game.rngVersion})</h2>
        <p className="mt-1 break-all font-mono text-xs text-ink-2">{game.seedCommitment}</p>
        <Button
          size="touch"
          variant="tertiary"
          onClick={() =>
            void navigator.clipboard
              .writeText(game.seedCommitment)
              .then(() => setCopied(true))
              .catch(() => undefined)
          }
        >
          {copied ? 'Copied' : 'Copy commitment'}
        </Button>
      </div>
      <Link
        href={`/rooms/${roomId}/cards`}
        className="inline-flex min-h-11 items-center justify-center rounded-lg bg-card px-4 text-sm font-semibold text-midnight"
      >
        Enter the arena
      </Link>
    </Surface>
  );
}
