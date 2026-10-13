'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { ShortlistView } from '@stumps/contracts';
import { Badge, Button, Skeleton, StatusMessage, Surface, TextField, cx } from '@stumps/ui';
import { api } from '@/lib/api-client';
import { croreToRupees, formatRupees, rupeesToCrore } from '@/features/auction/setup/money';
import { PlayerLine } from '@/features/auction/setup/PlayerLine';
import { PLAYER_ROLE_LABELS } from '@/features/auction/setup/useSetup';
import { useTeam } from './useTeam';

type Entry = ShortlistView['entries'][number];
type PoolPlayer = ShortlistView['pool'][number];

const STATUS_LABELS = {
  available: 'Still to come',
  unsold: 'Unsold for now',
  sold: 'Sold',
  retained: 'Retained',
  skipped: 'Skipped',
} as const;

/**
 * S23 private shortlist: the team's targets in priority order with notes,
 * private ceilings and advisory votes, and a search over the auction pool.
 * Only the team sees it; nothing here places a bid.
 */
export function TeamShortlist({ roomId }: { roomId: string }) {
  const t = useTeam(roomId);
  const [view, setView] = useState<ShortlistView | null>(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<'targets' | 'search'>('targets');
  const [query, setQuery] = useState('');
  const [role, setRole] = useState<'all' | PoolPlayer['role']>('all');
  const stateVersion = t.room?.snapshot.room.stateVersion;
  const teamId = t.team?.teamId;

  useEffect(() => {
    if (!teamId || !stateVersion) return;
    let live = true;
    void api<ShortlistView>(`/rooms/${roomId}/franchises/${teamId}/shortlist`).then((res) => {
      if (!live) return;
      setFailed(!res.ok);
      if (res.ok) setView(res.data);
    });
    return () => {
      live = false;
    };
  }, [roomId, teamId, stateVersion]);

  const players = useMemo(
    () => new Map((view?.pool ?? []).map((p) => [p.playerId, p])),
    [view?.pool],
  );
  const listed = useMemo(() => new Set(view?.entries.map((e) => e.playerId)), [view?.entries]);
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (view?.pool ?? [])
      .filter((p) => p.status === 'available' || p.status === 'unsold')
      .filter((p) => role === 'all' || p.role === role)
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .slice(0, 40);
  }, [view?.pool, query, role]);

  if (t.missing) {
    return (
      <StatusMessage tone="info" title="Join a team to plan targets">
        The shortlist belongs to a team.{' '}
        <Link href={`/rooms/${roomId}/lobby`} className="underline">
          Back to the room
        </Link>
      </StatusMessage>
    );
  }
  if (failed) return <StatusMessage tone="error">The shortlist could not be loaded.</StatusMessage>;
  if (!view || !t.team) return <Skeleton className="h-96 w-full" />;

  const canEdit = view.canEdit && t.canAct;
  const back = t.team.lifecycle === 'LOBBY' ? `/rooms/${roomId}/lobby` : `/rooms/${roomId}/auction`;
  const upsert = (e: Pick<Entry, 'playerId' | 'priority'>, extra: Record<string, unknown> = {}) =>
    t.run(`upsert:${e.playerId}`, 'team.shortlist.upsert', {
      playerId: e.playerId,
      priority: e.priority,
      ...extra,
    });
  const move = (i: number, dir: -1 | 1) => {
    const e = view.entries[i];
    const other = view.entries[i + dir];
    if (!e || !other) return;
    const priority =
      dir === -1 ? Math.min(100, other.priority + 1) : Math.max(0, other.priority - 1);
    void upsert({ playerId: e.playerId, priority });
  };

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t.team.name} shortlist</h1>
          <p className="text-sm text-ink-2">
            Private to your team. Votes are advice; only a live bid buys a player.
          </p>
        </div>
        <nav aria-label="Team pages" className="flex gap-4 text-sm">
          <Link href={`/rooms/${roomId}/team/requests`} className="underline">
            Team
          </Link>
          <Link href={back} className="underline">
            {t.team.lifecycle === 'LOBBY' ? 'Back to the lobby' : 'Back to the auction'}
          </Link>
        </nav>
      </header>
      {t.error ? <StatusMessage tone="error">{t.error.error.message}</StatusMessage> : null}

      <div role="tablist" aria-label="Shortlist views" className="flex gap-2 lg:hidden">
        {(['targets', 'search'] as const).map((k) => (
          <button
            key={k}
            role="tab"
            type="button"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cx(
              'min-h-11 flex-1 rounded-lg border px-3 text-sm font-semibold',
              tab === k ? 'border-auction bg-auction/15' : 'border-line',
            )}
          >
            {k === 'targets' ? `Targets (${view.entries.length})` : 'Find players'}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Surface
          aria-labelledby="search-heading"
          className={cx('min-w-0 p-4', tab !== 'search' && 'hidden lg:block')}
        >
          <h2 id="search-heading" className="text-lg font-semibold">
            Find players
          </h2>
          <div className="mt-3 flex flex-col gap-3">
            <TextField
              label="Search by name"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <label className="flex flex-col gap-1 text-sm font-medium">
              Role
              <select
                className="min-h-11 rounded-lg border border-control bg-raised px-3"
                value={role}
                onChange={(e) => setRole(e.target.value as typeof role)}
              >
                <option value="all">All roles</option>
                {(Object.keys(PLAYER_ROLE_LABELS) as PoolPlayer['role'][]).map((r) => (
                  <option key={r} value={r}>
                    {PLAYER_ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <ul className="mt-3 flex flex-col gap-2" aria-label="Players in the auction">
            {results.map((p) => (
              <li
                key={p.playerId}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-line p-2"
              >
                <PlayerLine player={p} />
                {listed.has(p.playerId) ? (
                  <Badge tone="auction">On the list</Badge>
                ) : canEdit ? (
                  <Button
                    size="touch"
                    variant="secondary"
                    pending={t.pending === `upsert:${p.playerId}`}
                    aria-label={`Add ${p.name} to the shortlist`}
                    onClick={() => void upsert({ playerId: p.playerId, priority: 50 })}
                  >
                    Add
                  </Button>
                ) : null}
              </li>
            ))}
            {results.length === 0 ? (
              <li className="text-sm text-ink-2">No players match.</li>
            ) : null}
          </ul>
        </Surface>

        <Surface
          aria-labelledby="targets-heading"
          className={cx('min-w-0 p-4', tab !== 'targets' && 'hidden lg:block')}
        >
          <h2 id="targets-heading" className="text-lg font-semibold">
            Targets
          </h2>
          {view.entries.length === 0 ? (
            <p className="mt-2 text-sm text-ink-2">
              No targets yet.{' '}
              {canEdit
                ? 'Add players from the search.'
                : 'Teammates with the shortlist right add them.'}
            </p>
          ) : (
            <ol className="mt-3 flex flex-col gap-3" aria-label="Targets in priority order">
              {view.entries.map((e, i) => {
                const p = players.get(e.playerId);
                if (!p) return null;
                return (
                  <TargetRow
                    key={e.playerId}
                    entry={e}
                    player={p}
                    first={i === 0}
                    last={i === view.entries.length - 1}
                    canEdit={canEdit}
                    canSetLimits={view.canSetLimits && t.canAct}
                    canVote={t.canAct}
                    pending={t.pending}
                    onMove={(dir) => move(i, dir)}
                    onSave={(extra) => void upsert(e, extra)}
                    onRemove={() =>
                      void t.run(`remove:${e.playerId}`, 'team.shortlist.remove', {
                        playerId: e.playerId,
                      })
                    }
                    onVote={(value) =>
                      void t.run(`vote:${e.playerId}`, 'team.shortlist.vote', {
                        playerId: e.playerId,
                        value,
                      })
                    }
                  />
                );
              })}
            </ol>
          )}
        </Surface>
      </div>
    </div>
  );
}

function TargetRow({
  entry,
  player,
  first,
  last,
  canEdit,
  canSetLimits,
  canVote,
  pending,
  onMove,
  onSave,
  onRemove,
  onVote,
}: {
  entry: Entry;
  player: PoolPlayer;
  first: boolean;
  last: boolean;
  canEdit: boolean;
  canSetLimits: boolean;
  canVote: boolean;
  pending: string | null;
  onMove: (dir: -1 | 1) => void;
  onSave: (extra: Record<string, unknown>) => void;
  onRemove: () => void;
  onVote: (value: -1 | 0 | 1) => void;
}) {
  const [note, setNote] = useState(entry.note ?? '');
  const [ceiling, setCeiling] = useState(
    entry.maxPriceRupees ? rupeesToCrore(entry.maxPriceRupees) : '',
  );
  const ceilingRupees = ceiling.trim() ? croreToRupees(ceiling) : null;
  const ceilingInvalid = ceiling.trim() !== '' && ceilingRupees === null;
  const vote = (v: -1 | 1) => onVote(entry.myVote === v ? 0 : v);
  return (
    <li className="rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-center gap-2">
        <PlayerLine player={player}>
          <Badge tone={player.status === 'sold' ? 'warning' : 'neutral'}>
            {STATUS_LABELS[player.status]}
          </Badge>
        </PlayerLine>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-ink-3">Priority {entry.priority}</span>
        {entry.maxPriceRupees ? (
          <Badge tone="auction">Up to {formatRupees(entry.maxPriceRupees)}</Badge>
        ) : null}
        {entry.proposedBy ? (
          <span className="text-ink-3">· added by {entry.proposedBy}</span>
        ) : null}
      </div>
      {entry.note && !canEdit ? <p className="mt-1 text-sm">{entry.note}</p> : null}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          size="touch"
          variant={entry.myVote === 1 ? 'auction' : 'secondary'}
          disabled={!canVote}
          aria-pressed={entry.myVote === 1}
          aria-label={`Recommend ${player.name} (${entry.tally.up})`}
          onClick={() => vote(1)}
        >
          👍 {entry.tally.up}
        </Button>
        <Button
          size="touch"
          variant={entry.myVote === -1 ? 'danger' : 'secondary'}
          disabled={!canVote}
          aria-pressed={entry.myVote === -1}
          aria-label={`Advise against ${player.name} (${entry.tally.down})`}
          onClick={() => vote(-1)}
        >
          👎 {entry.tally.down}
        </Button>
        {canEdit ? (
          <>
            <Button
              size="touch"
              variant="tertiary"
              disabled={first}
              aria-label={`Move ${player.name} up`}
              onClick={() => onMove(-1)}
            >
              ↑
            </Button>
            <Button
              size="touch"
              variant="tertiary"
              disabled={last}
              aria-label={`Move ${player.name} down`}
              onClick={() => onMove(1)}
            >
              ↓
            </Button>
            <Button
              size="touch"
              variant="tertiary"
              pending={pending === `remove:${entry.playerId}`}
              aria-label={`Remove ${player.name}`}
              onClick={onRemove}
            >
              Remove
            </Button>
          </>
        ) : null}
      </div>
      {canEdit ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <TextField
            label={`Note on ${player.name}`}
            value={note}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
          />
          {canSetLimits ? (
            <TextField
              label="Ceiling in crore"
              inputMode="decimal"
              value={ceiling}
              onChange={(e) => setCeiling(e.target.value)}
              error={ceilingInvalid ? 'Use crore, e.g. 4.5' : undefined}
            />
          ) : null}
          <Button
            size="touch"
            variant="secondary"
            className="sm:col-span-2 sm:justify-self-start"
            disabled={ceilingInvalid}
            pending={pending === `upsert:${entry.playerId}`}
            onClick={() =>
              onSave({
                note,
                ...(canSetLimits ? { maxPrice: ceilingRupees } : {}),
              })
            }
          >
            Save note{canSetLimits ? ' and ceiling' : ''}
          </Button>
        </div>
      ) : null}
    </li>
  );
}
