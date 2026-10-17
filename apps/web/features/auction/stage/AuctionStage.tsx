'use client';

import { SoundToggle } from '@/features/preferences/SoundToggle';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button, Skeleton, StatusMessage, Surface } from '@stumps/ui';
import { useRoom } from '@/features/room/useRoom';
import { ChatDrawer } from '@/features/chat/ChatDrawer';
import { EndGameVote } from '@/features/voting/EndGameVote';
import { SquadView } from '../setup/SquadView';
import { AuctionCues } from './AuctionCues';
import { BidControlPanel } from './BidControlPanel';
import { MissedRecap } from '@/features/reconnect/MissedRecap';
import { RecoveryBanner } from '@/features/reconnect/RecoveryBanner';
import { ControlBanner } from './ControlBanner';
import { HostControls } from './HostControls';
import { LateJoinPanel } from './LateJoinPanel';
import { LotClock } from './LotClock';
import { LotHistory } from './LotHistory';
import { LotSpotlight } from './LotSpotlight';
import { PlayerDetail } from './PlayerDetail';
import { END_REASONS, liveOf } from './model';
import { RtmPanel } from './RtmPanel';
import { TeamsRail } from './TeamsRail';

/**
 * S20 live auction stage. Everything shown is the last confirmed server
 * snapshot; every action is a command and the stage changes only when the
 * server's next snapshot arrives. Countdowns are display only.
 */
