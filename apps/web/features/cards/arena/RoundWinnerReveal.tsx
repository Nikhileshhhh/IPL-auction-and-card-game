'use client';

import { useEffect, useRef, useState } from 'react';
import { METRIC_LABELS, type CardMetric, type RoomMemberSummary } from '@stumps/contracts';
import { Button, cx } from '@stumps/ui';
import { PortraitImage } from '@/components/cards/PortraitImage';
import { fallbackText } from '../tie-arena/fallback';
import { seatName, type CardGame } from './model';

interface Reveal {
  comparisonId: string;
  winnerId: string | null;
  metric: CardMetric;
  byTimeout: boolean;
  cards: number;
  values: { memberId: string; value: number }[];
  portrait: { src: string; alt: string } | null;
  /** How a fallback or the tie cap settled the pot, when it did. */
  explain: string | null;
}

const SHOW_MS = 5_000;

/**
 * S12 round result: a non-modal banner keyed by the decided comparison, with
 * the chosen stat and every player's value. The first snapshot after mount
 * (or reconnect) is history and never celebrated; a repeated comparison ID
 * produces no second banner, and the next decision replaces the current one.
 */
export function RoundWinnerReveal({
  game,
  members,
  me,
}: {
  game: CardGame;
  members: readonly RoomMemberSummary[];
  me: string;
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
      values: last.submittedValues,
      portrait: player ? { src: player.portraitUrl, alt: player.portraitAlt } : null,
      explain: fallbackText(last, members),
    });
  }, [game, members]);

  useEffect(() => {
    if (!reveal) return;
    const id = setTimeout(() => setReveal(null), SHOW_MS);
    return () => clearTimeout(id);
  }, [reveal]);

  const won = reveal?.winnerId === me;
  const headline = reveal
    ? reveal.winnerId
      ? `${won ? 'You win' : `${seatName(members, reveal.winnerId)} wins`} ${reveal.cards} cards on ${METRIC_LABELS[reveal.metric]}${reveal.byTimeout ? ' (time ran out)' : ''}.`
      : `Tie on ${METRIC_LABELS[reveal.metric]}. The pot carries over.`
    : '';

  return (
    <div id="round-result" aria-live="polite">
      {reveal ? (
        <div
          key={reveal.comparisonId}
          className={cx(
            'arena-banner-in flex flex-wrap items-center gap-3 rounded-2xl border p-3 backdrop-blur-sm',
            won ? 'border-[#ffd36b]/70 bg-[#ffd36b]/10' : 'border-card/60 bg-card/10',
          )}
        >
          {reveal.portrait ? (
            <div className="relative h-14 w-11 shrink-0 overflow-hidden rounded-lg bg-overlay">
              <PortraitImage src={reveal.portrait.src} alt={reveal.portrait.alt} sizes="44px" />
            </div>
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="font-display text-lg leading-tight font-bold text-ink uppercase">
              {headline}
            </p>
            <ul className="mt-1 flex flex-wrap gap-2 text-sm" aria-label="Values compared">
              {reveal.values.map((v) => (
                <li
                  key={v.memberId}
                  className={cx(
                    'rounded-full border px-2.5 py-0.5',
                    v.memberId === reveal.winnerId
                      ? 'border-card bg-card/20 text-ink'
                      : 'border-white/15 text-ink-2',
                  )}
                >
                  {seatName(members, v.memberId)}{' '}
                  <span className="font-semibold text-ink tabular-nums">{v.value}</span>
                </li>
              ))}
            </ul>
            {reveal.explain ? <p className="mt-1 text-sm text-ink-2">{reveal.explain}</p> : null}
          </div>
          <Button size="touch" variant="tertiary" onClick={() => setReveal(null)}>
            Dismiss
          </Button>
        </div>
      ) : null}
    </div>
  );
}
