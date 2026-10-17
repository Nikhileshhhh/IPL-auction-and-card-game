'use client';

import { useEffect, useRef } from 'react';
import { usePreferences } from '@/features/preferences/store';
import { playCue, rememberEvent, type Cue } from './sfx';

/**
 * Plays `cue` once when `eventKey` changes to a new value. The key already on
 * screen when the component mounts (a refresh or reconnect) is recorded as
 * heard, so current state renders without replaying old sounds.
 */
export function useCue(cue: Cue, eventKey: string | null | undefined) {
  const enabled = usePreferences((s) => s.prefs.soundEffects);
  const first = useRef(true);
  useEffect(() => {
    if (!eventKey) {
      first.current = false;
      return;
    }
    if (first.current) {
      first.current = false;
      rememberEvent(`${cue}:${eventKey}`);
      return;
    }
    playCue(cue, eventKey, enabled);
  }, [cue, eventKey, enabled]);
}
