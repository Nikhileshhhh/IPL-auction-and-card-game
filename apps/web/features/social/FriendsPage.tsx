'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import type { FriendshipStatus, FriendsView, MemberCard } from '@stumps/contracts';
import { Badge, Button, Skeleton, StatusMessage, Surface, TextField, cx } from '@stumps/ui';
import { api } from '@/lib/api-client';
import { Avatar } from './Avatar';

type Tab = 'friends' | 'requests' | 'find' | 'blocked';
type Found = MemberCard & { friendshipStatus: FriendshipStatus };

function Row({ member, children }: { member: MemberCard; children?: ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-lg border border-line px-3 py-2">
      <Avatar name={member.displayName} url={member.avatarUrl} size="sm" />
      <Link href={`/players/${member.username}`} className="min-w-0 flex-1 rounded-lg">
        <span className="block font-semibold break-words">{member.displayName}</span>
        <span className="block text-sm text-ink-3">@{member.username}</span>
      </Link>
      {children ? <span className="flex flex-wrap gap-2">{children}</span> : null}
    </li>
  );
}

/**
 * S30 friends: list, requests, username search (never e-mail) and blocks.
 * With `?room=<id>` (opened from a lobby) each friend can be invited to that
 * room; the invite never carries the room code, so the password still applies.
 */
