'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Badge, Button, Dialog, Skeleton, StatusMessage, Surface } from '@stumps/ui';
import type { ApiError, RoomLobbyDTO, RoomMemberSummary } from '@stumps/contracts';
import { useRoom } from '../useRoom';
import type { RoomConnection } from '../connection';
import type { RoomState } from '../events';
import { SettingsDialog } from './SettingsDialog';

type Lobby = RoomLobbyDTO;

function hubFor(gameType: Lobby['gameType']) {
  return gameType === 'card' ? '/play/cards' : '/play/auction';
}

function StartFailure({
  error,
  onApplyTotal,
}: {
  error: ApiError;
  onApplyTotal: (total: number) => void;
}) {
  const details = (error.details ?? {}) as { reason?: string; suggestedTotals?: number[] };
  if (details.reason === 'ENGINE_UNAVAILABLE') {
    return (
      <StatusMessage tone="info" title="Match engine not available yet">
        Everyone is ready, but this game&apos;s match engine ships in a later build. The lobby stays
        open and nothing was started.
      </StatusMessage>
    );
  }
  if (details.reason === 'UNEVEN_DEAL') {
    return (
      <StatusMessage tone="warning" title="Cards cannot be dealt evenly">
        <p>{error.message} Choose a total that deals evenly:</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {(details.suggestedTotals ?? []).map((t) => (
            <Button key={t} size="touch" variant="secondary" onClick={() => onApplyTotal(t)}>
              Use {t} cards
            </Button>
          ))}
        </div>
      </StatusMessage>
    );
  }
  return <StatusMessage tone="warning">{error.message}</StatusMessage>;
}

