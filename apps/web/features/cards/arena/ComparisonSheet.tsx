'use client';

import { METRIC_LABELS, type RoomMemberSummary } from '@stumps/contracts';
import { Dialog } from '@stumps/ui';
import { FallbackExplanation } from '../tie-arena/FallbackExplanation';
import { metricRows, REASON_LABELS, seatName, type CardGame } from './model';

/**
 * S10 comparison sheet: every revealed card's values per category in seat
 * order (higher wins), plus the last decided comparison. Closing it never
 * submits anything; the arena behind it keeps its state.
 */
export function ComparisonSheet({
  open,
  onOpenChange,
  game,
  members,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  game: CardGame;
  members: readonly RoomMemberSummary[];
}) {
  const last = game.lastComparison;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Comparison"
      description="Game ratings are whole numbers from 0 to 100. The higher value wins the pot."
    >
      <div className="flex flex-col gap-5 text-sm">
        {game.visibleCards.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <caption className="pb-2 text-left font-semibold text-ink">
                Revealed now (comparison {game.comparisonIndex + 1})
              </caption>
              <thead>
                <tr className="text-xs text-ink-2">
                  <th scope="col" className="py-1 pr-3 font-medium">
                    Category
                  </th>
                  {game.visibleCards.map((v) => (
                    <th key={v.memberId} scope="col" className="py-1 pr-3 font-medium">
                      {seatName(members, v.memberId)}
                      <span className="block font-normal">
                        {v.card.players.map((p) => p.name).join(' & ')}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {metricRows(null).map(({ metric }) => (
                  <tr key={metric} className="border-t border-line">
                    <th scope="row" className="py-1.5 pr-3 font-medium text-ink">
                      {METRIC_LABELS[metric]}
                    </th>
                    {game.visibleCards.map((v) => (
                      <td key={v.memberId} className="py-1.5 pr-3 tabular-nums text-ink">
                        {v.card.ratings[metric]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {last ? (
          <div className="flex flex-col gap-2">
            <h3 className="font-semibold text-ink">
              Last decided: {METRIC_LABELS[last.metric]}
              {last.byTimeout ? ' (chosen automatically when time ran out)' : ''}
            </h3>
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="text-xs text-ink-2">
                  <th scope="col" className="py-1 pr-3 font-medium">
                    Player
                  </th>
                  <th scope="col" className="py-1 pr-3 font-medium">
                    Value
                  </th>
                  <th scope="col" className="py-1 font-medium">
                    Outcome
                  </th>
                </tr>
              </thead>
              <tbody>
                {last.submittedValues.map((v) => (
                  <tr key={v.memberId} className="border-t border-line">
                    <th scope="row" className="py-1.5 pr-3 font-medium text-ink">
                      {seatName(members, v.memberId)}
                    </th>
                    <td className="py-1.5 pr-3 tabular-nums text-ink">{v.value}</td>
                    <td className="py-1.5 text-ink-2">
                      {last.winnerId === v.memberId
                        ? 'Won the pot'
                        : last.tiedSeats.includes(v.memberId)
                          ? 'Tied'
                          : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-ink-2">{REASON_LABELS[last.reason] ?? last.reason}</p>
            <FallbackExplanation last={last} members={members} />
          </div>
        ) : (
          <p className="text-ink-2">No comparison has been decided yet.</p>
        )}
        <p className="text-xs text-ink-3">
          Ratings come from the published card data (
          {game.visibleCards[0]?.card.dataLabel ?? 'this match’s data version'}).
        </p>
      </div>
    </Dialog>
  );
}