export function FriendsPage({ inviteRoomId }: { inviteRoomId: string | null }) {
  const [tab, setTab] = useState<Tab>('friends');
  const [view, setView] = useState<FriendsView | null | undefined>(undefined);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<Found[] | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [invited, setInvited] = useState<Set<string>>(new Set());

  const load = () => api<FriendsView>('/friends').then((res) => setView(res.ok ? res.data : null));
  useEffect(() => {
    void load();
  }, []);

  async function act(
    run: () => Promise<{ ok: boolean; error?: { message: string } }>,
    done: string,
  ) {
    const res = await run();
    setNotice(
      res.ok
        ? { tone: 'success', text: done }
        : { tone: 'error', text: res.error?.message ?? 'Something went wrong. Try again.' },
    );
    await load();
    if (found) await search();
    return res.ok;
  }

  async function search() {
    const q = query.trim().toLowerCase();
    if (q.length < 3) {
      setFound(null);
      return;
    }
    const res = await api<{ members: Found[] }>(`/members/search?q=${encodeURIComponent(q)}`);
    if (res.ok) setFound(res.data.members);
    else setNotice({ tone: 'error', text: res.error.message });
  }

  const requests = view ? view.incoming.length : 0;
  const tabs: { id: Tab; label: string }[] = [
    { id: 'friends', label: `Friends${view ? ` (${view.friends.length})` : ''}` },
    { id: 'requests', label: `Requests${requests ? ` (${requests})` : ''}` },
    { id: 'find', label: 'Find people' },
    { id: 'blocked', label: 'Blocked' },
  ];

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-display text-[32px] leading-[38px] font-semibold">Friends</h1>
        <p className="mt-2 text-ink-2">
          Friends stay with you across rooms. Search finds people by username only.
        </p>
      </header>
      {inviteRoomId ? (
        <StatusMessage tone="info" title="Inviting to your room">
          Choose friends to invite. They still need the room password if it has one.{' '}
          <Link href={`/rooms/${inviteRoomId}/lobby`} className="underline">
            Back to the lobby
          </Link>
        </StatusMessage>
      ) : null}

      <div role="tablist" aria-label="Friends sections" className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cx(
              'min-h-11 rounded-lg border px-3 text-sm font-semibold',
              tab === t.id ? 'border-card bg-card/15' : 'border-line',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {notice ? <StatusMessage tone={notice.tone}>{notice.text}</StatusMessage> : null}

      {view === undefined ? (
        <Skeleton className="h-40 w-full" />
      ) : view === null ? (
        <StatusMessage tone="warning">
          Friends are unavailable right now. Try again soon.
        </StatusMessage>
      ) : (
        <Surface>
          {tab === 'friends' ? (
            view.friends.length === 0 ? (
              <p className="text-sm text-ink-2">
                No friends yet. Use <strong>Find people</strong> to send a request.
              </p>
            ) : (
              <ul className="flex flex-col gap-2" aria-label="Your friends">
                {view.friends.map((f) => (
                  <Row key={f.userId} member={f}>
                    {f.inRoom ? <Badge tone="auction">In a room</Badge> : null}
                    {inviteRoomId ? (
                      <Button
                        size="touch"
                        disabled={invited.has(f.userId)}
                        onClick={() =>
                          void act(
                            () =>
                              api(`/rooms/${inviteRoomId}/invites`, {
                                method: 'POST',
                                body: { friendUserId: f.userId },
                              }),
                            `Invited ${f.displayName}.`,
                          ).then((ok) => {
                            if (ok) setInvited((s) => new Set(s).add(f.userId));
                          })
                        }
                      >
                        {invited.has(f.userId) ? 'Invited' : 'Invite'}
                      </Button>
                    ) : null}
                    <Button
                      size="touch"
                      variant="tertiary"
                      onClick={() =>
                        void act(
                          () => api(`/friends/${f.friendshipId}`, { method: 'DELETE' }),
                          `Removed ${f.displayName} from friends.`,
                        )
                      }
                    >
                      Remove
                    </Button>
                  </Row>
                ))}
              </ul>
            )
          ) : null}

          {tab === 'requests' ? (
            <div className="flex flex-col gap-6">
              <section aria-labelledby="incoming-heading">
                <h2 id="incoming-heading" className="text-lg font-semibold">
                  Waiting for you
                </h2>
                {view.incoming.length === 0 ? (
                  <p className="mt-2 text-sm text-ink-2">No requests waiting.</p>
                ) : (
                  <ul className="mt-3 flex flex-col gap-2">
                    {view.incoming.map((r) => (
                      <Row key={r.userId} member={r}>
                        <Button
                          size="touch"
                          onClick={() =>
                            void act(
                              () => api(`/friends/${r.friendshipId}/accept`, { method: 'POST' }),
                              `You and ${r.displayName} are now friends.`,
                            )
                          }
                        >
                          Accept
                        </Button>
                        <Button
                          size="touch"
                          variant="secondary"
                          onClick={() =>
                            void act(
                              () => api(`/friends/${r.friendshipId}`, { method: 'DELETE' }),
                              'Request declined.',
                            )
                          }
                        >
                          Decline
                        </Button>
                      </Row>
                    ))}
                  </ul>
                )}
              </section>
              <section aria-labelledby="outgoing-heading">
                <h2 id="outgoing-heading" className="text-lg font-semibold">
                  Sent by you
                </h2>
                {view.outgoing.length === 0 ? (
                  <p className="mt-2 text-sm text-ink-2">No requests sent.</p>
                ) : (
                  <ul className="mt-3 flex flex-col gap-2">
                    {view.outgoing.map((r) => (
                      <Row key={r.userId} member={r}>
                        <Button
                          size="touch"
                          variant="tertiary"
                          onClick={() =>
                            void act(
                              () => api(`/friends/${r.friendshipId}`, { method: 'DELETE' }),
                              'Request cancelled.',
                            )
                          }
                        >
                          Cancel
                        </Button>
                      </Row>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          ) : null}

          {tab === 'find' ? (
            <div className="flex flex-col gap-4">
              <form
                className="flex flex-wrap items-end gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void search();
                }}
              >
                <TextField
                  label="Username"
                  hint="At least 3 characters. People who keep their profile private don't appear."
                  value={query}
                  maxLength={40}
                  autoComplete="off"
                  onChange={(e) => setQuery(e.target.value)}
                  className="min-w-0 flex-1"
                />
                <Button type="submit" size="touch" disabled={query.trim().length < 3}>
                  Search
                </Button>
              </form>
              {found === null ? null : found.length === 0 ? (
                <p className="text-sm text-ink-2" role="status">
                  No members match that username.
                </p>
              ) : (
                <ul className="flex flex-col gap-2" aria-label="Search results">
                  {found.map((m) => (
                    <Row key={m.userId} member={m}>
                      {m.friendshipStatus === 'none' ? (
                        <Button
                          size="touch"
                          onClick={() =>
                            void act(
                              () =>
                                api('/friends/requests', {
                                  method: 'POST',
                                  body: { targetUserId: m.userId },
                                }),
                              `Friend request sent to ${m.displayName}.`,
                            )
                          }
                        >
                          Add friend
                        </Button>
                      ) : (
                        <Badge tone="card">
                          {m.friendshipStatus === 'friends'
                            ? 'Friends'
                            : m.friendshipStatus === 'requested'
                              ? 'Request sent'
                              : m.friendshipStatus === 'incoming'
                                ? 'Wants to be friends'
                                : m.friendshipStatus}
                        </Badge>
                      )}
                    </Row>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          {tab === 'blocked' ? (
            view.blocked.length === 0 ? (
              <p className="text-sm text-ink-2">You haven&apos;t blocked anyone.</p>
            ) : (
              <ul className="flex flex-col gap-2" aria-label="Blocked members">
                {view.blocked.map((b) => (
                  <li
                    key={b.userId}
                    className="flex flex-wrap items-center gap-3 rounded-lg border border-line px-3 py-2"
                  >
                    <Avatar name={b.displayName} url={b.avatarUrl} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{b.displayName}</span>
                      <span className="block text-sm text-ink-3">@{b.username}</span>
                    </span>
                    <Button
                      size="touch"
                      variant="secondary"
                      onClick={() =>
                        void act(
                          () => api(`/blocks/${b.userId}`, { method: 'DELETE' }),
                          `Unblocked ${b.displayName}. Unblocking doesn't restore a friendship.`,
                        )
                      }
                    >
                      Unblock
                    </Button>
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </Surface>
      )}
    </div>
  );
}
