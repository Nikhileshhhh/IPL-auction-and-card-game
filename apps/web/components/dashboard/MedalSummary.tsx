import type { MemberSummaryDTO } from '@stumps/contracts';
import { MedalBadge, Surface } from '@stumps/ui';

/** Counts come only from server receipts; zero states invite qualifying play. */
export function MedalSummary({ summary }: { summary: MemberSummaryDTO }) {
  const { medals, recentMedals } = summary;
  const total = medals.gold + medals.silver + medals.bronze;
  return (
    <Surface aria-labelledby="medals-heading">
      <h2 id="medals-heading" className="text-xl font-semibold">
        Your medals
      </h2>
      <ul className="mt-4 flex flex-wrap gap-6">
        <li>
          <MedalBadge medal="gold" count={medals.gold} />
        </li>
        <li>
          <MedalBadge medal="silver" count={medals.silver} />
        </li>
        <li>
          <MedalBadge medal="bronze" count={medals.bronze} />
        </li>
      </ul>
      <p className="mt-4 text-sm text-ink-2">
        {medals.games === 0
          ? 'No completed games yet. Medals are earned in qualifying games against friends.'
          : `${medals.games} qualifying game${medals.games === 1 ? '' : 's'} · ${medals.cardWins} card win${medals.cardWins === 1 ? '' : 's'} · ${medals.auctionWins} auction win${medals.auctionWins === 1 ? '' : 's'}`}
      </p>
      {total > 0 && recentMedals.length > 0 ? (
        <ul className="mt-4 flex flex-col gap-2 text-sm" aria-label="Recently earned">
          {recentMedals.map((m, i) => (
            <li key={`${m.completionDay}-${i}`} className="flex items-center gap-3">
              <MedalBadge medal={m.medal} size="sm" />
              <span className="text-ink-2">
                {m.gameType === 'card'
                  ? 'Card Battle'
                  : m.scope === 'franchise'
                    ? 'Mega Auction · team'
                    : 'Mega Auction'}{' '}
                · {m.completionDay}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </Surface>
  );
}
