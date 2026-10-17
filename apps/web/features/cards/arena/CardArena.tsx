'use client';

import { SoundToggle } from '@/features/preferences/SoundToggle';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { METRIC_LABELS, type CardMetric } from '@stumps/contracts';
import { Button, Skeleton, StatusMessage, cx } from '@stumps/ui';
import { useRoom } from '@/features/room/useRoom';
import { ChatDrawer } from '@/features/chat/ChatDrawer';
import { EndGameVote } from '@/features/voting/EndGameVote';
import { TimerRing } from './ArenaParts';
import { BattleZone } from './BattleZone';
import { CategoryControls } from './CategoryControls';
import { ComparisonSheet } from './ComparisonSheet';
import { DeckQueue } from './DeckQueue';
import { MatchResult } from './MatchResult';
import { arenaView, seatName, type CardGame } from './model';
import { RoundWinnerReveal } from './RoundWinnerReveal';
import { RecoveryBanner } from '@/features/reconnect/RecoveryBanner';
import { FinishPendingNotice } from '../tie-arena/FinishPendingNotice';
import { PotHistory } from '../tie-arena/PotHistory';
import { TieBanner } from '../tie-arena/TieBanner';

/**
 * S09 card arena. Everything shown is the last confirmed server snapshot:
 * the selector, revealed cards, pot, deck counts and the viewer's own deck
 * queue. A category choice is a command; the arena only changes when the
 * server's next snapshot arrives.
 */
export function CardArena({ roomId }: { roomId: string }) {
  const router = useRouter();
  const { status, room, connection } = useRoom(roomId);
  const [pending, setPending] = useState<CardMetric | null>(null);
  const [preview, setPreview] = useState<CardMetric | null>(null);
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
      setPreview(null);
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
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-[420px] w-full" />
        <Skeleton className="h-28 w-full" />
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
  const selectionSeconds = Number(snap.room.settings.selectionSeconds ?? 20);

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
      : `${selectorName} is choosing a stat.`;
  const highlight = pending ?? preview ?? undefined;

  return (
    <div className="arena-stage flex flex-col gap-5 p-4 sm:p-6">
      {/* HUD */}
      <header className="relative z-10 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold tracking-wide text-ink uppercase sm:text-3xl">
            {snap.room.name}
          </h1>
          <p className="text-sm text-ink-2">
            {game.totalCards} cards · contest {game.completedContests + (game.comparisonId ? 1 : 0)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <span className="flex items-center gap-2 rounded-full border border-card/50 bg-black/40 px-3 py-1.5 text-sm text-ink">
            <span
              aria-hidden="true"
              className="stumps-card-back inline-block h-5 w-4 rounded-[4px]"
            />
            Pot <span className="font-display text-lg leading-none font-bold">{game.potCount}</span>
          </span>
          <PotHistory game={game} members={members} />
          <Button size="touch" variant="secondary" onClick={() => setSheetOpen(true)}>
            Comparison
          </Button>
          <EndGameVote snapshot={snap} connection={connection} status={status} />
          <SoundToggle />
          <ChatDrawer roomId={roomId} connection={connection} status={status} hasTeams={false} />
        </div>
      </header>

      <FinishPendingNotice game={game} />
      <RecoveryBanner recoveryUntil={snap.recoveryUntil} serverNow={snap.serverNow} />

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

      <RoundWinnerReveal game={game} members={members} me={me} />

      {game.result ? (
        <MatchResult roomId={roomId} game={game} result={game.result} members={members} me={me} />
      ) : (
        <>
          <section
            aria-label="Turn"
            className={cx(
              'relative z-10 flex items-center justify-between gap-3 rounded-2xl border px-4 py-2',
              view.isSelector ? 'border-card/70 bg-card/15' : 'border-white/10 bg-black/35',
            )}
          >
            <div>
              <p
                className={cx(
                  'font-display text-xl font-bold tracking-wide uppercase',
                  view.isSelector ? 'text-card' : 'text-ink',
                )}
              >
                {view.isSelector ? 'Your turn' : `${selectorName} chooses`}
              </p>
              <p className="text-sm text-ink-2">
                {game.isTie
                  ? view.isSelector
                    ? 'Tie round: pick a stat to break the tie.'
                    : 'Tie round: the tied players reveal their next cards.'
                  : view.isSelector
                    ? 'Pick the stat on your card most likely to beat the others.'
                    : 'The highest value of the chosen stat wins every card on the table.'}
              </p>
            </div>
            <TimerRing
              deadline={game.deadline}
              serverNow={snap.serverNow}
              total={selectionSeconds}
            />
          </section>

          <TieBanner game={game} members={members} me={me} />

          <BattleZone
            view={view}
            members={members}
            me={me}
            selector={game.selectorSeat}
            tie={game.isTie}
            highlight={highlight}
          />

          {view.myCard ? (
            <CategoryControls
              view={view}
              pending={pending !== null}
              chosen={pending}
              onChoose={(m) => void choose(m)}
              onPreview={setPreview}
              waitingLabel={waitingLabel}
            />
          ) : (
            <p className="text-sm text-ink-2">{waitingLabel}</p>
          )}
          {pending ? (
            <p role="status" className="text-sm text-ink-2">
              {METRIC_LABELS[pending]} chosen. Waiting for the server…
            </p>
          ) : null}
          {error ? <StatusMessage tone="warning">{error}</StatusMessage> : null}
        </>
      )}

      <DeckQueue inPlay={game.result ? null : view.myCard} deck={game.myDeck} />

      <ComparisonSheet open={sheetOpen} onOpenChange={setSheetOpen} game={game} members={members} />
    </div>
  );
}
