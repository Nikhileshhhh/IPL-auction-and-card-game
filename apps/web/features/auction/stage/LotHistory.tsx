import type { AuctionLiveSnapshot } from '@stumps/contracts';
import { Surface } from '@stumps/ui';
import { formatRupees, fullRupees } from '../setup/money';
import { OUTCOME_LABELS, teamById } from './model';

/** Bids on the current lot and the latest results (newest first). */
export function LotHistory({ live }: { live: AuctionLiveSnapshot }) {
  return (
    <Surface aria-labelledby="history-heading" className="p-4">
      {live.lotBids.length > 0 ? (
        <>
          <h2 className="text-lg font-semibold">Bids on this player</h2>
          <ol className="mt-2 flex flex-col gap-1 text-sm" aria-label="Bids on this player">
            {live.lotBids.map((b) => (
              <li key={b.bidVersion} className="flex justify-between gap-3">
                <span>
                  {teamById(live, b.teamId)?.shortName ?? 'Team'}
                  {b.kind === 'rtm_raise'
                    ? ' · final offer'
                    : b.kind === 'rtm_match'
                      ? ' · matched'
                      : ''}
                </span>
                <span className="tabular-nums" title={fullRupees(b.amountRupees)}>
                  {formatRupees(b.amountRupees)}
                </span>
              </li>
            ))}
          </ol>
        </>
      ) : null}
      <h2 id="history-heading" className="mt-1 text-lg font-semibold">
        Results
      </h2>
      {live.history.length === 0 ? (
        <p className="mt-2 text-sm text-ink-2">No player has been settled yet.</p>
      ) : (
        <ol className="mt-2 flex flex-col gap-2 text-sm">
          {live.history.map((h) => {
            const team = teamById(live, h.teamId);
            return (
              <li key={h.nominationId} className="flex flex-wrap justify-between gap-x-3">
                <span className="min-w-0">
                  <span className="text-ink-3">#{h.lotNumber}</span> {h.name}
                </span>
                <span className="text-ink-2">
                  {OUTCOME_LABELS[h.outcome]}
                  {team ? ` · ${team.shortName}` : ''}
                  {h.priceRupees ? (
                    <span className="tabular-nums" title={fullRupees(h.priceRupees)}>
                      {' '}
                      · {formatRupees(h.priceRupees)}
                    </span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </Surface>
  );
}
