'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type { AdminOverview } from '@stumps/contracts';
import { Badge, Button, Skeleton, StatusMessage, Surface, TextField } from '@stumps/ui';
import { api } from '@/lib/api-client';

const STATUS_TEXT = {
  scheduled: 'Scheduled',
  active: 'Showing now',
  ended: 'Ended',
  archived: 'Archived',
} as const;

function localInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * S33 Announcements: plain-text notices on the dashboard (S04) for a time
 * window. Text is shown as text, never as markup; archiving hides one early.
 */
export function AnnouncementsAdmin() {
  const [items, setItems] = useState<AdminOverview['announcements'] | null | undefined>();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [startsAt, setStartsAt] = useState(() => localInput(new Date()));
  const [endsAt, setEndsAt] = useState(() => localInput(new Date(Date.now() + 24 * 3600 * 1000)));
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const load = () =>
    api<AdminOverview>('/admin/overview').then((res) =>
      setItems(res.ok ? res.data.announcements : null),
    );
  useEffect(() => {
    void load();
  }, []);

  async function create(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setNotice(null);
    const res = await api<{ id: string }>('/admin/announcements', {
      method: 'POST',
      body: {
        title,
        body,
        startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(endsAt).toISOString(),
      },
    });
    setPending(false);
    if (res.ok) {
      setTitle('');
      setBody('');
      setNotice({ tone: 'success', text: 'Announcement saved.' });
      await load();
    } else setNotice({ tone: 'error', text: res.error.message });
  }

  async function archive(id: string) {
    const res = await api(`/admin/announcements/${id}/archive`, { method: 'POST', body: {} });
    setNotice(
      res.ok
        ? { tone: 'success', text: 'Announcement archived.' }
        : { tone: 'error', text: res.error.message },
    );
    await load();
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Surface aria-labelledby="new-announcement">
        <h2 id="new-announcement" className="text-lg font-semibold">
          New announcement
        </h2>
        <form onSubmit={(e) => void create(e)} className="mt-4 flex flex-col gap-4" noValidate>
          <TextField
            label="Title"
            value={title}
            maxLength={100}
            onChange={(e) => setTitle(e.target.value)}
          />
          <div className="flex flex-col gap-2">
            <label htmlFor="announcement-body" className="text-sm font-medium">
              Message <span className="text-ink-3">({body.length}/1000, plain text)</span>
            </label>
            <textarea
              id="announcement-body"
              value={body}
              maxLength={1000}
              rows={4}
              onChange={(e) => setBody(e.target.value)}
              className="rounded-[var(--radius-control)] border border-control bg-midnight px-4 py-3 text-base"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Show from"
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
            />
            <TextField
              label="Show until"
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
            />
          </div>
          <div>
            <Button type="submit" size="touch" disabled={pending || !title.trim() || !body.trim()}>
              {pending ? 'Saving…' : 'Save announcement'}
            </Button>
          </div>
        </form>
      </Surface>
      {notice ? <StatusMessage tone={notice.tone}>{notice.text}</StatusMessage> : null}
      <section aria-labelledby="announcement-list">
        <h2 id="announcement-list" className="text-lg font-semibold">
          Recent announcements
        </h2>
        {items === undefined ? (
          <Skeleton className="mt-3 h-24 w-full" />
        ) : items === null ? (
          <StatusMessage tone="warning" className="mt-3">
            Announcements are unavailable right now.
          </StatusMessage>
        ) : items.length === 0 ? (
          <p className="mt-3 text-sm text-ink-2">No announcements yet.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {items.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line p-3"
              >
                <div className="min-w-0">
                  <p className="font-semibold break-words">{a.title}</p>
                  <p className="text-xs text-ink-3">
                    {new Date(a.startsAt).toLocaleString()} – {new Date(a.endsAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={a.status === 'active' ? 'card' : 'neutral'}>
                    {STATUS_TEXT[a.status]}
                  </Badge>
                  {a.status === 'active' || a.status === 'scheduled' ? (
                    <Button size="touch" variant="tertiary" onClick={() => void archive(a.id)}>
                      Archive
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
