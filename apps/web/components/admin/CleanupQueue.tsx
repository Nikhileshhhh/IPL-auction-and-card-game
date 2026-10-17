'use client';

import { useEffect, useState } from 'react';
import type { CleanupQueue as Queue } from '@stumps/contracts';
import { Badge, Button, Skeleton, StatusMessage, Surface } from '@stumps/ui';
import { api } from '@/lib/api-client';

const STAGES = { freeze: 'Freezing', assets: 'Removing files', rows: 'Deleting records' } as const;

/**
 * S33 operations cleanup queue (ADR-030): rooms waiting to be deleted, why,
 * how far they got and whether they are overdue. Safe fields only — no room
 * names, members, chat or results. Retry is allowed for finished rooms only.
 */
export function CleanupQueue() {
  const [queue, setQueue] = useState<Queue | null | undefined>(undefined);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = () => api<Queue>('/admin/cleanup').then((r) => setQueue(r.ok ? r.data : null));
  useEffect(() => {
    void load();
  }, []);

  async function retry(roomId: string) {
    setBusy(roomId);
    const res = await api(`/admin/cleanup/${roomId}/retry`, { method: 'POST', body: {} });
    setBusy(null);
    setNotice(
      res.ok
        ? { tone: 'success', text: 'Queued for the next cleanup pass (within 30 seconds).' }
        : { tone: 'error', text: res.error.message },
    );
    await load();
  }

  if (queue === undefined) return <Skeleton className="h-40 w-full" />;
  if (queue === null) {
    return (
      <StatusMessage tone="warning">The cleanup queue is unavailable right now.</StatusMessage>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2" aria-label="Queue summary">
        <Badge>{queue.total} waiting</Badge>
        <Badge tone={queue.overdue ? 'warning' : 'neutral'}>{queue.overdue} overdue</Badge>
        <Badge tone={queue.failing ? 'warning' : 'neutral'}>{queue.failing} retrying</Badge>
      </div>
      {notice ? <StatusMessage tone={notice.tone}>{notice.text}</StatusMessage> : null}
      <Surface>
        {queue.tasks.length === 0 ? (
          <p className="text-sm text-ink-2">
            Nothing is waiting: every finished room has been deleted.
          </p>
        ) : (
          <table className="w-full text-sm">
            <caption className="sr-only">Rooms waiting to be deleted</caption>
            <thead>
              <tr className="text-left text-ink-3">
                <th scope="col" className="py-2 font-normal">
                  Room
                </th>
                <th scope="col" className="font-normal">
                  Why
                </th>
                <th scope="col" className="font-normal">
                  Stage
                </th>
                <th scope="col" className="font-normal">
                  Attempts
                </th>
                <th scope="col" className="font-normal">
                  Next try
                </th>
                <th scope="col">
                  <span className="sr-only">Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {queue.tasks.map((t) => (
                <tr key={t.roomId} className="border-t border-line">
                  <td className="py-2 font-mono text-xs">
                    {t.roomId.slice(0, 8)} · {t.gameType}
                  </td>
                  <td>{t.reason}</td>
                  <td>
                    {STAGES[t.stage]}
                    {t.overdue ? (
                      <span className="ml-2">
                        <Badge tone="warning">Overdue</Badge>
                      </span>
                    ) : null}
                  </td>
                  <td className="tabular-nums">
                    {t.attempts}
                    {t.lastErrorCode ? ` · ${t.lastErrorCode}` : ''}
                  </td>
                  <td>{new Date(t.nextAttemptAt).toLocaleTimeString()}</td>
                  <td className="text-right">
                    <Button
                      size="normal"
                      variant="secondary"
                      disabled={busy === t.roomId}
                      onClick={() => void retry(t.roomId)}
                    >
                      Retry now
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Surface>
      <p className="text-xs text-ink-3">
        Deletion removes live records and stored files. Database backups and provider logs keep
        their own retention; a restore must be swept before users are let back in.
      </p>
    </div>
  );
}
