import type { AuctionLiveSnapshot } from '@stumps/contracts';
import { Surface, cx } from '@stumps/ui';
import { Crest } from '../setup/Crest';
import { formatRupees, fullRupees } from '../setup/money';

/**
 * Every team's public position (S20 rail): purse, squad and overseas counts,
 * right-to-match cards and the most it may commit for its next player. The
 * current leader is marked in text, not only colour.
 */
export function TeamsRail({
  live,
  onSquad,
}: {
  live: AuctionLiveSnapshot;
  onSquad: (teamId: string) => void;
}) {
  const leader = live.lot?.highFranchiseId ?? null;
  return (
    <Surface aria-labelledby="teams-rail-heading" className="min-w-0 p-4">
      <h2 id="teams-rail-heading" className="text-lg font-semibold">
        Teams
      </h2>
      <ul className="mt-3 flex flex-col gap-2">
        {live.teams.map((t) => (
          <li
            key={t.teamId}
            className={cx(
              'rounded-lg border p-3',
              t.teamId === leader ? 'border-auction/70 bg-auction/10' : 'border-line',
            )}
          >
            <div className="flex items-center gap-3">
              <Crest
                shortName={t.shortName}
                primaryHex={t.primaryHex}
                secondaryHex={t.secondaryHex}
                size="sm"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">
                  {t.name}
                  {t.teamId === live.myTeamId ? ' (you)' : ''}
                </p>
                <p className="text-xs text-ink-3">
                  {t.teamId === leader ? 'Highest bid · ' : ''}Captain {t.captainName}
                </p>
              </div>
              <p className="font-semibold tabular-nums" title={fullRupees(t.remainingPurseRupees)}>
                {formatRupees(t.remainingPurseRupees)}
              </p>
            </div>
            <dl className="mt-2 grid grid-cols-4 gap-2 text-xs">
              <div>
                <dt className="text-ink-3">Squad</dt>
                <dd className="font-semibold">
                  {t.rosterCount}/{live.rules.squadMax}
                </dd>
              </div>
              <div>
                <dt className="text-ink-3">Overseas</dt>
                <dd className="font-semibold">
                  {t.overseasCount}/{live.rules.overseasMax}
                </dd>
              </div>
              <div>
                <dt className="text-ink-3">RTM</dt>
                <dd className="font-semibold">{t.rtmCards.total}</dd>
              </div>
              <div>
                <dt className="text-ink-3">Max bid</dt>
                <dd
                  className="font-semibold tabular-nums"
                  title={t.maxBidRupees ? fullRupees(t.maxBidRupees) : undefined}
                >
                  {t.maxBidRupees ? formatRupees(t.maxBidRupees) : 'Full'}
                </dd>
              </div>
            </dl>
            <button
              type="button"
              className="mt-2 min-h-11 text-sm text-auction underline"
              onClick={() => onSquad(t.teamId)}
            >
              View {t.shortName} squad
            </button>
          </li>
        ))}
      </ul>
    </Surface>
  );
}
