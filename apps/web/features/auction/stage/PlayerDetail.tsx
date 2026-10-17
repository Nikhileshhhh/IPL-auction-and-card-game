'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { AuctionLiveSnapshot, AuctionPlayerDetail } from '@stumps/contracts';
import { Badge, Button, Dialog, Skeleton, StatusMessage } from '@stumps/ui';
import { PortraitImage } from '@/components/cards/PortraitImage';
import { api } from '@/lib/api-client';
import { formatRupees, fullRupees } from '../setup/money';
import { PLAYER_ROLE_LABELS } from '../setup/useSetup';
import { teamById } from './model';

const METRICS: [string, string][] = [
  ['batting', 'Batting'],
  ['bowling', 'Bowling'],
  ['fielding', 'Fielding'],
  ['keeping', 'Wicketkeeping'],
  ['powerplay_batting', 'Powerplay batting'],
  ['middle_batting', 'Middle-overs batting'],
  ['death_batting', 'Death-overs batting'],
  ['powerplay_bowling', 'Powerplay bowling'],
  ['middle_bowling', 'Middle-overs bowling'],
  ['death_bowling', 'Death-overs bowling'],
];

const STATUS_TEXT: Record<AuctionPlayerDetail['poolStatus'], string> = {
  available: 'Still to come',
  retained: 'Retained',
  sold: 'Sold',
  unsold: 'Unsold',
  skipped: 'Moved to later',
};

function x100(v: number | null) {
  return v === null ? '—' : (v / 100).toFixed(2);
}

/**
 * S21 auction player detail (`?player=`): identity, ratings, raw totals and
 * where the numbers come from. It is read only: closing it returns to the
 * live bid controls, which always use the current lot and version.
 */
export function PlayerDetail({
  roomId,
  playerId,
  live,
  onClose,
}: {
  roomId: string;
  playerId: string;
  live: AuctionLiveSnapshot;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<AuctionPlayerDetail | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void api<AuctionPlayerDetail>(`/rooms/${roomId}/players/${playerId}`).then((res) => {
      if (!live) return;
      if (res.ok) setDetail(res.data);
      else {
        setDetail(null);
        setError(res.error.message);
      }
    });
    return () => {
      live = false;
    };
  }, [roomId, playerId]);

  const onBlock = live.lot?.player.playerId === playerId;
  const owner = detail ? teamById(live, detail.ownerTeamId) : null;
  const p = detail?.player;

  return (
    <Dialog
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={p?.name ?? 'Player details'}
      description={
        onBlock
          ? 'This player is under the hammer now. Close this to bid.'
          : 'Not the current lot. Bids always go to the player under the hammer.'
      }
      footer={
        <>
          <Link
            href={`/rooms/${roomId}/shortlist`}
            className="inline-flex min-h-11 items-center rounded-lg px-3 underline"
          >
            Team shortlist
          </Link>
          <Button size="touch" variant="secondary" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      <div className="max-h-[60dvh] overflow-y-auto pr-1">
        {detail === undefined ? (
          <div aria-busy="true" aria-label="Loading player" className="flex flex-col gap-3">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : detail === null || !p ? (
          <StatusMessage tone="warning">{error ?? 'This player is not available.'}</StatusMessage>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex gap-4">
              <div className="relative h-32 w-24 shrink-0 overflow-hidden rounded-xl bg-midnight">
                <PortraitImage src={p.portraitUrl} alt={p.portraitAlt} sizes="96px" />
              </div>
              <div className="min-w-0 text-sm">
                <p className="text-ink-2">
                  {PLAYER_ROLE_LABELS[p.role]} · {p.setLabel}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Badge tone={p.cappedStatus === 'capped' ? 'auction' : 'neutral'}>
                    {p.cappedStatus === 'capped'
                      ? 'Capped'
                      : p.cappedStatus === 'uncapped'
                        ? 'Uncapped'
                        : 'Capped status unknown'}
                  </Badge>
                  {p.overseas ? <Badge>Overseas</Badge> : null}
                  <Badge tone={detail.poolStatus === 'available' ? 'card' : 'neutral'}>
                    {STATUS_TEXT[detail.poolStatus]}
                    {owner ? ` · ${owner.name}` : ''}
                  </Badge>
                </div>
                <p className="mt-2">
                  Base price{' '}
                  <span className="font-semibold" title={fullRupees(p.basePriceRupees)}>
                    {formatRupees(p.basePriceRupees)}
                  </span>
                  <span className="sr-only"> ({fullRupees(p.basePriceRupees)})</span>
                  {p.priceSource === 'not_registered' ? (
                    <span className="block text-xs text-ink-3">
                      Not registered since 2024 (owner rule price)
                    </span>
                  ) : null}
                </p>
              </div>
            </div>

            <section aria-labelledby="detail-ratings">
              <h3 id="detail-ratings" className="font-semibold">
                Game ratings <span className="text-sm font-normal text-ink-3">(0–100)</span>
              </h3>
              <table className="mt-2 w-full text-sm">
                <caption className="sr-only">Ratings for {p.name}</caption>
                <tbody>
                  {METRICS.filter(([k]) => detail.ratings[k] !== undefined).map(([k, label]) => (
                    <tr key={k} className="border-t border-line">
                      <th scope="row" className="py-1 text-left font-normal text-ink-2">
                        {label}
                      </th>
                      <td className="text-right font-semibold tabular-nums">{detail.ratings[k]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section aria-labelledby="detail-raw">
              <h3 id="detail-raw" className="font-semibold">
                Career totals
              </h3>
              {detail.raw ? (
                <table className="mt-2 w-full text-sm">
                  <caption className="sr-only">Career totals ({detail.raw.scopeLabel})</caption>
                  <tbody>
                    {(
                      [
                        ['Matches', detail.raw.matches],
                        ['Runs', detail.raw.runs],
                        ['Batting average', x100(detail.raw.battingAverageX100)],
                        ['Strike rate', x100(detail.raw.strikeRateX100)],
                        ['Wickets', detail.raw.wickets],
                        ['Economy', x100(detail.raw.economyX100)],
                        ['Catches', detail.raw.catches],
                        ['Stumpings', detail.raw.stumpings],
                      ] as const
                    ).map(([label, value]) => (
                      <tr key={label} className="border-t border-line">
                        <th scope="row" className="py-1 text-left font-normal text-ink-2">
                          {label}
                        </th>
                        <td className="text-right tabular-nums">{value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="mt-2 text-sm text-ink-2">
                  No career totals in this data version (the player has not played an IPL match).
                </p>
              )}
            </section>

            <p className="text-xs text-ink-3">
              {detail.dataLabel}. Statistics: {detail.source.publisher} ({detail.source.licence}).
            </p>
          </div>
        )}
      </div>
    </Dialog>
  );
}
