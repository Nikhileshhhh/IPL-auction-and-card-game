'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { AdminOverview, AdminRooms } from '@stumps/contracts';
import { Badge, Button, Skeleton, StatusMessage, Surface } from '@stumps/ui';
import { api } from '@/lib/api-client';

const LIFECYCLE_TEXT: Record<keyof AdminOverview['rooms'], string> = {
  LOBBY: 'In lobby',
  RUNNING: 'Playing',
  FINALIZING: 'Working out results',
  RESULTS: 'Showing results',
  PURGING: 'Being deleted',
  ABORTED: 'Aborted',
};

/** Health older than this is labelled stale. */
const STALE_MS = 60_000;

function time(iso: string) {
  return new Date(iso).toLocaleString();
}

/**
 * S33 HealthOverview, ActiveRoomTable and AuditPreview. Every number is
 * measured by the API at `generatedAt`; a widget that fails says so on its
 * own and never shows a guessed or fake live count. Nothing here shows room
 * names, members, chat, cards or results.
 */
export function OperationsOverview() {
  const [overview, setOverview] = useState<AdminOverview | null | undefined>(undefined);
  const [rooms, setRooms] = useState<AdminRooms | null | undefined>(undefined);
  const [now, setNow] = useState(() => Date.now());

  const load = () =>
    Promise.all([api<AdminOverview>('/admin/overview'), api<AdminRooms>('/admin/rooms')]).then(
      ([o, r]) => {
        setOverview(o.ok ? o.data : null);
        setRooms(r.ok ? r.data : null);
        setNow(Date.now());
      },
    );
  useEffect(() => {
    void load();
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  const stale = overview ? now - new Date(overview.generatedAt).getTime() > STALE_MS : false;
  const critical = overview
    ? [
        !overview.health.database && 'The database did not answer.',
        overview.health.workers.some((w) => !w.healthy) && 'A background worker lease has expired.',
        overview.cleanup.overdue > 0 && `${overview.cleanup.overdue} room deletion(s) are overdue.`,
      ].filter((x): x is string => Boolean(x))
    : [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-2" aria-live="polite">
          {overview ? (
            <>
              Measured {time(overview.generatedAt)}{' '}
              {stale ? <Badge tone="warning">Stale — refresh</Badge> : null}
            </>
          ) : null}
        </p>
        <Button size="touch" variant="secondary" onClick={() => void load()}>
          Refresh
        </Button>
      </div>

      {critical.length ? (
        <StatusMessage tone="error" title="Needs attention">
          <ul className="list-disc pl-5">
            {critical.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </StatusMessage>
      ) : null}

      <section aria-labelledby="health-heading">
        <h2 id="health-heading" className="text-xl font-semibold">
          Health
        </h2>
        {overview === undefined ? (
          <Skeleton className="mt-3 h-32 w-full" />
        ) : overview === null ? (
          <StatusMessage tone="warning" className="mt-3">
            Health figures are unavailable right now. Other widgets still work.
          </StatusMessage>
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Surface as="div" className="p-4">
              <p className="text-sm text-ink-3">Database</p>
              <p className="mt-1 text-lg font-semibold">
                {overview.health.database ? 'Answering' : 'Not answering'}
              </p>
              <p className="text-xs text-ink-3 break-all">Schema {overview.health.migration}</p>
            </Surface>
            <Surface as="div" className="p-4">
              <p className="text-sm text-ink-3">Background workers</p>
              {overview.health.workers.length === 0 ? (
                <p className="mt-1 text-lg font-semibold">No lease recorded</p>
              ) : (
                <ul className="mt-1 text-sm">
                  {overview.health.workers.map((w) => (
                    <li key={w.name} className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{w.name}</span>
                      <Badge tone={w.healthy ? 'neutral' : 'warning'}>
                        {w.healthy ? 'Healthy' : 'Lease expired'}
                      </Badge>
                      <span className="text-xs text-ink-3">{time(w.heartbeatAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Surface>
            <Surface as="div" className="p-4">
              <p className="text-sm text-ink-3">Live connections</p>
              <p className="mt-1 text-lg font-semibold tabular-nums">{overview.liveConnections}</p>
              <p className="text-xs text-ink-3">Room sockets with a current lease</p>
            </Surface>
            <Surface as="div" className="p-4">
              <p className="text-sm text-ink-3">Security (24 hours)</p>
              <p className="mt-1 text-lg font-semibold tabular-nums">
                {overview.security.warnings24h} warning(s)
              </p>
              <p className="text-xs text-ink-3">
                {overview.security.suspendedUsers} member(s) suspended
              </p>
            </Surface>
          </div>
        )}
      </section>

      {overview ? (
        <section aria-labelledby="rooms-count-heading">
          <h2 id="rooms-count-heading" className="text-xl font-semibold">
            Rooms by state
          </h2>
          <table className="mt-3 w-full max-w-xl text-sm">
            <caption className="sr-only">Number of rooms in each state</caption>
            <thead>
              <tr className="text-left text-ink-3">
                <th scope="col" className="py-1 font-normal">
                  State
                </th>
                <th scope="col" className="text-right font-normal">
                  Rooms
                </th>
              </tr>
            </thead>
            <tbody>
              {(Object.keys(LIFECYCLE_TEXT) as (keyof AdminOverview['rooms'])[]).map((l) => (
                <tr key={l} className="border-t border-line">
                  <th scope="row" className="py-1.5 text-left font-normal">
                    {LIFECYCLE_TEXT[l]}
                  </th>
                  <td className="text-right tabular-nums">{overview.rooms[l]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-sm text-ink-2">
            Cleanup: {overview.cleanup.total} waiting, {overview.cleanup.overdue} overdue,{' '}
            {overview.cleanup.failing} retrying.{' '}
            <Link href="/admin/cleanup" className="underline">
              Open the cleanup queue
            </Link>
          </p>
        </section>
      ) : null}

      <section aria-labelledby="active-rooms-heading">
        <h2 id="active-rooms-heading" className="text-xl font-semibold">
          Rooms
        </h2>
        {rooms === undefined ? (
          <Skeleton className="mt-3 h-40 w-full" />
        ) : rooms === null ? (
          <StatusMessage tone="warning" className="mt-3">
            The room list is unavailable right now.
          </StatusMessage>
        ) : rooms.rooms.length === 0 ? (
          <p className="mt-3 text-sm text-ink-2">There are no rooms right now.</p>
        ) : (
          <div
            className="relative mt-3 overflow-x-auto"
            role="region"
            aria-label="Rooms table, scrolls sideways"
            tabIndex={0}
          >
            <table className="w-full min-w-[640px] text-sm">
              <caption className="sr-only">
                Rooms, most recent activity first ({rooms.total} in total)
              </caption>
              <thead>
                <tr className="text-left text-ink-3">
                  <th scope="col" className="py-2 font-normal">
                    Room
                  </th>
                  <th scope="col" className="font-normal">
                    Game
                  </th>
                  <th scope="col" className="font-normal">
                    State
                  </th>
                  <th scope="col" className="text-right font-normal">
                    Members
                  </th>
                  <th scope="col" className="text-right font-normal">
                    Online
                  </th>
                  <th scope="col" className="font-normal">
                    Last activity
                  </th>
                </tr>
              </thead>
              <tbody>
                {rooms.rooms.map((r) => (
                  <tr key={r.roomId} className="border-t border-line">
                    <th scope="row" className="py-2 text-left font-mono text-xs font-normal">
                      {r.roomId.slice(0, 8)}
                    </th>
                    <td>{r.gameType === 'card' ? 'Card Battle' : 'Mega Auction'}</td>
                    <td>
                      {LIFECYCLE_TEXT[r.lifecycle]}
                      {r.cleanupReason ? (
                        <span className="block text-xs text-ink-3">
                          Cleanup queued ({r.cleanupReason})
                        </span>
                      ) : null}
                    </td>
                    <td className="text-right tabular-nums">{r.members}</td>
                    <td className="text-right tabular-nums">{r.liveConnections}</td>
                    <td className="text-xs">{time(r.lastActivityAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {overview ? (
        <section aria-labelledby="audit-heading">
          <h2 id="audit-heading" className="text-xl font-semibold">
            Recent administrative actions
          </h2>
          {overview.audit.length === 0 ? (
            <p className="mt-3 text-sm text-ink-2">No administrative actions yet.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-1 text-sm">
              {overview.audit.map((a, i) => (
                <li key={`${a.occurredAt}-${i}`} className="flex flex-wrap gap-x-3">
                  <span className="font-mono text-xs text-ink-3">{time(a.occurredAt)}</span>
                  <span className="font-semibold">{a.action}</span>
                  <span className="text-ink-2">
                    on {a.targetClass} by {a.actorUsername ?? 'a removed account'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
