'use client';

import type { AuctionLiveSnapshot, Nomination } from '@stumps/contracts';
import { Badge, Surface } from '@stumps/ui';
import { PortraitImage } from '@/components/cards/PortraitImage';
import { Crest } from '../setup/Crest';
import { formatRupees, fullRupees } from '../setup/money';
import { PLAYER_ROLE_LABELS } from '../setup/useSetup';
import { LotClock } from './LotClock';
import { STAGE_LABELS, teamById } from './model';

/**
 * The player under the hammer (S20 spotlight): portrait (ADR-017), role,
 * status tags, set, base price, the current bid and its holder, and the
 * server-clock countdown.
 */
export function LotSpotlight({
  live,
  lot,
  serverNow,
  openingSeconds,
  rtmSeconds,
}: {
  live: AuctionLiveSnapshot;
  lot: Nomination;
  serverNow: string;
  openingSeconds: number;
  rtmSeconds: number;
}) {
  const p = lot.player;
  const leader = teamById(live, lot.highFranchiseId);
  const previous = live.teams.find((t) => t.franchiseDefinitionId === p.previousFranchiseId);
  const standing = lot.rtmFinalBidRupees ?? lot.highBidRupees;
  return (
    <Surface aria-labelledby="lot-heading" className="overflow-hidden p-0">
      <div className="grid gap-0 sm:grid-cols-[minmax(0,220px)_1fr]">
        <div className="relative aspect-[3/4] max-h-[320px] w-full bg-overlay sm:max-h-none">
          <PortraitImage
            src={p.portraitUrl}
            alt={p.portraitAlt}
            sizes="(max-width: 640px) 100vw, 220px"
            priority
          />
          <span className="absolute top-3 left-3 rounded-full bg-black/70 px-3 py-1 text-xs font-semibold text-ink">
            Lot {lot.lotNumber}
            {lot.pass === 2 ? ' · second pass' : ''}
          </span>
        </div>
        <div className="flex min-w-0 flex-col gap-4 p-5">
          <div>
            <p className="text-xs tracking-wide text-auction uppercase">{p.setLabel}</p>
            <h2 id="lot-heading" className="font-display text-3xl font-bold text-ink uppercase">
              {p.name}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-sm text-ink-2">
              <span>{PLAYER_ROLE_LABELS[p.role]}</span>
              <Badge tone={p.cappedStatus === 'capped' ? 'auction' : 'neutral'}>
                {p.cappedStatus === 'capped'
                  ? 'Capped'
                  : p.cappedStatus === 'uncapped'
                    ? 'Uncapped'
                    : 'Status unknown'}
              </Badge>
              {p.overseas ? <Badge tone="warning">Overseas</Badge> : null}
              {previous ? <span>· 2026: {previous.shortName}</span> : null}
            </div>
          </div>
          {lot.myTarget ? (
            <p className="rounded-lg border border-auction/50 bg-auction/10 px-3 py-2 text-sm">
              <span className="font-semibold">On your shortlist</span> · priority{' '}
              {lot.myTarget.priority}
              {lot.myTarget.maxPriceRupees
                ? ` · ceiling ${formatRupees(lot.myTarget.maxPriceRupees)}`
                : ''}
              {lot.myTarget.tally.up || lot.myTarget.tally.down
                ? ` · ${lot.myTarget.tally.up} for, ${lot.myTarget.tally.down} against`
                : ''}
              {lot.myTarget.note ? (
                <span className="mt-1 block text-ink-2">“{lot.myTarget.note}”</span>
              ) : null}
            </p>
          ) : null}
          <dl className="grid grid-cols-2 gap-3">
            <div>
              <dt className="text-xs text-ink-3">Base price</dt>
              <dd className="font-semibold tabular-nums" title={fullRupees(lot.basePriceRupees)}>
                {formatRupees(lot.basePriceRupees)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-3">
                {lot.rtmFinalBidRupees ? 'Final offer' : 'Current bid'}
              </dt>
              <dd
                className="font-display text-3xl leading-none font-bold text-auction tabular-nums"
                title={standing ? fullRupees(standing) : undefined}
                aria-live="polite"
              >
                {standing ? formatRupees(standing) : 'No bid yet'}
              </dd>
            </div>
          </dl>
          <div className="flex min-h-12 items-center gap-3">
            {leader ? (
              <>
                <Crest
                  shortName={leader.shortName}
                  primaryHex={leader.primaryHex}
                  secondaryHex={leader.secondaryHex}
                  size="sm"
                />
                <p className="text-sm text-ink">
                  <span className="font-semibold">{leader.name}</span>{' '}
                  {live.myTeamId === leader.teamId ? '(your team) ' : ''}holds the bid
                </p>
              </>
            ) : (
              <p className="text-sm text-ink-2">Opening at the base price.</p>
            )}
          </div>
          <LotClock
            deadline={lot.deadline}
            serverNow={serverNow}
            total={lot.stage === 'bidding' ? openingSeconds : rtmSeconds}
            label={STAGE_LABELS[lot.stage]}
          />
        </div>
      </div>
    </Surface>
  );
}