export function AuctionStage({ roomId }: { roomId: string }) {
  const router = useRouter();
  const { status, room, connection } = useRoom(roomId);
  const [squadTeam, setSquadTeam] = useState<string | null>(null);
  // S21 lives in the URL (?player=) so it can be linked and survives refresh.
  const pathname = usePathname();
  const search = useSearchParams();
  const inspected = search.get('player');
  const inspect = (playerId: string | null) =>
    router.replace(playerId ? `${pathname}?player=${playerId}` : pathname, { scroll: false });
  const lifecycle = room?.snapshot.room.lifecycle;
  useEffect(() => {
    if (lifecycle === 'LOBBY') router.replace(`/rooms/${roomId}/lobby`);
  }, [lifecycle, roomId, router]);

  if (status === 'unavailable' || status === 'removed' || status === 'closed') {
    return (
      <StatusMessage tone="warning" title="Auction not available">
        This room is closed or you are no longer a member.{' '}
        <Link href="/play/auction" className="underline">
          Back to IPL Auction
        </Link>
      </StatusMessage>
    );
  }
  const live = liveOf(room?.snapshot.game);
  if (!room || !live) {
    return (
      <div aria-busy="true" aria-label="Loading auction" className="flex flex-col gap-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-[360px] w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const snap = room.snapshot;
  const offline = status !== 'live';
  const disabled = offline || !snap.me.isController;
  const settings = snap.room.settings;
  const openingSeconds = Number(settings.openingClockSeconds ?? 20);
  const rtmSeconds = Number(settings.rtmStageSeconds ?? 15);
  const lot = live.lot;
  const progress = live.poolProgress;

  return (
    <div className="flex flex-col gap-5">
      <AuctionCues live={live} />
      {inspected && /^[0-9a-f-]{36}$/.test(inspected) ? (
        <PlayerDetail
          roomId={roomId}
          playerId={inspected}
          live={live}
          onClose={() => inspect(null)}
        />
      ) : null}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold tracking-wide text-ink uppercase sm:text-3xl">
            {snap.room.name}
          </h1>
          <p className="text-sm text-ink-2">
            {live.rules.label} · {live.pass === 2 ? 'Second pass' : 'First pass'} · {progress.sold}{' '}
            sold, {progress.unsold} unsold, {progress.remaining} to come
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          {live.myTeamId ? (
            <nav aria-label="Team pages" className="flex gap-4 text-sm">
              <Link href={`/rooms/${roomId}/team/requests`} className="underline">
                Team
              </Link>
              <Link href={`/rooms/${roomId}/shortlist`} className="underline">
                Shortlist
              </Link>
              <Link href={`/rooms/${roomId}/auto`} className="underline">
                Auto bidding
              </Link>
            </nav>
          ) : null}
          <HostControls live={live} connection={connection} disabled={disabled} />
          <EndGameVote snapshot={snap} connection={connection} status={status} />
          <SoundToggle />
          <ChatDrawer roomId={roomId} connection={connection} status={status} hasTeams />
        </div>
      </header>

      <RecoveryBanner recoveryUntil={snap.recoveryUntil} serverNow={snap.serverNow} />
      <ControlBanner live={live} roomId={roomId} connection={connection} disabled={disabled} />
      <MissedRecap live={live} status={status} />

      {live.myAllowedActions.includes('team.requestJoin') ? (
        <LateJoinPanel connection={connection} disabled={disabled} />
      ) : null}

      {offline ? (
        <StatusMessage tone="warning" title="Reconnecting">
          Bidding is paused for you until the connection is back. The auction keeps its state on the
          server.
        </StatusMessage>
      ) : !snap.me.isController ? (
        <StatusMessage tone="info" title="Watching in this tab">
          Another tab is in control.{' '}
          <button type="button" className="underline" onClick={() => void connection.takeControl()}>
            Take control here
          </button>
        </StatusMessage>
      ) : null}

      {live.status === 'finished' ? (
        <Surface aria-labelledby="finished-heading">
          <h2 id="finished-heading" className="text-xl font-semibold">
            Auction complete
          </h2>
          <p className="mt-1 text-ink-2">
            {live.finishedReason ? END_REASONS[live.finishedReason] : 'The auction has ended.'}{' '}
            {progress.sold} players sold.
          </p>
          {snap.results?.status === 'finalizing' ? (
            <p className="mt-2 text-sm text-ink-2" role="status">
              Evaluating every squad&apos;s best legal XI… {snap.results.progressPercent}%
            </p>
          ) : (
            <Link
              href={`/rooms/${roomId}/results`}
              className="mt-3 inline-flex min-h-11 items-center font-semibold text-auction underline"
            >
              Results, scores and medals
            </Link>
          )}
          {live.auditSeed ? (
            <details className="mt-3 text-sm text-ink-2">
              <summary className="min-h-11 cursor-pointer">Check the lot order</summary>
              <p className="mt-2 break-all">
                Seed {live.auditSeed}
                <br />
                Commitment published at the start {live.seedCommitment}
              </p>
            </details>
          ) : null}
        </Surface>
      ) : null}

      {live.pausedUntil ? (
        <Surface aria-label="Paused" className="border-warn/50">
          <p className="font-semibold">The host paused the auction between players.</p>
          <LotClock
            deadline={live.pausedUntil}
            serverNow={snap.serverNow}
            total={120}
            label="Resumes automatically"
          />
        </Surface>
      ) : !lot && live.nextLotAt ? (
        <Surface aria-label="Next player" className="p-4">
          <LotClock
            deadline={live.nextLotAt}
            serverNow={snap.serverNow}
            total={4}
            label="Next player coming up"
          />
        </Surface>
      ) : null}

      {/* Televised layout (UI spec §4): franchise rail 240 px on the left, the
          stage in the middle and lot activity in a 320 px column from 1280 px;
          at 1024–1279 px activity drops under the stage; phones stack. */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(480px,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-5 lg:col-start-2 lg:row-start-1">
          {lot ? (
            <>
              <LotSpotlight
                live={live}
                lot={lot}
                serverNow={snap.serverNow}
                openingSeconds={openingSeconds}
                rtmSeconds={rtmSeconds}
                onInspect={inspect}
              />
              <RtmPanel live={live} lot={lot} connection={connection} disabled={disabled} />
            </>
          ) : null}
          {squadTeam ? (
            <section aria-label="Squad" className="flex flex-col gap-3">
              <Button
                variant="tertiary"
                size="touch"
                className="self-start"
                onClick={() => setSquadTeam(null)}
              >
                Close squad
              </Button>
              <SquadView
                roomId={roomId}
                stateVersion={snap.room.stateVersion}
                teams={live.teams}
                rules={live.rules}
                teamId={squadTeam}
              />
            </section>
          ) : null}
        </div>
        <aside
          aria-label="Lot activity"
          className="min-w-0 lg:col-start-2 lg:row-start-2 xl:col-start-3 xl:row-start-1"
        >
          <LotHistory live={live} onInspect={inspect} />
        </aside>
        <div className="min-w-0 lg:col-start-1 lg:row-span-2 lg:row-start-1 xl:row-span-1">
          <TeamsRail live={live} onSquad={setSquadTeam} />
        </div>
      </div>

      {lot ? (
        <BidControlPanel live={live} lot={lot} connection={connection} disabled={disabled} />
      ) : null}
    </div>
  );
}
