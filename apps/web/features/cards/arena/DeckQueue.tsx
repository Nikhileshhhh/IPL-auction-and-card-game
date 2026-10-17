'use client';

import { useState } from 'react';
import { Dialog, cx } from '@stumps/ui';
import { PremiumCricketCard } from '@/components/cards/PremiumCricketCard';
import type { CardGame } from './model';

type ArenaCard = CardGame['myDeck'][number];

/**
 * The viewer's own deck as a queue (product owner): the front card is in play
 * and its stat must be chosen; the rest follow in order, and cards won join
 * the back. Cards can be inspected but never picked out of order.
 */
export function DeckQueue({
  inPlay,
  deck,
}: {
  inPlay: ArenaCard | null;
  deck: CardGame['myDeck'];
}) {
  const [open, setOpen] = useState<ArenaCard | null>(null);
  const queue = [
    ...(inPlay ? [{ card: inPlay, inPlay: true }] : []),
    ...deck.map((card) => ({ card, inPlay: false })),
  ];
  if (queue.length === 0) return null;
  return (
    <section aria-labelledby="queue-heading" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2
          id="queue-heading"
          className="font-display text-lg font-bold tracking-wide text-ink uppercase"
        >
          Your deck
        </h2>
        <p className="text-xs text-ink-2">Cards play in this order. Cards you win join the back.</p>
      </div>
      <ol
        aria-label="Your deck in play order"
        className="relative -mx-1 flex snap-x gap-3 overflow-x-auto px-1 pt-2 pb-3"
      >
        {queue.map(({ card, inPlay: live }, i) => (
          <li key={card.instanceId} className="relative snap-start">
            <span
              className={cx(
                'absolute -top-2 left-2 z-10 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase',
                live ? 'bg-card text-midnight' : 'bg-black/70 text-ink',
              )}
            >
              {live ? 'In play' : `Next ${i + (inPlay ? 0 : 1)}`}
            </span>
            <button
              type="button"
              onClick={() => setOpen(card)}
              aria-label={`${live ? 'In play' : `Position ${i + 1}`}: view ${card.players.map((p) => p.name).join(' & ')}`}
              className={cx(
                'block rounded-[20px] transition-transform hover:-translate-y-1 motion-reduce:hover:translate-y-0',
                live && 'ring-2 ring-card ring-offset-2 ring-offset-[#08111f]',
              )}
            >
              <PremiumCricketCard card={card} size="mini" />
            </button>
          </li>
        ))}
      </ol>
      <Dialog
        open={open !== null}
        onOpenChange={(o) => (o ? undefined : setOpen(null))}
        title="Card in your deck"
        description="You can look at your cards, but they always play in deck order."
      >
        {open ? (
          <div className="flex justify-center">
            <PremiumCricketCard card={open} size="standard" />
          </div>
        ) : null}
      </Dialog>
    </section>
  );
}
