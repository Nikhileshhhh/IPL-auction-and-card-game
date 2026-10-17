'use client';

import { useState } from 'react';
import type { UiPreferences } from '@stumps/contracts';
import { Surface } from '@stumps/ui';
import { api } from '@/lib/api-client';
import { playCue, unlockAudio } from '@/features/audio/sfx';
import { usePreferences } from './store';

const MOTION: Record<UiPreferences['motion'], { label: string; hint: string }> = {
  system: { label: 'Match my device', hint: 'Follows your device’s reduced-motion setting.' },
  reduce: {
    label: 'Reduce motion',
    hint: 'No card flips, shine or travelling cards; short fades only.',
  },
  full: { label: 'Full motion', hint: 'Every animation, even if your device asks for less.' },
};

/**
 * Display and sound preferences (S29 own profile). Each change saves at once
 * and applies immediately; a failed save restores the previous choice.
 */
export function PreferencesPanel() {
  const prefs = usePreferences((s) => s.prefs);
  const replace = usePreferences((s) => s.replace);
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  async function change(patch: Partial<UiPreferences>) {
    const previous = prefs;
    replace({ ...prefs, ...patch });
    setPending(true);
    setStatus(null);
    const res = await api<UiPreferences>('/me/preferences', { method: 'PATCH', body: patch });
    setPending(false);
    if (res.ok) {
      replace(res.data);
      setStatus({ tone: 'ok', text: 'Saved.' });
    } else {
      replace(previous);
      setStatus({ tone: 'error', text: `${res.error.message} Your previous choice is kept.` });
    }
  }

  return (
    <Surface aria-labelledby="display-sound">
      <h2 id="display-sound" className="text-xl font-semibold">
        Display and sound
      </h2>
      <p className="mt-1 text-sm text-ink-2">
        These only change how the game looks and sounds on your screens, never what happens in a
        match.
      </p>
      <fieldset className="mt-4 flex flex-col gap-2" disabled={pending}>
        <legend className="text-sm font-medium">Motion</legend>
        {(Object.keys(MOTION) as UiPreferences['motion'][]).map((m) => (
          <label key={m} className="flex min-h-11 items-start gap-3 py-1 text-sm">
            <input
              type="radio"
              name="motion"
              value={m}
              className="mt-1"
              checked={prefs.motion === m}
              onChange={() => void change({ motion: m })}
            />
            <span>
              <span className="font-medium">{MOTION[m].label}</span>
              <span className="block text-ink-3">{MOTION[m].hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="mt-4 flex flex-col gap-2">
        <label className="flex min-h-11 items-start gap-3 py-1 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={prefs.soundEffects}
            disabled={pending}
            onChange={(e) => {
              const on = e.target.checked;
              if (on) {
                // The checkbox click is the gesture browsers require.
                unlockAudio();
                playCue('reveal', `preview:${Date.now()}`, true);
              }
              void change({ soundEffects: on });
            }}
          />
          <span>
            <span className="font-medium">Sound effects</span>
            <span className="block text-ink-3">
              Short original tones for reveals, bids, sales and medals. Everything a sound marks is
              also shown on screen.
            </span>
          </span>
        </label>
        <label className="flex min-h-11 items-start gap-3 py-1 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={prefs.lowData}
            disabled={pending}
            onChange={(e) => void change({ lowData: e.target.checked })}
          />
          <span>
            <span className="font-medium">Low data</span>
            <span className="block text-ink-3">
              Smaller portraits and static card frames with no shine.
            </span>
          </span>
        </label>
      </div>
      <p
        role="status"
        className={`mt-2 min-h-6 text-sm ${status?.tone === 'error' ? 'text-bad' : 'text-ink-2'}`}
      >
        {pending ? 'Saving…' : (status?.text ?? '')}
      </p>
    </Surface>
  );
}
