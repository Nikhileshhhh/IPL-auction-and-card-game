'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button, StatusMessage, TextField } from '@stumps/ui';
import { api } from '@/lib/api-client';

type Visibility = 'members' | 'friends' | 'private';

const VISIBILITY: { value: Visibility; label: string; help: string }[] = [
  {
    value: 'members',
    label: 'Club members',
    help: 'Anyone signed in to this club can see your profile and medals.',
  },
  {
    value: 'friends',
    label: 'Friends only',
    help: 'Only people you accept as friends can see your profile.',
  },
  {
    value: 'private',
    label: 'Only me',
    help: 'Your profile is hidden; opponents still see your name in games.',
  },
];

/** S03: create a recognizable club identity. Username is required; bio optional. */
export function OnboardingForm({ initialDisplayName }: { initialDisplayName: string }) {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState(
    initialDisplayName === 'New member' ? '' : initialDisplayName,
  );
  const [bio, setBio] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('members');
  const [activityVisible, setActivityVisible] = useState(true);
  const [check, setCheck] = useState<{
    username: string;
    result: { available: boolean; suggestion?: string };
  } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const normalized = username.trim().toLowerCase();
  const formatOk = /^[a-z0-9_]{3,24}$/.test(normalized);
  // Availability only applies to the exact name it was checked for.
  const availability = formatOk && check?.username === normalized ? check.result : null;

  // Debounced availability check (300 ms); the name is reserved only on save.
  useEffect(() => {
    if (!formatOk) return;
    const timer = setTimeout(() => {
      void api<{ available: boolean; suggestion?: string }>(
        `/profiles/availability?username=${encodeURIComponent(normalized)}`,
      ).then((res) => {
        if (res.ok) setCheck({ username: normalized, result: res.data });
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [normalized, formatOk]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const res = await api('/profiles/me', {
      method: 'PATCH',
      body: {
        username: normalized,
        displayName: displayName.trim(),
        ...(bio.trim() ? { bio: bio.trim() } : {}),
        visibility,
        activityVisible,
      },
    });
    setPending(false);
    if (res.ok) {
      router.replace('/play');
      router.refresh();
      return;
    }
    const suggestion = (res.error.details as { suggestion?: string } | undefined)?.suggestion;
    setError(suggestion ? `${res.error.message} Try “${suggestion}”.` : res.error.message);
    if (suggestion) setCheck({ username: normalized, result: { available: false, suggestion } });
  }

  const usernameHint = !username
    ? '3–24 characters: lowercase letters, numbers and underscores.'
    : !formatOk
      ? 'Use 3–24 lowercase letters, numbers or underscores.'
      : availability === null
        ? 'Checking availability…'
        : availability.available
          ? 'Available.'
          : 'Already taken.';

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_320px]">
      <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
        <div className="flex flex-col gap-2">
          <TextField
            label="Username"
            name="username"
            autoComplete="username"
            autoCapitalize="off"
            spellCheck={false}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            hint={usernameHint}
            error={availability && !availability.available ? 'This username is taken.' : undefined}
          />
          {availability?.suggestion ? (
            <button
              type="button"
              className="min-h-11 self-start text-sm text-ink-2 underline"
              onClick={() => setUsername(availability.suggestion ?? username)}
            >
              Use “{availability.suggestion}” instead
            </button>
          ) : null}
        </div>
        <TextField
          label="Display name"
          name="displayName"
          autoComplete="nickname"
          maxLength={50}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          hint="Shown to other players in rooms and on your profile."
        />
        <div className="flex flex-col gap-2">
          <label htmlFor="bio" className="text-sm font-medium">
            Bio <span className="text-ink-3">(optional)</span>
          </label>
          <textarea
            id="bio"
            maxLength={240}
            rows={3}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            className="rounded-[var(--radius-control)] border border-line bg-midnight px-4 py-3 text-base"
          />
          <p className="text-sm text-ink-3">{240 - bio.length} characters left</p>
        </div>
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-sm font-medium">Who can see your profile?</legend>
          {VISIBILITY.map((option) => (
            <label
              key={option.value}
              className="flex min-h-11 cursor-pointer gap-3 rounded-lg border border-line p-3"
            >
              <input
                type="radio"
                name="visibility"
                value={option.value}
                checked={visibility === option.value}
                onChange={() => setVisibility(option.value)}
                className="mt-1"
              />
              <span>
                <span className="block font-medium">{option.label}</span>
                <span className="block text-sm text-ink-2">{option.help}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <label className="flex min-h-11 items-center gap-3">
          <input
            type="checkbox"
            checked={activityVisible}
            onChange={(e) => setActivityVisible(e.target.checked)}
          />
          <span>Let friends see when I am playing</span>
        </label>
        {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}
        <Button
          type="submit"
          pending={pending}
          pendingLabel="Saving…"
          disabled={!formatOk || !displayName.trim() || availability?.available === false}
        >
          Save and enter the club
        </Button>
      </form>
      <aside
        aria-hidden="true"
        className="h-fit rounded-[var(--radius-panel)] border border-line bg-raised p-6"
      >
        <p className="text-xs tracking-widest text-ink-3 uppercase">Preview</p>
        <div className="mt-4 flex items-center gap-4">
          <div className="grid size-14 place-items-center rounded-full bg-overlay text-xl font-bold text-card">
            {(displayName.trim() || '?').slice(0, 1).toUpperCase()}
          </div>
          <div>
            <p className="text-lg font-semibold">{displayName.trim() || 'Your name'}</p>
            <p className="text-sm text-ink-2">@{formatOk ? normalized : 'username'}</p>
          </div>
        </div>
        {bio.trim() ? <p className="mt-4 text-sm text-ink-2">{bio.trim()}</p> : null}
        <p className="mt-4 text-xs text-ink-3">
          Custom avatars arrive with profiles (later phase).
        </p>
      </aside>
    </div>
  );
}
