'use client';

import Link from 'next/link';
import type { AuctionSetupSnapshot } from '@stumps/contracts';
import { Badge, StatusMessage, Surface } from '@stumps/ui';
import type { LobbyContext } from '@/features/room/components/MultiplayerLobby';
import { Crest } from './Crest';
import { formatRupees, fullRupees } from './money';
import { TeamPanel } from './TeamPanel';
import { useSetupActions } from './useSetup';

/**
 * S19 auction waiting lobby: every team with its locked squad and public
 * purse, and the start checklist. Each person marks themself ready; another
 * team can never make you ready. When the host starts, everyone moves to the
 * live auction stage (S20).
 */
export function AuctionLobbyPanel({
  ctx,
  setup,
}: {
  ctx: LobbyContext;
  setup: AuctionSetupSnapshot;
}) {
  const actions = useSetupActions(ctx);
  const teams = setup.teams.filter((t) => t.teamId);
  const members = ctx.room.snapshot.room.members.filter((m) => m.role === 'player');
  const ready = members.filter((m) => m.ready).length;
  const roomId = ctx.room.snapshot.room.roomId;
  return (
    <div className="flex flex-col gap-6">
      <Surface aria-labelledby="teams-heading">
        <h2 id="teams-heading" className="text-xl font-semibold">
          Teams and purses
        </h2>
        <ul className="mt-4 flex flex-col gap-3">
          {teams.map((t) => (
            <li
              key={t.teamId}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-line p-3"
            >
              <Crest
                shortName={t.shortName}
                primaryHex={t.primaryHex}
                secondaryHex={t.secondaryHex}
              />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{t.name}</p>
                <p className="text-sm text-ink-2">
                  Captain {t.captain?.displayName} · {t.memberCount}{' '}
                  {t.memberCount === 1 ? 'person' : 'people'} ·{' '}
                  {setup.format === 'retention'
                    ? `${t.retainedCount} retained for ${formatRupees(t.retentionChargeRupees)}`
                    : 'fresh squad'}
                </p>
              </div>
              <div className="text-right">
                <p
                  className="font-semibold tabular-nums"
                  title={fullRupees(t.remainingPurseRupees)}
                >
                  {formatRupees(t.remainingPurseRupees)}
                </p>
                <p className="text-xs text-ink-3">purse left</p>
              </div>
              <Badge tone={t.ready ? 'auction' : 'neutral'}>
                {t.ready ? 'Ready' : 'Not ready'}
              </Badge>
              <Link className="text-sm underline" href={`/rooms/${roomId}/squad?team=${t.teamId}`}>
                Squad
              </Link>
            </li>
          ))}
        </ul>
      </Surface>

      <Surface aria-labelledby="checklist-heading">
        <h2 id="checklist-heading" className="text-lg font-semibold">
          Start checklist
        </h2>
        <ul className="mt-3 flex flex-col gap-2 text-sm">
          <li>✓ {teams.length} teams with locked squads</li>
          <li>
            {ready === members.length ? '✓' : '○'} {ready} of {members.length} people ready
          </li>
          <li>
            ✓ {setup.pool.available} players in the auction pool, base prices from{' '}
            {formatRupees(setup.pool.lowestBasePriceRupees)}
          </li>
        </ul>
        <StatusMessage tone="info" className="mt-4" title="What happens at the start">
          Players come up one at a time in the real auction sets. Each bid is the next step on the
          auctioneer’s ladder; a late bid gives everyone 8 more seconds. Previous franchises may use
          their right-to-match cards after the highest bidder’s one final raise.
        </StatusMessage>
      </Surface>

      <TeamPanel ctx={ctx} setup={setup} actions={actions} />
    </div>
  );
}