function MemberRow({
  member,
  me,
  canManage,
  onRemove,
  onMakeHost,
}: {
  member: RoomMemberSummary;
  me: boolean;
  canManage: boolean;
  onRemove: () => void;
  onMakeHost: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-4 rounded-[var(--radius-panel-sm)] border border-line bg-midnight p-4">
      <div
        aria-hidden="true"
        className="grid size-12 shrink-0 place-items-center rounded-full bg-overlay text-lg font-bold text-card"
      >
        {member.displayName.slice(0, 1).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 font-semibold">
          <span className="truncate">{member.displayName}</span>
          {me ? <span className="text-sm font-normal text-ink-3">(you)</span> : null}
          {member.isHost ? <Badge tone="card">Host</Badge> : null}
        </p>
        <p className="text-sm text-ink-2">
          @{member.username}
          {member.seat !== null ? ` · Seat ${member.seat + 1}` : ''}
        </p>
      </div>
      <div className="flex flex-col items-end gap-1 text-sm">
        <span className={member.ready ? 'text-ok' : 'text-ink-2'}>
          <span aria-hidden="true">{member.ready ? '✓ ' : '○ '}</span>
          {member.ready ? 'Ready' : 'Not ready'}
        </span>
        <span className={member.connectionStatus === 'online' ? 'text-ink-2' : 'text-warn'}>
          <span aria-hidden="true">{member.connectionStatus === 'online' ? '● ' : '◌ '}</span>
          {member.connectionStatus === 'online' ? 'Connected' : 'Disconnected — seat reserved'}
        </span>
      </div>
      {canManage && !me ? (
        <div className="flex w-full flex-wrap justify-end gap-2 sm:w-auto">
          <Button
            size="touch"
            variant="tertiary"
            onClick={onMakeHost}
            aria-label={`Make ${member.displayName} host`}
          >
            Make host
          </Button>
          <Button
            size="touch"
            variant="danger"
            onClick={onRemove}
            aria-label={`Remove ${member.displayName}`}
          >
            Remove
          </Button>
        </div>
      ) : null}
    </li>
  );
}

function useAction() {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<{ action: string; error: ApiError } | null>(null);
  async function run<T>(
    action: string,
    work: () => Promise<{ ok: true; data: T } | { ok: false; error: ApiError }>,
  ) {
    setPending(action);
    setError(null);
    const res = await work();
    setPending(null);
    if (!res.ok) setError({ action, error: res.error });
    return res;
  }
  return { pending, error, run, clear: () => setError(null) };
}

/** What a screen inside the lobby needs: the confirmed room state and the live link. */
export interface LobbyContext {
  room: RoomState;
  connection: RoomConnection;
  /** This tab controls the seat and the link is live. */
  canAct: boolean;
}

/** S07 (card) and the auction setup screens: roster, readiness, rules and host controls. */
export function MultiplayerLobby({
  roomId,
  children,
}: {
  roomId: string;
  children?: ReactNode | ((ctx: LobbyContext) => ReactNode);
}) {
  const router = useRouter();
  const { status, room, loadError, connection } = useRoom(roomId);
  const actions = useAction();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirm, setConfirm] = useState<
    { kind: 'leave' } | { kind: 'remove' | 'host'; member: RoomMemberSummary } | null
  >(null);
  const [copied, setCopied] = useState(false);
  const started = room?.snapshot.room.lifecycle;
  const gameType = room?.snapshot.room.gameType;
  // A started game lives on its own pages (cards: S08 → S09; auction: S20).
  useEffect(() => {
    if (!started || started === 'LOBBY') return;
    router.replace(
      gameType === 'auction' ? `/rooms/${roomId}/auction` : `/rooms/${roomId}/preparing`,
    );
  }, [gameType, started, roomId, router]);

  if (status === 'unavailable') {
    return (
      <StatusMessage tone="warning" title="Room not available">
        {loadError?.code === 'ROOM_GONE'
          ? 'This room has closed.'
          : 'This room does not exist or you are not a member.'}{' '}
        <Link href="/play" className="underline">
          Back to games
        </Link>
      </StatusMessage>
    );
  }
  if (status === 'removed' || status === 'closed') {
    return (
      <StatusMessage
        tone="warning"
        title={status === 'removed' ? 'You left this room' : 'Room closed'}
      >
        {status === 'removed'
          ? 'You are no longer a member of this room.'
          : 'This lobby closed after everyone left or it was inactive.'}{' '}
        <Link href="/play" className="underline">
          Back to games
        </Link>
      </StatusMessage>
    );
  }
  if (!room) {
    return (
      <div aria-busy="true" aria-label="Loading lobby" className="flex flex-col gap-4">
        <Skeleton className="h-12 w-2/3" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  const lobby = room.snapshot.room;
  const me = room.snapshot.me;
  const mine = lobby.members.find((m) => m.id === me.memberId);
  const isHost = lobby.hostMemberId === me.memberId;
  const canAct = me.isController && status === 'live';
  const lobbyOpen = lobby.lifecycle === 'LOBBY';
  const players = lobby.members.filter((m) => m.role === 'player');
  const notReady = players.filter((m) => !m.ready);
  const handover = room.snapshot.pendingHostHandover;
  // Judged against the server clock at snapshot time; a late accept is refused by the server.
  const handoverLive =
    handover &&
    new Date(handover.expiresAt).getTime() > new Date(room.snapshot.serverNow).getTime();
  const capacity = Number(lobby.settings.maxPlayers ?? 0);
  // An auction gets ready and starts only from its lobby, after franchises and retentions.
  const auctionPhase = (room.snapshot.game as { phase?: string } | null)?.phase;
  const readyPhase = lobby.gameType === 'card' || auctionPhase === 'AUCTION_LOBBY';

  const copyCode = async () => {
    if (!lobby.roomCode) return;
    await navigator.clipboard.writeText(lobby.roomCode).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  const applyTotal = (total: number) =>
    void actions
      .run('settings', () =>
        connection.mutate(
          '/settings',
          { patch: { totalCards: total }, configVersion: lobby.configVersion },
          'PATCH',
        ),
      )
      .then(() => connection.refresh());

  return (
    <div className="flex flex-col gap-6">
      {status !== 'live' ? (
        <div
          role="status"
          className="rounded-[var(--radius-panel-sm)] border border-warn/60 bg-[#2d2412] px-4 py-3 text-sm"
        >
          <strong className="font-semibold">
            {status === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
          </strong>{' '}
          Showing the last confirmed lobby. Actions resume when the connection returns.
        </div>
      ) : null}
      {status === 'live' && !me.isController ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-panel-sm)] border border-line bg-raised px-4 py-3 text-sm"
        >
          <span>
            <strong className="font-semibold">View only.</strong> Another tab controls your seat.
          </span>
          <Button
            size="touch"
            variant="secondary"
            onClick={() => void actions.run('control', () => connection.takeControl())}
          >
            Use this tab
          </Button>
        </div>
      ) : null}
      {handoverLive && handover ? (
        <StatusMessage tone="info" title="You were asked to become host">
          <div className="flex flex-wrap items-center gap-3">
            <span>
              Accept before {new Date(handover.expiresAt).toLocaleTimeString()} to take over
              hosting.
            </span>
            <Button
              size="touch"
              disabled={!canAct}
              pending={actions.pending === 'accept'}
              onClick={() =>
                void actions
                  .run('accept', () =>
                    connection.command('room.host.accept', { handoverId: handover.handoverId }),
                  )
                  .then(() => connection.refresh())
              }
            >
              Accept host
            </Button>
          </div>
        </StatusMessage>
      ) : null}

      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={lobby.gameType === 'card' ? 'card' : 'auction'}>
            {lobby.gameType === 'card' ? 'Card Battle' : 'Mega Auction'}
          </Badge>
          <Badge>{lobbyOpen ? 'Lobby' : lobby.lifecycle.toLowerCase()}</Badge>
          <span className="text-sm text-ink-2">{status === 'live' ? '● Live' : '◌ Offline'}</span>
        </div>
        <h1 className="font-display text-[32px] leading-[38px] font-semibold break-words sm:text-[40px] sm:leading-[46px]">
          {lobby.name}
        </h1>
      </header>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-6">
          <Surface aria-labelledby="roster-heading">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="roster-heading" className="text-xl font-semibold">
                Players
              </h2>
              <p className="text-sm text-ink-2">
                {players.length}
                {lobby.gameType === 'card' && capacity ? ` of ${capacity}` : ''} joined ·{' '}
                {players.length - notReady.length} ready
              </p>
            </div>
            <ul className="mt-4 flex flex-col gap-3" aria-live="polite">
              {lobby.members.map((m) => (
                <MemberRow
                  key={m.id}
                  member={m}
                  me={m.id === me.memberId}
                  canManage={isHost && lobbyOpen && canAct}
                  onRemove={() => setConfirm({ kind: 'remove', member: m })}
                  onMakeHost={() => setConfirm({ kind: 'host', member: m })}
                />
              ))}
              {lobby.gameType === 'card'
                ? Array.from({ length: Math.max(0, capacity - lobby.members.length) }, (_, i) => (
                    <li
                      key={`open-${i}`}
                      className="rounded-[var(--radius-panel-sm)] border border-dashed border-line p-4 text-sm text-ink-3"
                    >
                      Open seat
                    </li>
                  ))
                : null}
            </ul>
          </Surface>
          {typeof children === 'function' ? children({ room, connection, canAct }) : children}
        </div>

        <aside className="flex flex-col gap-6">
          <Surface aria-labelledby="invite-heading">
            <h2 id="invite-heading" className="text-lg font-semibold">
              Invite friends
            </h2>
            {lobby.roomCode ? (
              <>
                <p className="mt-3 text-sm text-ink-2">Room code</p>
                <p className="font-mono text-2xl tracking-wider tabular-nums">{lobby.roomCode}</p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <Button size="touch" variant="secondary" onClick={() => void copyCode()}>
                    Copy code
                  </Button>
                  <span role="status" aria-live="polite" className="text-sm text-ok">
                    {copied ? 'Code copied' : ''}
                  </span>
                </div>
                {lobby.passwordProtected ? (
                  <p className="mt-3 text-sm text-ink-2">
                    Password protected. Share the password separately.
                  </p>
                ) : null}
              </>
            ) : (
              <p className="mt-3 text-sm text-ink-2">Invitations are closed.</p>
            )}
          </Surface>
          <Surface aria-labelledby="rules-heading">
            <h2 id="rules-heading" className="text-lg font-semibold">
              Rules
            </h2>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink-2">
              {lobby.ruleLabels.map((label) => (
                <li key={label}>{label}</li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-ink-3">Rules version {lobby.configVersion}</p>
            {isHost && lobbyOpen ? (
              <Button
                size="touch"
                variant="secondary"
                className="mt-4"
                disabled={!canAct}
                onClick={() => setSettingsOpen(true)}
              >
                Change settings
              </Button>
            ) : null}
          </Surface>
        </aside>
      </div>

      {actions.error ? (
        actions.error.action === 'start' ? (
          <StartFailure error={actions.error.error} onApplyTotal={applyTotal} />
        ) : (
          <StatusMessage tone="error">{actions.error.error.message}</StatusMessage>
        )
      ) : null}

      <div className="sticky bottom-0 -mx-[var(--gutter)] flex flex-wrap items-center gap-3 border-t border-line bg-midnight px-[var(--gutter)] py-4">
        {lobbyOpen && readyPhase && mine?.role === 'player' ? (
          <Button
            aria-pressed={mine.ready}
            variant={lobby.gameType === 'card' ? 'primary' : 'auction'}
            disabled={!canAct}
            pending={actions.pending === 'ready'}
            onClick={() =>
              void actions.run('ready', () =>
                connection.mutate('/ready', {
                  ready: !mine.ready,
                  configVersion: lobby.configVersion,
                }),
              )
            }
          >
            {mine.ready ? 'Ready ✓ (tap to undo)' : "I'm ready"}
          </Button>
        ) : null}
        {isHost && lobbyOpen && readyPhase ? (
          <Button
            variant="secondary"
            disabled={!canAct}
            pending={actions.pending === 'start'}
            onClick={() =>
              void actions.run('start', () =>
                connection.mutate('/start', { configVersion: lobby.configVersion }),
              )
            }
          >
            Start game
          </Button>
        ) : null}
        {isHost && lobbyOpen && readyPhase && notReady.length > 0 ? (
          <p className="text-sm text-ink-2">
            Waiting for: {notReady.map((m) => m.displayName).join(', ')}
          </p>
        ) : null}
        <Button
          variant="tertiary"
          className="ml-auto"
          disabled={!canAct}
          onClick={() => setConfirm({ kind: 'leave' })}
        >
          Leave room
        </Button>
      </div>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        lobby={lobby}
        connection={connection}
      />
      <ConfirmDialogs
        confirm={confirm}
        onClose={() => setConfirm(null)}
        lobby={lobby}
        connection={connection}
        onLeft={() => router.push(hubFor(lobby.gameType))}
        run={actions.run}
      />
    </div>
  );
}

function ConfirmDialogs({
  confirm,
  onClose,
  lobby,
  connection,
  onLeft,
  run,
}: {
  confirm: { kind: 'leave' } | { kind: 'remove' | 'host'; member: RoomMemberSummary } | null;
  onClose: () => void;
  lobby: Lobby;
  connection: RoomConnection;
  onLeft: () => void;
  run: ReturnType<typeof useAction>['run'];
}) {
  if (!confirm) return null;
  const lobbyOpen = lobby.lifecycle === 'LOBBY';
  if (confirm.kind === 'leave') {
    return (
      <Dialog
        open
        onOpenChange={(o) => (!o ? onClose() : undefined)}
        title="Leave this room?"
        description={
          lobbyOpen
            ? 'You give up your seat. If you are the host, hosting passes to the next player.'
            : 'You stop controlling your seat; your game position is kept.'
        }
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              Stay
            </Button>
            <Button
              variant="danger"
              onClick={() =>
                void run('leave', () => connection.mutate('/leave')).then((res) => {
                  onClose();
                  if (res.ok) onLeft();
                })
              }
            >
              Leave room
            </Button>
          </>
        }
      />
    );
  }
  const { member } = confirm;
  return (
    <Dialog
      open
      onOpenChange={(o) => (!o ? onClose() : undefined)}
      title={
        confirm.kind === 'remove'
          ? `Remove ${member.displayName}?`
          : `Make ${member.displayName} host?`
      }
      description={
        confirm.kind === 'remove'
          ? 'They leave the lobby and must rejoin with the code.'
          : 'They get 60 seconds to accept. You keep hosting until they do.'
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={confirm.kind === 'remove' ? 'danger' : 'primary'}
            onClick={() =>
              void run(confirm.kind, () =>
                connection.mutate(confirm.kind === 'remove' ? '/kick' : '/host', {
                  memberId: member.id,
                }),
              ).then(onClose)
            }
          >
            {confirm.kind === 'remove' ? 'Remove from room' : 'Send host request'}
          </Button>
        </>
      }
    />
  );
}
