'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import type { AuctionSetupPhase } from '@stumps/contracts';
import { Skeleton, cx } from '@stumps/ui';
import type { LobbyContext } from '@/features/room/components/MultiplayerLobby';
import { AuctionLobbyPanel } from './AuctionLobbyPanel';
import { FranchiseSelection } from './FranchiseSelection';
import { RetentionManager } from './RetentionManager';
import { SquadView } from './SquadView';
import { setupOf } from './useSetup';

const PAGES: Record<AuctionSetupPhase, string> = {
  FRANCHISE_SELECTION: 'franchises',
  RETENTION: 'retentions',
  AUCTION_LOBBY: 'auction-lobby',
};

/**
 * The auction setup flow inside the room lobby: S16 franchises → S18
 * retentions (retention format) → S19 auction lobby, plus S22 squads. The
 * server's phase decides which screen applies; a stale URL follows it.
 */
export function AuctionSetupView({
  ctx,
  screen,
  teamId = null,
}: {
  ctx: LobbyContext;
  screen: 'franchises' | 'retentions' | 'auction-lobby' | 'squad';
  teamId?: string | null;
}) {
  const router = useRouter();
  const setup = setupOf(ctx);
  const roomId = ctx.room.snapshot.room.roomId;
  const target = setup ? PAGES[setup.phase] : null;
  useEffect(() => {
    if (target && screen !== 'squad' && target !== screen)
      router.replace(`/rooms/${roomId}/${target}`);
  }, [target, screen, roomId, router]);
  if (!setup) return <Skeleton className="h-48 w-full" />;

  const steps: { phase: AuctionSetupPhase; label: string }[] = [
    { phase: 'FRANCHISE_SELECTION', label: 'Franchises' },
    ...(setup.format === 'retention' ? [{ phase: 'RETENTION' as const, label: 'Retentions' }] : []),
    { phase: 'AUCTION_LOBBY', label: 'Auction lobby' },
  ];
  const current = steps.findIndex((s) => s.phase === setup.phase);
  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Auction setup steps" className="flex flex-wrap items-center gap-2 text-sm">
        {steps.map((s, i) => (
          <span
            key={s.phase}
            aria-current={i === current ? 'step' : undefined}
            className={cx(
              'rounded-full border px-3 py-1',
              i === current
                ? 'border-auction bg-auction/15 font-semibold text-ink'
                : 'border-line text-ink-2',
            )}
          >
            {i < current ? '✓ ' : `${i + 1}. `}
            {s.label}
          </span>
        ))}
        <Link href={`/rooms/${roomId}/squad`} className="ml-auto underline">
          Squads
        </Link>
      </nav>
      <p className="text-sm text-ink-2">
        {setup.rules.label}
        {setup.dataKind === 'demo' ? ' · demo players' : ''}
        {setup.format === 'fresh' ? ' · Fresh reset (simulator option)' : ''}
      </p>
      {screen === 'squad' ? (
        <SquadView ctx={ctx} setup={setup} teamId={teamId} />
      ) : setup.phase === 'FRANCHISE_SELECTION' ? (
        <FranchiseSelection ctx={ctx} setup={setup} />
      ) : setup.phase === 'RETENTION' ? (
        <RetentionManager ctx={ctx} setup={setup} />
      ) : (
        <AuctionLobbyPanel ctx={ctx} setup={setup} />
      )}
    </div>
  );
}
