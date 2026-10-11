'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { METRIC_LABELS, type CardMetric } from '@stumps/contracts';
import { Badge, Button, Skeleton, StatusMessage } from '@stumps/ui';
import { useRoom } from '@/features/room/useRoom';
import { DeckCounts, VisibleCards } from './ArenaTable';
import { CategoryControls } from './CategoryControls';
import { ComparisonSheet } from './ComparisonSheet';
import { MatchResult } from './MatchResult';
import { arenaView, seatName, secondsLeft, type CardGame } from './model';
import { RoundWinnerReveal } from './RoundWinnerReveal';
import { useServerNow } from './useServerClock';

/** Screen readers hear the countdown only at milestones, never every second. */
function milestone(left: number | null): string {
  if (left === null || left > 10) return '';
  return left > 5 ? '10 seconds left' : '5 seconds left';
}

function Countdown({ deadline, serverNow }: { deadline: string | null; serverNow: string }) {
  const now = useServerNow(serverNow);
  const left = secondsLeft(deadline, now);
  const announce = milestone(left);
  if (left === null) return null;
  return (
    <span className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className={`font-semibold tabular-nums ${left <= 5 ? 'text-warn' : 'text-ink'}`}
      >
        0:{String(left).padStart(2, '0')}
      </span>
      <span className="sr-only" aria-live="polite">
        {announce}
      </span>
    </span>
  );
}

/**
 * S09 card arena. Everything shown is the last confirmed server snapshot:
 * the selector, revealed cards, pot and deck counts. A category choice is a
 * command; the arena only changes when the server's next snapshot arrives.
 */
export function CardArena({ roomId }: { roomId: string }) {
  const router = useRouter();
  const { status, room, connection } = useRoom(roomId);
  const [pending, setPending] = useState<CardMetric | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const comparisonRef = useRef<string | null>(null);

  const lifecycle = room?.snapshot.room.lifecycle;
  useEffect(() => {
    if (lifecycle === 'LOBBY') router.replace(`/rooms/${roomId}/lobby`);
  }, [lifecycle, roomId, router]);

  const game = (room?.snapshot.game ?? null) as CardGame | null;
  // A new comparison (or a resync) clears a pending choice and its error.
  useEffect(() => {
    const id = game?.comparisonId ?? null;
    if (comparisonRef.current !== id) {
      comparisonRef.current = id;
      setPending(null);
      setError(null);
    }
  }, [game?.comparisonId]);

  if (status === 'unavailable' || status === 'removed' || status === 'closed') {
    return (
      <StatusMessage tone="warning" title="Match not available">
        This room is closed or you are no longer a member.{' '}
        <Link href="/play/cards" className="underline">
          Back to Card Battle
        </Link>
      </StatusMessage>
    );
  }
  if (!room || !game) {
    return (
      <div aria-busy="true" aria-label="Loading match" className="flex flex-col gap-4">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="h-[340px] w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  const snap = room.snapshot;
  const members = snap.room.members;
  const me = snap.me.memberId;
  const canAct = snap.me.isController && status === 'live';
  const view = arenaView(game, me, canAct);
  const selectorName = seatName(members, game.selectorSeat);
  const offline = status !== 'live';

  const choose = async (metric: CardMetric) => {
    if (!game.comparisonId || pending) return;
    setPending(metric);
    setError(null);
    const res = await connection.command<{ stateVersion: string }>('card.selectCategory', {
      comparisonId: game.comparisonId,
      metric,
    });
    if (res.ok) return; // the next snapshot clears `pending`
    setPending(null);
    if (
      res.error.code === 'STALE_COMPARISON' ||
      res.error.code === 'VERSION_CONFLICT' ||
      res.error.code === 'CONTROL_EPOCH_STALE'
    ) {
      setError('That round changed before your choice arrived. Showing the current round.');
      connection.refresh();
    } else {
      setError(res.error.message);
    }
  };

  const waitingLabel = view.eliminated
    ? 'You are out of cards. You can keep watching.'
    : view.waitingForTie
      ? 'Waiting until the tie ends.'
      : `${selectorName} is choosing.`;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">{snap.room.name}</h1>
          <p className="text-sm text-ink-2">
            {game.totalCards} cards · contest {game.completedContests + (game.comparisonId ? 1 : 0)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone="card">Pot {game.potCount}</Badge>
          <Button size="touch" variant="secondary" onClick={() => setSheetOpen(true)}>
            Comparison
          </Button>
        </div>
      </header>

      {offline ? (
        <StatusMessage tone="warning" title="Reconnecting">
          Actions are paused until the connection is back. The match keeps its state on the server.
        </StatusMessage>
      ) : !snap.me.isController ? (
        <StatusMessage tone="info" title="Watching in this tab">
          Another tab is in control.{' '}
          <button type="button" className="underline" onClick={() => void connection.takeControl()}>
            Take control here
          </button>
        </StatusMessage>
      ) : null}

      <RoundWinnerReveal game={game} members={members} />

      {game.result ? (
        <MatchResult game={game} result={game.result} members={members} me={me} />
      ) : (
        <>
          <section
            aria-label="Turn"
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-raised px-4 py-3"
          >
            <p className="text-base font-semibold text-ink">
              {view.isSelector ? 'Your choice' : `${selectorName} chooses`}
              {game.isTie ? (
                <span className="ml-2 text-sm font-normal text-ink-2">
                  Tie round · {game.tiedSeats.map((id) => seatName(members, id)).join(', ')} reveal
                  again
                </span>
              ) : null}
            </p>
            <Countdown deadline={game.deadline} serverNow={snap.serverNow} />
          </section>

          {game.isTie ? (
            <p className="text-sm text-ink-2">
              The pot holds {game.potCount} cards and grows until one player wins a comparison.
            </p>
          ) : null}

          <VisibleCards view={view} members={members} me={me} highlight={pending ?? undefined} />

          <CategoryControls
            view={view}
            pending={pending !== null}
            chosen={pending}
            onChoose={(m) => void choose(m)}
            waitingLabel={waitingLabel}
          />
          {pending ? (
            <p role="status" className="text-sm text-ink-2">
              {METRIC_LABELS[pending]} chosen. Waiting for the server…
            </p>
          ) : null}
          {error ? <StatusMessage tone="warning">{error}</StatusMessage> : null}
        </>
      )}

      <DeckCounts view={view} members={members} me={me} selector={game.selectorSeat} />

      <ComparisonSheet open={sheetOpen} onOpenChange={setSheetOpen} game={game} members={members} />
    </div>
  );
}
