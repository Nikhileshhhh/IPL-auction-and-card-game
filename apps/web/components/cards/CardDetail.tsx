'use client';

import { useEffect, useState } from 'react';
import { Dialog, Skeleton, StatusMessage } from '@stumps/ui';
import type { CardDetailDTO, PublicCardDTO, RawStatsDTO } from '@stumps/contracts';
import { api } from '@/lib/api-client';
import { PremiumCricketCard } from './PremiumCricketCard';

const dec = (x100: number | null) => (x100 === null ? 'Not available' : (x100 / 100).toFixed(2));
const overs = (balls: number) => `${Math.floor(balls / 6)}.${balls % 6}`;
const PHASE_LABELS: Record<string, string> = {
  powerplay_batting: 'Powerplay batting',
  middle_batting: 'Middle-overs batting',
  death_batting: 'Death-overs batting',
  powerplay_bowling: 'Powerplay bowling',
  middle_bowling: 'Middle-overs bowling',
  death_bowling: 'Death-overs bowling',
};

function StatTable({ caption, rows }: { caption: string; rows: [string, string | number][] }) {
  return (
    <table className="w-full text-sm">
      <caption className="mb-1 text-left text-xs font-semibold tracking-wide text-ink-3 uppercase">
        {caption}
      </caption>
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k} className="border-b border-line/60">
            <th scope="row" className="py-1 pr-3 text-left font-normal text-ink-2">
              {k}
            </th>
            <td className="py-1 text-right tabular-nums">{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RawStats({ raw }: { raw: RawStatsDTO }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <StatTable
        caption="Batting"
        rows={[
          ['Matches', raw.matches],
          ['Innings', raw.innings],
          ['Runs', raw.runs],
          ['Highest score', raw.highScore ?? 'Not available'],
          ['Average', dec(raw.battingAverageX100)],
          ['Strike rate', dec(raw.strikeRateX100)],
          ['Fours / sixes', `${raw.fours} / ${raw.sixes}`],
        ]}
      />
      <StatTable
        caption="Bowling and fielding"
        rows={[
          ['Overs', raw.ballsBowled ? overs(raw.ballsBowled) : 'Did not bowl'],
          ['Wickets', raw.wickets],
          ['Economy', raw.ballsBowled ? dec(raw.economyX100) : 'Not applicable'],
          ['Average', raw.wickets ? dec(raw.bowlingAverageX100) : 'Not applicable'],
          [
            'Best',
            raw.bestBowling
              ? `${raw.bestBowling.wickets}/${raw.bestBowling.runs}`
              : 'Not applicable',
          ],
          ['Catches', raw.catches],
          ['Run-outs / stumpings', `${raw.runOuts} / ${raw.stumpings}`],
        ]}
      />
    </div>
  );
}

const memberDetailPath = (id: string) => `/catalog/cards/${id}`;

/** S10 card detail: the card, sourced raw statistics, phase ratings, provenance and photo credits. */
export function CardDetailDialog({
  card,
  onClose,
  detailPath = memberDetailPath,
}: {
  card: PublicCardDTO | null;
  onClose: () => void;
  detailPath?: (id: string) => string;
}) {
  const [detail, setDetail] = useState<{
    id: string;
    data: CardDetailDTO | null;
    error: string | null;
  } | null>(null);
  useEffect(() => {
    if (!card) return;
    let live = true;
    void api<CardDetailDTO>(detailPath(card.definitionId)).then((res) => {
      if (!live) return;
      setDetail({
        id: card.definitionId,
        data: res.ok ? res.data : null,
        error: res.ok ? null : res.error.message,
      });
    });
    return () => {
      live = false;
    };
  }, [card, detailPath]);
  const current = card && detail?.id === card.definitionId ? detail : null;

  return (
    <Dialog
      open={card !== null}
      onOpenChange={(open) => (!open ? onClose() : undefined)}
      title={card ? card.players.map((p) => p.name).join(' & ') : 'Card'}
      description={
        card ? `${card.dataLabel}. Game ratings are 0–100 within this player pool.` : undefined
      }
    >
      {card ? (
        <div
          tabIndex={0}
          role="region"
          aria-label="Card details"
          className="flex max-h-[65vh] flex-col gap-5 overflow-y-auto pr-1"
        >
          <div className="flex justify-center">
            <PremiumCricketCard card={card} size="compact" />
          </div>
          {!current ? (
            <div aria-busy="true" aria-label="Loading statistics" className="flex flex-col gap-2">
              <Skeleton className="h-6 w-1/2" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : current.error || !current.data ? (
            <StatusMessage tone="warning">
              {current.error ?? 'Statistics unavailable.'}
            </StatusMessage>
          ) : (
            current.data.players.map((p, i) => {
              const player = card.players[i];
              return (
                <section
                  key={p.playerId}
                  aria-label={`${player?.name ?? 'Player'} statistics`}
                  className="flex flex-col gap-3"
                >
                  {card.players.length > 1 ? (
                    <h3 className="font-semibold">{player?.name}</h3>
                  ) : null}
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                    <dt className="text-ink-3">Batting style</dt>
                    <dd>
                      {player?.battingStyle
                        ? player.battingStyle === 'left_hand'
                          ? 'Left-hand'
                          : 'Right-hand'
                        : 'Not available'}
                    </dd>
                    <dt className="text-ink-3">Bowling style</dt>
                    <dd>{player?.bowlingStyle ?? 'Not available'}</dd>
                    <dt className="text-ink-3">Country</dt>
                    <dd>{player?.country ?? 'Not available'}</dd>
                    <dt className="text-ink-3">Data completeness</dt>
                    <dd>{p.completenessPercent}%</dd>
                  </dl>
                  {p.raw ? (
                    <>
                      <p className="text-xs text-ink-3">Raw statistics: {p.raw.scopeLabel}</p>
                      <RawStats raw={p.raw} />
                    </>
                  ) : (
                    <p className="text-sm text-ink-2">Raw statistics not available.</p>
                  )}
                  {Object.keys(p.phases).length ? (
                    <StatTable
                      caption="Phase game ratings (0–100)"
                      rows={Object.entries(p.phases).map(([k, v]) => [PHASE_LABELS[k] ?? k, v])}
                    />
                  ) : null}
                  {player?.photoCredit ? (
                    <p className="text-xs text-ink-3">
                      {player.photoCredit.attribution}.{' '}
                      {player.photoCredit.sourceUrl ? (
                        <a
                          className="underline"
                          href={player.photoCredit.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Photo source
                        </a>
                      ) : null}
                      {player.photoCredit.licenceUrl ? (
                        <>
                          {' · '}
                          <a
                            className="underline"
                            href={player.photoCredit.licenceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Licence
                          </a>
                        </>
                      ) : null}
                    </p>
                  ) : null}
                </section>
              );
            })
          )}
          {current?.data ? (
            <p className="text-xs text-ink-3">
              Statistics: {current.data.source.publisher} ({current.data.source.licence}). Game
              ratings are calculated by STUMPS from these statistics ({card.modelVersion}); they are
              not official ratings.
              {card.estimated.length ? ' * marks an estimated rating (limited recent data).' : ''}
            </p>
          ) : null}
        </div>
      ) : null}
    </Dialog>
  );
}
