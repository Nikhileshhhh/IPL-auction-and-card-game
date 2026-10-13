'use client';

import { useEffect, useRef, useState } from 'react';
import {
  CHAT_MAX_CODEPOINTS,
  codepoints,
  type ChatChannel,
  type ChatChannelKind,
  type ChatMessage,
} from '@stumps/contracts';
import { Button, StatusMessage, cx } from '@stumps/ui';
import { api } from '@/lib/api-client';
import type { RoomEvent } from '@/features/room/events';
import type { LinkStatus, RoomConnection } from '@/features/room/connection';

interface Pending {
  clientMessageId: string;
  text: string;
  failed: boolean;
}

/** Wall clock for event handlers (cooldowns are display-only; the server enforces them). */
const wallClock = () => Date.now();

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/**
 * S24/S25 chat: the room channel for everyone and, in auctions, a separate
 * locked channel for the viewer's own team, each with its own draft so a
 * message is never cross-posted. Text is rendered as plain text only. A
 * message shows "sending" until the server confirms it; a retry reuses its
 * client id, so it can never be posted twice.
 */
export function ChatPanel({
  roomId,
  connection,
  status,
  hasTeams,
  initialTab = 'room',
  onClose,
}: {
  roomId: string;
  connection: RoomConnection;
  status: LinkStatus;
  hasTeams: boolean;
  initialTab?: ChatChannelKind;
  onClose?: () => void;
}) {
  const [tab, setTab] = useState<ChatChannelKind>(initialTab);
  const [channels, setChannels] = useState<Partial<Record<ChatChannelKind, ChatChannel | null>>>(
    {},
  );
  const [drafts, setDrafts] = useState<Record<ChatChannelKind, string>>({ room: '', team: '' });
  const [pending, setPending] = useState<Record<ChatChannelKind, Pending[]>>({
    room: [],
    team: [],
  });
  const [notice, setNotice] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(wallClock);
  const listRef = useRef<HTMLDivElement | null>(null);
  const nearBottom = useRef(true);

  const load = (kind: ChatChannelKind) =>
    api<ChatChannel>(`/rooms/${roomId}/chat/${kind}/messages`).then((res) =>
      setChannels((all) => ({ ...all, [kind]: res.ok ? res.data : null })),
    );

  // Load on open and again after every reconnect (missed messages, lost team access).
  useEffect(() => {
    if (status !== 'live' && status !== 'connecting') return;
    void load('room');
    if (hasTeams) void load('team');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload per (room, link state)
  }, [roomId, status, hasTeams]);

  useEffect(
    () =>
      connection.listen((event: RoomEvent) => {
        if (!event.type.startsWith('chat.')) return;
        const p = event.payload as {
          channelId: string;
          messageId?: string;
          sender?: ChatMessage['sender'];
          text?: string;
          createdAt?: string;
        };
        if (event.type === 'chat.muted') {
          void load('room');
          if (hasTeams) void load('team');
          return;
        }
        setChannels((all) => {
          const next = { ...all };
          for (const kind of ['room', 'team'] as const) {
            const c = all[kind];
            if (!c || c.channelId !== p.channelId) continue;
            if (event.type === 'chat.message' && p.messageId && p.sender) {
              if (c.messages.some((m) => m.messageId === p.messageId)) continue;
              next[kind] = {
                ...c,
                messages: [
                  ...c.messages,
                  {
                    messageId: p.messageId,
                    sender: p.sender,
                    text: p.text ?? '',
                    removed: false,
                    createdAt: p.createdAt ?? new Date().toISOString(),
                    mine: false,
                  },
                ].slice(-200),
              };
            }
            if (event.type === 'chat.removed') {
              next[kind] = {
                ...c,
                messages: c.messages.map((m) =>
                  m.messageId === p.messageId ? { ...m, removed: true, text: '' } : m,
                ),
              };
            }
          }
          return next;
        });
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- listener per connection
    [connection, hasTeams],
  );

  // Countdown display for a rate limit or mute.
  useEffect(() => {
    if (cooldownUntil <= wallClock()) return;
    const id = setInterval(() => setNow(wallClock()), 500);
    return () => clearInterval(id);
  }, [cooldownUntil]);

  const channel = channels[tab];
  const messages = channel?.messages ?? [];
  const pendingCount = pending[tab].length;
  useEffect(() => {
    const el = listRef.current;
    // Follow new messages only when the reader is already at the bottom.
    if (el && nearBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, pendingCount, tab]);

  async function deliver(kind: ChatChannelKind, item: Pending) {
    const c = channels[kind];
    if (!c) return;
    const res = await connection.command<{ messageId: string }>('chat.send', {
      channelId: c.channelId,
      clientMessageId: item.clientMessageId,
      text: item.text,
    });
    if (res.ok) {
      setPending((all) => ({
        ...all,
        [kind]: all[kind].filter((p) => p.clientMessageId !== item.clientMessageId),
      }));
      // Our own message: make sure it is shown as ours even if its event came first.
      setChannels((all) => {
        const cur = all[kind];
        if (!cur) return all;
        const exists = cur.messages.some((m) => m.messageId === res.data.messageId);
        return {
          ...all,
          [kind]: {
            ...cur,
            messages: exists
              ? cur.messages.map((m) =>
                  m.messageId === res.data.messageId ? { ...m, mine: true } : m,
                )
              : [
                  ...cur.messages,
                  {
                    messageId: res.data.messageId,
                    sender: { memberId: '', displayName: 'You' },
                    text: item.text,
                    removed: false,
                    createdAt: new Date().toISOString(),
                    mine: true,
                  },
                ],
          },
        };
      });
      return;
    }
    setPending((all) => ({
      ...all,
      [kind]: all[kind].map((p) =>
        p.clientMessageId === item.clientMessageId ? { ...p, failed: true } : p,
      ),
    }));
    const details = res.error.details as { retryAfterMs?: number; until?: string } | undefined;
    if (res.error.code === 'RATE_LIMITED' && details?.retryAfterMs) {
      const at = wallClock();
      setCooldownUntil(at + details.retryAfterMs);
      setNow(at);
    }
    if (res.error.code === 'MUTED' && details?.until) {
      setCooldownUntil(new Date(details.until).getTime());
      setNow(wallClock());
    }
    setNotice(res.error.message);
  }

  function submit() {
    const text = drafts[tab];
    if (!text.trim() || codepoints(text) > CHAT_MAX_CODEPOINTS) return;
    const item = { clientMessageId: crypto.randomUUID(), text, failed: false };
    setPending((all) => ({ ...all, [tab]: [...all[tab], item] }));
    setDrafts((all) => ({ ...all, [tab]: '' }));
    setNotice(null);
    void deliver(tab, item);
  }

  async function moderate(type: 'chat.remove' | 'chat.mute', payload: Record<string, unknown>) {
    const res = await connection.command(type, payload);
    setNotice(res.ok ? null : res.error.message);
    void load(tab);
  }

  const used = codepoints(drafts[tab]);
  const waiting = cooldownUntil > now ? Math.ceil((cooldownUntil - now) / 1000) : 0;
  const teamAvailable = hasTeams && channels.team !== null;

  return (
    <section aria-label="Chat" className="flex h-full min-h-0 flex-col gap-3 bg-raised p-4">
      <div className="flex items-center justify-between gap-2">
        <div role="tablist" aria-label="Chat audience" className="flex gap-2">
          <button
            role="tab"
            type="button"
            aria-selected={tab === 'room'}
            onClick={() => setTab('room')}
            className={cx(
              'min-h-11 rounded-lg border px-3 text-sm font-semibold',
              tab === 'room' ? 'border-card bg-card/15' : 'border-line',
            )}
          >
            Public
          </button>
          {teamAvailable ? (
            <button
              role="tab"
              type="button"
              aria-selected={tab === 'team'}
              onClick={() => setTab('team')}
              className={cx(
                'min-h-11 rounded-lg border px-3 text-sm font-semibold',
                tab === 'team' ? 'border-auction bg-auction/15' : 'border-line',
              )}
            >
              🔒 Team
            </button>
          ) : null}
        </div>
        {onClose ? (
          <Button size="touch" variant="tertiary" onClick={onClose}>
            Close chat
          </Button>
        ) : null}
      </div>
      <p
        className={cx(
          'rounded-lg px-3 py-2 text-sm font-semibold',
          tab === 'team' ? 'border border-auction/60 bg-auction/10' : 'bg-overlay',
        )}
        aria-live="polite"
      >
        {channel?.audienceLabel ?? (tab === 'team' ? 'Your team only' : 'Everyone in this room')}
      </p>
      {tab === 'team' && channel?.members ? (
        <p className="text-xs text-ink-3">
          {channel.members.map((m) => m.displayName).join(' · ')}
        </p>
      ) : null}

      <div
        ref={listRef}
        role="log"
        aria-label={tab === 'team' ? 'Team messages' : 'Public messages'}
        onScroll={(e) => {
          const el = e.currentTarget;
          nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="min-h-[200px] flex-1 overflow-y-auto"
      >
        <ol className="flex flex-col gap-2">
          {messages.length === 0 && pending[tab].length === 0 ? (
            <li className="text-sm text-ink-3">No messages yet. Say hello.</li>
          ) : null}
          {messages.map((m) => (
            <li
              key={m.messageId}
              className={cx(
                'max-w-[85%] rounded-lg px-3 py-2 text-sm',
                m.mine ? 'self-end bg-card/15' : 'self-start bg-overlay',
              )}
            >
              <span className="block text-xs text-ink-3">
                {m.mine ? 'You' : m.sender.displayName} · {time(m.createdAt)}
              </span>
              {m.removed ? (
                <span className="text-ink-3 italic">Message removed</span>
              ) : (
                <span className="break-words whitespace-pre-wrap">{m.text}</span>
              )}
              {!m.removed && (m.mine || channel?.canModerate) ? (
                <span className="mt-1 flex gap-2">
                  <button
                    type="button"
                    className="min-h-8 text-xs underline"
                    onClick={() => void moderate('chat.remove', { messageId: m.messageId })}
                  >
                    Remove
                  </button>
                  {!m.mine && channel?.canModerate ? (
                    <button
                      type="button"
                      className="min-h-8 text-xs underline"
                      onClick={() =>
                        void moderate('chat.mute', {
                          channelId: channel.channelId,
                          memberId: m.sender.memberId,
                          durationSeconds: 600,
                          reason: 'Muted by a moderator',
                        })
                      }
                    >
                      Mute 10 min
                    </button>
                  ) : null}
                </span>
              ) : null}
            </li>
          ))}
          {pending[tab].map((p) => (
            <li
              key={p.clientMessageId}
              className="max-w-[85%] self-end rounded-lg bg-card/10 px-3 py-2 text-sm"
            >
              <span className="break-words whitespace-pre-wrap">{p.text}</span>
              <span className="mt-1 block text-xs text-ink-3">
                {p.failed ? (
                  <>
                    Not sent ·{' '}
                    <button
                      type="button"
                      className="underline"
                      onClick={() => {
                        setPending((all) => ({
                          ...all,
                          [tab]: all[tab].map((x) =>
                            x.clientMessageId === p.clientMessageId ? { ...x, failed: false } : x,
                          ),
                        }));
                        void deliver(tab, { ...p, failed: false });
                      }}
                    >
                      Retry
                    </button>
                  </>
                ) : (
                  'Sending…'
                )}
              </span>
            </li>
          ))}
        </ol>
      </div>

      {notice ? <StatusMessage tone="warning">{notice}</StatusMessage> : null}
      {channel && !channel.canSend && channel.mutedUntil ? (
        <StatusMessage tone="info">You are muted in this chat for now.</StatusMessage>
      ) : null}
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className="sr-only" htmlFor={`chat-${tab}`}>
          {tab === 'team' ? 'Message your team' : 'Message everyone in the room'}
        </label>
        <textarea
          id={`chat-${tab}`}
          rows={2}
          value={drafts[tab]}
          onChange={(e) => setDrafts((all) => ({ ...all, [tab]: e.target.value }))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={
            tab === 'team' ? 'Only your team sees this' : 'Everyone in the room sees this'
          }
          className="min-h-11 w-full resize-none rounded-lg border border-control bg-midnight px-3 py-2 text-sm"
        />
        <div className="flex items-center justify-between gap-2">
          <span
            className={cx(
              'text-xs tabular-nums',
              used > CHAT_MAX_CODEPOINTS ? 'text-bad' : 'text-ink-3',
            )}
          >
            {used}/{CHAT_MAX_CODEPOINTS}
            {waiting ? ` · wait ${waiting}s` : ''}
          </span>
          <Button
            type="submit"
            size="touch"
            variant={tab === 'team' ? 'auction' : 'primary'}
            disabled={
              !channel ||
              !drafts[tab].trim() ||
              used > CHAT_MAX_CODEPOINTS ||
              waiting > 0 ||
              status !== 'live'
            }
          >
            {tab === 'team' ? 'Send to team' : 'Send'}
          </Button>
        </div>
      </form>
    </section>
  );
}
