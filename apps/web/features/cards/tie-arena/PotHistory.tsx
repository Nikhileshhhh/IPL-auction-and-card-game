'use client';

import { useState } from 'react';
import type { RoomMemberSummary } from '@stumps/contracts';
import { Button, Dialog } from '@stumps/ui';
import { PremiumCricketCard } from '@/components/cards/PremiumCricketCard';
import { seatName, type CardGame } from '../arena/model';

/**
 * Detailed pot history (S11): every card in the pot, grouped by the comparison
 * it was played in, in contribution order (comparison, then seat).
 */
export function PotHistory({
  game,
  members,
}: {
  game: CardGame;
  members: readonly RoomMemberSummary[];
}) {
  const [open, setOpen] = useState(false);
  if (game.contributions.length === 0) return null;
  const rounds = [...new Set(game.contributions.map((c) => c.comparisonIndex))].sort(
    (a, b) => a - b,
  );
  return (
    <>
      <Button size="touch" variant="secondary" onClick={() => setOpen(true)}>
        Pot history ({game.contributions.length})
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Pot history"
        description="Every card in the pot, in the order it was played. The winner of the contest takes all of them."
      >
        <ol className="flex flex-col gap-4">
          {rounds.map((round, i) => (
            <li key={round}>
              <h3 className="mb-2 text-sm font-semibold text-ink">
                {i === 0 ? 'First comparison' : `Tie comparison ${i}`}
              </h3>
              <ul className="flex flex-wrap gap-3">
                {game.contributions
                  .filter((c) => c.comparisonIndex === round)
                  .map((c) => (
                    <li key={c.card.instanceId} className="flex flex-col items-center gap-1">
                      <span className="text-xs text-ink-2">{seatName(members, c.memberId)}</span>
                      <PremiumCricketCard card={c.card} size="mini" />
                    </li>
                  ))}
              </ul>
            </li>
          ))}
        </ol>
      </Dialog>
    </>
  );
}
