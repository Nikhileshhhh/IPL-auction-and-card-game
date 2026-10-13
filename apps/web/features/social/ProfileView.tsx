'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { FriendsView, ProfileDTO } from '@stumps/contracts';
import { Badge, Button, MedalBadge, Skeleton, StatusMessage, Surface, TextField } from '@stumps/ui';
import { api } from '@/lib/api-client';
import { Avatar } from './Avatar';

const VISIBILITY = {
  members: 'All STUMPS members',
  friends: 'Friends only',
  private: 'Only me',
} as const;

const STATUS_TEXT: Record<ProfileDTO['friendshipStatus'], string | null> = {
  self: null,
  none: null,
  requested: 'Friend request sent',
  incoming: 'Wants to be your friend',
  friends: 'Friends',
  blocked: 'Blocked',
};

/** Read a picked file as base64 (no data: prefix) for the avatar upload. */
function toBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * S29 profile. The server decides what this viewer may see (privacy and
 * blocks); a concealed profile reads as "not found". Medal counters come
 * only from finished-game receipts and are never editable.
 */
export function ProfileView({ username }: { username: string }) {
  const [profile, setProfile] = useState<ProfileDTO | null | undefined>(undefined);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);

  const load = () =>
    api<ProfileDTO>(`/profiles/${encodeURIComponent(username)}`).then((res) =>
      setProfile(res.ok ? res.data : null),
    );
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload per username
  }, [username]);

  if (profile === undefined) {
    return (
      <div aria-busy="true" aria-label="Loading profile" className="flex flex-col gap-4">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (profile === null) {
    return (
      <StatusMessage tone="info" title="Profile not available">
        This profile doesn&apos;t exist or isn&apos;t shared with you.{' '}
        <Link href="/friends" className="underline">
          Back to friends
        </Link>
      </StatusMessage>
    );
  }

  const own = profile.friendshipStatus === 'self';

  async function act(
    run: () => Promise<{ ok: boolean; error?: { message: string } }>,
    done: string,
  ) {
    setBusy(true);
    const res = await run();
    setBusy(false);
    setNotice(
      res.ok
        ? { tone: 'success', text: done }
        : { tone: 'error', text: res.error?.message ?? 'Something went wrong. Try again.' },
    );
    await load();
  }

  /** The friendship row id for accept/remove (only the friends view carries it). */
  async function friendshipId() {
    const res = await api<FriendsView>('/friends');
    if (!res.ok || !profile) return null;
    const all = [...res.data.friends, ...res.data.incoming, ...res.data.outgoing];
    return all.find((f) => f.userId === profile.userId)?.friendshipId ?? null;
  }

  const p = profile;
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center gap-4">
        <Avatar name={p.displayName} url={p.avatarUrl} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="text-[28px] leading-[34px] font-semibold break-words">{p.displayName}</h1>
          <p className="text-ink-2">@{p.username}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {STATUS_TEXT[p.friendshipStatus] ? (
              <Badge tone={p.friendshipStatus === 'blocked' ? 'warning' : 'card'}>
                {STATUS_TEXT[p.friendshipStatus]}
              </Badge>
            ) : null}
            {own ? <Badge>Visible to: {VISIBILITY[p.privacy.visibility]}</Badge> : null}
            {p.permittedActivity?.inRoom ? <Badge tone="auction">In a room now</Badge> : null}
          </div>
        </div>
      </header>

      {p.bio ? (
        <p className="max-w-prose break-words whitespace-pre-wrap text-ink-2">{p.bio}</p>
      ) : null}
      {notice ? <StatusMessage tone={notice.tone}>{notice.text}</StatusMessage> : null}

      {!own ? (
        <div className="flex flex-wrap gap-3" aria-label="Friend actions">
          {p.friendshipStatus === 'none' ? (
            <Button
              size="touch"
              disabled={busy}
              onClick={() =>
                void act(
                  () =>
                    api('/friends/requests', { method: 'POST', body: { targetUserId: p.userId } }),
                  'Friend request sent.',
                )
              }
            >
              Add friend
            </Button>
          ) : null}
          {p.friendshipStatus === 'incoming' ? (
            <Button
              size="touch"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const id = await friendshipId();
                  return id
                    ? api(`/friends/${id}/accept`, { method: 'POST' })
                    : { ok: false, error: { message: 'That request is no longer open.' } };
                }, 'You are now friends.')
              }
            >
              Accept request
            </Button>
          ) : null}
          {p.friendshipStatus === 'friends' ||
          p.friendshipStatus === 'requested' ||
          p.friendshipStatus === 'incoming' ? (
            <Button
              size="touch"
              variant="secondary"
              disabled={busy}
              onClick={() =>
                void act(
                  async () => {
                    const id = await friendshipId();
                    return id
                      ? api(`/friends/${id}`, { method: 'DELETE' })
                      : { ok: false, error: { message: 'Nothing to remove.' } };
                  },
                  p.friendshipStatus === 'friends' ? 'Friend removed.' : 'Request withdrawn.',
                )
              }
            >
              {p.friendshipStatus === 'friends'
                ? 'Remove friend'
                : p.friendshipStatus === 'incoming'
                  ? 'Decline'
                  : 'Cancel request'}
            </Button>
          ) : null}
          {p.friendshipStatus !== 'blocked' ? (
            <Button
              size="touch"
              variant="danger"
              disabled={busy}
              onClick={() =>
                void act(
                  () => api('/blocks', { method: 'POST', body: { targetUserId: p.userId } }),
                  'Blocked. They can no longer find you, message you or invite you.',
                )
              }
            >
              Block
            </Button>
          ) : (
            <Button
              size="touch"
              variant="secondary"
              disabled={busy}
              onClick={() =>
                void act(() => api(`/blocks/${p.userId}`, { method: 'DELETE' }), 'Unblocked.')
              }
            >
              Unblock
            </Button>
          )}
        </div>
      ) : null}

      <Surface aria-labelledby="medal-stats">
        <h2 id="medal-stats" className="text-xl font-semibold">
          Medals
        </h2>
        <ul className="mt-4 flex flex-wrap gap-6">
          <li>
            <MedalBadge medal="gold" count={p.achievementSummary.gold} />
          </li>
          <li>
            <MedalBadge medal="silver" count={p.achievementSummary.silver} />
          </li>
          <li>
            <MedalBadge medal="bronze" count={p.achievementSummary.bronze} />
          </li>
        </ul>
        <dl className="mt-6 grid grid-cols-3 gap-4 text-sm">
          <div>
            <dt className="text-ink-3">Qualifying games</dt>
            <dd className="text-lg font-semibold tabular-nums">{p.achievementSummary.games}</dd>
          </div>
          <div>
            <dt className="text-ink-3">Card wins</dt>
            <dd className="text-lg font-semibold tabular-nums">{p.achievementSummary.cardWins}</dd>
          </div>
          <div>
            <dt className="text-ink-3">Auction wins</dt>
            <dd className="text-lg font-semibold tabular-nums">
              {p.achievementSummary.auctionWins}
            </dd>
          </div>
        </dl>
        <p className="mt-4 text-xs text-ink-3">
          Medals are counted from finished qualifying games only; they can&apos;t be edited.
        </p>
      </Surface>

      {own ? (
        editing ? (
          <ProfileEditor
            profile={p}
            onSaved={(next) => {
              setProfile(next);
              setEditing(false);
              setNotice({ tone: 'success', text: 'Profile saved.' });
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <div>
            <Button size="touch" variant="secondary" onClick={() => setEditing(true)}>
              Edit profile
            </Button>
          </div>
        )
      ) : null}
    </div>
  );
}

