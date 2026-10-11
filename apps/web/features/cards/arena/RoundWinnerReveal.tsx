'use client';

import { useEffect, useRef, useState } from 'react';
import { METRIC_LABELS, type CardMetric, type RoomMemberSummary } from '@stumps/contracts';
import { Button } from '@stumps/ui';
import { PortraitImage } from '@/components/cards/PortraitImage';
import { seatName, type CardGame } from './model';

interface Reveal {
  comparisonId: string;
  winnerId: string | null;
  metric: CardMetric;
  byTimeout: boolean;
  cards: number;
  portrait: { src: string; alt: string } | null;
}

const SHOW_MS = 4_000;

/**
 * S12 round result: a non-modal banner keyed by the decided comparison.
 * The first snapshot after mount (or reconnect) is history and never
 * celebrated; a repeated comparison ID produces no second banner, and the
 * next decision replaces the current one. Nothing waits for it.
 */
export function RoundWinnerReveal({
  game,
  members,
}: {
  game: CardGame;
  members: readonly RoomMemberSummary[];
}) {
  const seen = useRef<string | null | undefined>(undefined);
  const previous = useRef<CardGame>(game);
  const [reveal, setReveal] = useState<Reveal | null>(null);

  useEffect(() => {
    const last = game.lastComparison;
    const before = previous.current;
    previous.current = game;
    if (seen.current === undefined) {
      seen.current = last?.comparisonId ?? null;
      return;
    }
    if (!last || last.comparisonId === seen.current) return;
    seen.current = last.comparisonId;
    const winnerCard = before.visibleCards.find((v) => v.memberId === last.winnerId)?.card;
    const player = winnerCard?.players[0];
    setReveal({
      comparisonId: last.comparisonId,
      winnerId: last.winnerId,
      metric: last.metric,
      byTimeout: last.byTimeout,
      cards: before.potCount + before.visibleCards.length,
      portrait: player ? { src: player.portraitUrl, alt: player.portraitAlt } : null,
    });
  }, [game]);

  useEffect(() => {
    if (!reveal) return;
    const id = setTimeout(() => setReveal(null), SHOW_MS);
    return () => clearTimeout(id);
  }, [reveal]);

  const text = reveal
    ? reveal.winnerId
      ? `${seatName(members, reveal.winnerId)} wins ${reveal.cards} cards on ${METRIC_LABELS[reveal.metric]}${reveal.byTimeout ? ' (time ran out)' : ''}.`
      : `Tie on ${METRIC_LABELS[reveal.metric]}. The pot carries over.`
    : '';

  return (
    <div id="round-result" aria-live="polite" className="min-h-0">
      {reveal ? (
        <div
          key={reveal.comparisonId}
          className="flex items-center gap-3 rounded-xl border border-card/60 bg-card/10 p-3"
        >
          {reveal.portrait ? (
            <div className="relative h-14 w-11 shrink-0 overflow-hidden rounded-md bg-overlay">
              <PortraitImage src={reveal.portrait.src} alt={reveal.portrait.alt} sizes="44px" />
            </div>
          ) : null}
          <p className="flex-1 text-sm font-medium text-ink">{text}</p>
          <Button size="touch" variant="tertiary" onClick={() => setReveal(null)}>
            Dismiss
          </Button>
        </div>
      ) : null}
    </div>
  );
}
