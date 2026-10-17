'use client';

import { useState } from 'react';
import type { UiPreferences } from '@stumps/contracts';
import { Button } from '@stumps/ui';
import { Volume2, VolumeX } from 'lucide-react';
import { api } from '@/lib/api-client';
import { unlockAudio } from '@/features/audio/sfx';
import { usePreferences } from './store';

/**
 * Quick sound-effects switch for the arena, stage and results (independent of
 * every other control; remembered as the member's preference).
 */
export function SoundToggle() {
  const prefs = usePreferences((s) => s.prefs);
  const replace = usePreferences((s) => s.replace);
  const [pending, setPending] = useState(false);
  const on = prefs.soundEffects;

  async function toggle() {
    const previous = prefs;
    if (!on) unlockAudio();
    replace({ ...prefs, soundEffects: !on });
    setPending(true);
    const res = await api<UiPreferences>('/me/preferences', {
      method: 'PATCH',
      body: { soundEffects: !on },
    });
    setPending(false);
    replace(res.ok ? res.data : previous);
  }

  return (
    <Button
      type="button"
      size="touch"
      variant="tertiary"
      aria-pressed={on}
      disabled={pending}
      onClick={() => void toggle()}
    >
      {on ? (
        <Volume2 aria-hidden="true" className="size-5" />
      ) : (
        <VolumeX aria-hidden="true" className="size-5" />
      )}
      <span>{on ? 'Sound on' : 'Sound off'}</span>
    </Button>
  );
}
