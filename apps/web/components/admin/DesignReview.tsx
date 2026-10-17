'use client';

import type { AuctionPlayer, PublicCardDTO, PublicCardPlayer, Rarity } from '@stumps/contracts';
import { Badge, Surface } from '@stumps/ui';
import { PremiumCricketCard, RARITY_NAMES } from '@/components/cards/PremiumCricketCard';
import { SILHOUETTE } from '@/components/cards/PortraitImage';
import { PlayerLine } from '@/features/auction/setup/PlayerLine';
import { formatRupees, fullRupees } from '@/features/auction/setup/money';

/**
 * Admin-only design review gallery (phase 16, docs/design-review.md): the
 * edge cases the UI spec §8 asks reviewers to check, rendered from fixed
 * fixtures with original artwork only. It reads no game data and grants
 * nothing; the visual test suite captures it at every target viewport.
 */

const RARITY_ORDER: readonly Rarity[] = [
  'normal',
  'bronze',
  'silver',
  'gold',
  'platinum',
  'dual_platinum',
];

const BROKEN = '/api/media/00000000-0000-4000-8000-000000000000/640';

function player(
  id: number,
  name: string,
  role: PublicCardPlayer['role'],
  portraitUrl = SILHOUETTE,
): PublicCardPlayer {
  return {
    id: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
    name,
    role,
    team: 'Mumbai Indians',
    country: 'IN',
    battingStyle: 'right_hand',
    bowlingStyle: role === 'batter' ? null : 'Right-arm fast-medium',
    portraitUrl,
    portraitAlt: `Original illustration standing in for ${name}`,
    photoCredit: null,
  };
}

function card(
  rarity: Rarity,
  players: PublicCardPlayer[],
  ratings: PublicCardDTO['ratings'],
  stars = 3,
): PublicCardDTO {
  return {
    definitionId: `00000000-0000-4000-8000-0000000001${String(RARITY_ORDER.indexOf(rarity)).padStart(2, '0')}`,
    rarity,
    stars,
    players,
    ratings,
    dataLabel: 'Design review fixtures',
    dataKind: 'demo',
    modelVersion: 'review',
  };
}

const LONG = 'Mohammad Shahzaib Abdul Rahman Chowdhury-Wickramasinghe';

const CARDS: PublicCardDTO[] = [
  card('normal', [player(1, 'Arjun Mehta', 'batter')], { batting: 62, bowling: 4, runs: 21 }, 1),
  card('bronze', [player(2, LONG, 'all_rounder')], { batting: 89, bowling: 71, runs: 33 }, 2),
  card('silver', [player(3, 'Ravi Kumar', 'bowler')], { batting: 12, bowling: 96, runs: 8 }, 4),
  card(
    'gold',
    [player(4, 'Sam Carter', 'wicketkeeper')],
    { batting: 101, bowling: 20, runs: 42 },
    5,
  ),
  card(
    'platinum',
    [player(5, 'Image Error Example', 'batter', BROKEN)],
    { batting: 100, bowling: 0, runs: 99 },
    5,
  ),
  card(
    'dual_platinum',
    [player(6, LONG, 'batter'), player(7, 'Jonathan Fitzgerald-Montgomery', 'bowler')],
    { batting: 100, bowling: 100, runs: 100 },
    5,
  ),
];

function auctionPlayer(i: number): AuctionPlayer {
  return {
    playerId: `00000000-0000-4000-8000-0000000002${String(i).padStart(2, '0')}`,
    name: i % 5 === 0 ? `${LONG} ${i}` : `Squad Player ${i}`,
    role: (['batter', 'bowler', 'all_rounder', 'wicketkeeper'] as const)[i % 4] ?? 'batter',
    country: i % 3 === 0 ? 'AU' : 'IN',
    overseas: i % 3 === 0,
    cappedStatus: i % 2 === 0 ? 'capped' : 'uncapped',
    basePriceRupees: String(2_000_000 + i * 2_500_000),
    priceSource: i === 7 ? 'not_registered' : 'demo',
    currentSalaryRupees: i % 4 === 0 ? '180000000' : null,
    previousFranchiseId: null,
    setLabel: 'Review set',
    portraitUrl: i === 3 ? BROKEN : SILHOUETTE,
    portraitAlt: `Original illustration for squad player ${i}`,
  };
}

const AMOUNTS = ['0', '500000', '7500000', '425000000', '1200000000', '99999999999'];

export function DesignReview() {
  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="dr-cards">
        <h2 id="dr-cards" className="text-xl font-semibold">
          Six rarities, dual frame, long names, 101 and 0 ratings, image error
        </h2>
        <ul className="mt-4 flex flex-wrap gap-4">
          {CARDS.map((c) => (
            <li key={c.rarity} className="flex flex-col items-center gap-2">
              {/* Compact (240 px) fits a 320 px reflow; standard is shown from 640 px. */}
              <div className="sm:hidden">
                <PremiumCricketCard card={c} size="compact" />
              </div>
              <div className="hidden sm:block">
                <PremiumCricketCard card={c} size="standard" />
              </div>
              <Badge>{RARITY_NAMES[c.rarity]}</Badge>
            </li>
          ))}
        </ul>
        <ul className="mt-4 flex flex-wrap gap-3" aria-label="Compact and mini sizes">
          {CARDS.map((c) => (
            <li key={c.rarity}>
              <PremiumCricketCard card={c} size="mini" />
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="dr-money">
        <h2 id="dr-money" className="text-xl font-semibold">
          Large rupee amounts
        </h2>
        <table className="mt-3 w-full max-w-xl text-sm">
          <caption className="sr-only">Short and exact forms of rupee amounts</caption>
          <thead>
            <tr className="text-left text-ink-3">
              <th scope="col" className="py-1 font-normal">
                Shown
              </th>
              <th scope="col" className="font-normal">
                Exact
              </th>
            </tr>
          </thead>
          <tbody>
            {AMOUNTS.map((a) => (
              <tr key={a} className="border-t border-line">
                <td className="py-1.5 font-semibold tabular-nums">{formatRupees(a)}</td>
                <td className="tabular-nums break-all">{fullRupees(a)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="dr-counts">
        <h2 id="dr-counts" className="text-xl font-semibold">
          Zero cards and a full pot
        </h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge>Deck 0 cards — eliminated</Badge>
          <Badge tone="card">Pot 64 cards (tie 12 of 12)</Badge>
          <Badge tone="warning">Waiting: 3 players without cards</Badge>
        </div>
      </section>

      <section aria-labelledby="dr-squad">
        <h2 id="dr-squad" className="text-xl font-semibold">
          A full 25-player squad
        </h2>
        <Surface as="div" className="mt-3 p-3">
          <ol className="flex flex-col divide-y divide-line">
            {Array.from({ length: 25 }, (_, i) => auctionPlayer(i + 1)).map((p) => (
              <li key={p.playerId} className="flex items-center gap-3 py-2">
                <PlayerLine player={p} />
              </li>
            ))}
          </ol>
        </Surface>
      </section>
    </div>
  );
}
