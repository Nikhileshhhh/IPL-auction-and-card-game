'use client';

import { useEffect, useLayoutEffect } from 'react';
import type { UiPreferences } from '@stumps/contracts';
import { api } from '@/lib/api-client';
import { unlockAudio } from '@/features/audio/sfx';
import { readCachedPreferences, usePreferences } from './store';

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * Applies the member's UI preferences to the document as early as possible
 * (cached copy first, then the server copy) and unlocks audio on the first
 * user gesture, as browsers require. Signed-out visitors keep the defaults.
 */
export function PreferencesBoot({ signedIn }: { signedIn: boolean }) {
  const replace = usePreferences((s) => s.replace);

  useIsoLayoutEffect(() => {
    replace(readCachedPreferences(), !signedIn);
  }, [replace, signedIn]);

  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    void api<UiPreferences>('/me/preferences').then((res) => {
      if (live && res.ok) replace(res.data);
    });
    return () => {
      live = false;
    };
  }, [replace, signedIn]);

  useEffect(() => {
    const unlock = () => {
      unlockAudio();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  return null;
}
