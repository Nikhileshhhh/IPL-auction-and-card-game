'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { NotificationsView } from '@stumps/contracts';
import { Badge, Button, PasswordField, Skeleton, StatusMessage, Surface, cx } from '@stumps/ui';
import { api } from '@/lib/api-client';
import { Avatar } from './Avatar';

type Invite = NotificationsView['invites'][number];
type Item = NotificationsView['notifications'][number];

const when = (iso: string) =>
  new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

/** Plain-text line for a notification; payloads carry names and ids only. */
function describe(n: Item) {
  const p = n.payload as Record<string, string | undefined>;
  switch (n.type) {
    case 'friend.requested':
      return { text: `${p.displayName ?? 'Someone'} sent you a friend request.`, href: '/friends' };
    case 'friend.accepted':
      return {
        text: `${p.displayName ?? 'Someone'} accepted your friend request.`,
        href: p.username ? `/players/${p.username}` : '/friends',
      };
    case 'room.invited':
      return {
        text: `${p.fromDisplayName ?? 'A friend'} invited you to “${p.roomName ?? 'a room'}”.`,
        href: null,
      };
    default:
      return { text: 'Update', href: null };
  }
}

function InviteRow({ invite, onDone }: { invite: Invite; onDone: () => void }) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  // One logical join: a retry after a network failure reuses the same key;
  // any answer from the server (e.g. a wrong password) starts a fresh attempt.
  const [key, setKey] = useState(() => crypto.randomUUID());

  async function accept() {
    setJoining(true);
    setError(null);
    const res = await api<{ lobby: { roomId: string } }>(
      `/rooms/invites/${invite.inviteId}/accept`,
      {
        method: 'POST',
        body: invite.needsPassword ? { password } : {},
        idempotencyKey: key,
      },
    );
    setJoining(false);
    if (res.ok) {
      router.push(`/rooms/${invite.roomId}/lobby`);
      return;
    }
    if (res.status !== 0) setKey(crypto.randomUUID());
    setError(res.error.message);
    onDone();
  }

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-center gap-3">
        <Avatar name={invite.from.displayName} url={invite.from.avatarUrl} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold break-words">{invite.roomName}</p>
          <p className="text-sm text-ink-2">
            From {invite.from.displayName} · expires {when(invite.expiresAt)}
          </p>
        </div>
        <Badge tone={invite.gameType === 'card' ? 'card' : 'auction'}>
          {invite.gameType === 'card' ? 'Card Battle' : 'Mega Auction'}
        </Badge>
      </div>
      {invite.open ? (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void accept();
          }}
        >
          {invite.needsPassword ? (
            <PasswordField
              label="Room password"
              hint="Invites never include the password; ask your friend for it."
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="off"
              className="min-w-0 flex-1"
            />
          ) : null}
          <Button
            type="submit"
            size="touch"
            variant={invite.gameType === 'card' ? 'primary' : 'auction'}
            disabled={joining || (invite.needsPassword && !password)}
          >
            {joining ? 'Joining…' : 'Join room'}
          </Button>
        </form>
      ) : (
        <p className="text-sm text-ink-3">
          This game has already started, so the invite can&apos;t be used.
        </p>
      )}
      {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}
    </li>
  );
}

/**
 * S31 inbox: room invitations from friends and friend updates. Items are
 * personal and expire within 30 days; room chat is never copied here.
 */
export function NotificationsPage() {
  const [view, setView] = useState<NotificationsView | null | undefined>(undefined);
  const load = () =>
    api<NotificationsView>('/notifications').then((res) => setView(res.ok ? res.data : null));
  useEffect(() => {
    void load();
  }, []);

  async function markRead(id: string) {
    const res = await api(`/notifications/${id}`, { method: 'PATCH', body: { read: true } });
    if (res.ok) {
      setView((v) =>
        v
          ? {
              ...v,
              unread: Math.max(0, v.unread - 1),
              notifications: v.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)),
            }
          : v,
      );
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-display text-[32px] leading-[38px] font-semibold">Inbox</h1>
        <p className="mt-2 text-ink-2">Room invitations and friend updates.</p>
      </header>
      {view === undefined ? (
        <Skeleton className="h-40 w-full" />
      ) : view === null ? (
        <StatusMessage tone="warning">Your inbox is unavailable right now.</StatusMessage>
      ) : (
        <>
          <Surface aria-labelledby="invites-heading">
            <h2 id="invites-heading" className="text-xl font-semibold">
              Room invitations
            </h2>
            {view.invites.length === 0 ? (
              <p className="mt-2 text-sm text-ink-2">No open invitations.</p>
            ) : (
              <ul className="mt-4 flex flex-col gap-3">
                {view.invites.map((i) => (
                  <InviteRow key={i.inviteId} invite={i} onDone={() => void load()} />
                ))}
              </ul>
            )}
          </Surface>
          <Surface aria-labelledby="updates-heading">
            <h2 id="updates-heading" className="text-xl font-semibold">
              Updates {view.unread ? <Badge tone="card">{view.unread} new</Badge> : null}
            </h2>
            {view.notifications.length === 0 ? (
              <p className="mt-2 text-sm text-ink-2">Nothing new.</p>
            ) : (
              <ul className="mt-4 flex flex-col gap-2">
                {view.notifications.map((n) => {
                  const d = describe(n);
                  return (
                    <li
                      key={n.id}
                      className={cx(
                        'flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2',
                        n.read ? 'border-line text-ink-2' : 'border-card/60',
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        {!n.read ? <span className="sr-only">New: </span> : null}
                        {d.href ? (
                          <Link href={d.href} className="underline">
                            {d.text}
                          </Link>
                        ) : (
                          d.text
                        )}
                        <span className="block text-xs text-ink-3">{when(n.createdAt)}</span>
                      </span>
                      {!n.read ? (
                        <Button size="touch" variant="tertiary" onClick={() => void markRead(n.id)}>
                          Mark read
                        </Button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </Surface>
        </>
      )}
    </div>
  );
}