function ProfileEditor({
  profile,
  onSaved,
  onCancel,
}: {
  profile: ProfileDTO;
  onSaved: (p: ProfileDTO) => void;
  onCancel: () => void;
}) {
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [bio, setBio] = useState(profile.bio ?? '');
  const [visibility, setVisibility] = useState(profile.privacy.visibility);
  const [activityVisible, setActivityVisible] = useState(profile.privacy.activityVisible);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [avatarNote, setAvatarNote] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    const res = await api<ProfileDTO>('/profiles/me/settings', {
      method: 'PATCH',
      body: { displayName, bio: bio.trim() ? bio : null, visibility, activityVisible },
    });
    setSaving(false);
    if (res.ok) onSaved(res.data);
    else setError(res.error.message);
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setAvatarNote('Choose a PNG, JPEG or WebP picture.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setAvatarNote('That picture is larger than 2 MB.');
      return;
    }
    setAvatarNote('Uploading…');
    const res = await api<{ avatarUrl: string }>('/profiles/me/avatar', {
      method: 'POST',
      body: { imageBase64: await toBase64(file) },
    });
    setAvatarNote(res.ok ? 'Picture updated. Location data was removed.' : res.error.message);
  }

  return (
    <Surface aria-labelledby="edit-profile">
      <h2 id="edit-profile" className="text-xl font-semibold">
        Edit profile
      </h2>
      <form
        className="mt-4 flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <TextField
          label="Display name"
          value={displayName}
          maxLength={50}
          onChange={(e) => setDisplayName(e.target.value)}
          error={error ?? undefined}
        />
        <div className="flex flex-col gap-2">
          <label htmlFor="profile-bio" className="text-sm font-medium">
            About you <span className="text-ink-3">(optional, {bio.length}/240)</span>
          </label>
          <textarea
            id="profile-bio"
            value={bio}
            maxLength={240}
            rows={3}
            onChange={(e) => setBio(e.target.value)}
            className="rounded-[var(--radius-control)] border border-control bg-midnight px-4 py-3 text-base"
          />
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">Who can see your profile</legend>
          {(Object.keys(VISIBILITY) as (keyof typeof VISIBILITY)[]).map((v) => (
            <label key={v} className="flex min-h-11 items-center gap-3 text-sm">
              <input
                type="radio"
                name="visibility"
                value={v}
                checked={visibility === v}
                onChange={() => setVisibility(v)}
              />
              {VISIBILITY[v]}
            </label>
          ))}
        </fieldset>
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={activityVisible}
            onChange={(e) => setActivityVisible(e.target.checked)}
          />
          Let friends see when I&apos;m in a room
        </label>
        <div className="flex flex-col gap-2">
          <label htmlFor="profile-avatar" className="text-sm font-medium">
            Profile picture <span className="text-ink-3">(PNG, JPEG or WebP, up to 2 MB)</span>
          </label>
          <input
            id="profile-avatar"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => void upload(e.target.files?.[0])}
            className="text-sm"
          />
          {avatarNote ? (
            <p className="text-sm text-ink-2" role="status">
              {avatarNote}
            </p>
          ) : null}
        </div>
        <div className="flex gap-3">
          <Button type="submit" size="touch" disabled={saving}>
            {saving ? 'Saving…' : 'Save profile'}
          </Button>
          <Button type="button" size="touch" variant="tertiary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Surface>
  );
}
