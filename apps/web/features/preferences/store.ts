'use client';

import { create } from 'zustand';
import { DEFAULT_UI_PREFERENCES, UiPreferencesSchema, type UiPreferences } from '@stumps/contracts';

/**
 * Noncritical UI preferences (ADR-031). The server row is the source of
 * truth; a copy in localStorage applies them before the first fetch returns.
 * Nothing here changes gameplay: motion and sound only alter presentation.
 */

const CACHE_KEY = 'stumps:ui-preferences';

export function readCachedPreferences(): UiPreferences {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return { ...DEFAULT_UI_PREFERENCES };
    const parsed = UiPreferencesSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : { ...DEFAULT_UI_PREFERENCES };
  } catch {
    return { ...DEFAULT_UI_PREFERENCES };
  }
}

function cachePreferences(p: UiPreferences) {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(p));
  } catch {
    // Private mode or storage disabled: the server copy still applies.
  }
}

/**
 * `data-motion` is `system`, `reduce` or `full`; CSS honours the device
 * setting only for `system`. `data-low-data` turns decorative effects off.
 */
export function applyToDocument(p: UiPreferences) {
  const root = document.documentElement;
  root.dataset.motion = p.motion;
  root.dataset.lowData = p.lowData ? 'true' : 'false';
}

/** The effective motion choice: `reduce` when the member or the device asks. */
export function motionReduced(p: Pick<UiPreferences, 'motion'>): boolean {
  if (p.motion === 'reduce') return true;
  if (p.motion === 'full') return false;
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

type PreferencesState = {
  prefs: UiPreferences;
  /** The server copy has been read (or the visitor is signed out). */
  loaded: boolean;
  replace: (p: UiPreferences, loaded?: boolean) => void;
};

export const usePreferences = create<PreferencesState>((set) => ({
  prefs: { ...DEFAULT_UI_PREFERENCES },
  loaded: false,
  replace: (prefs, loaded = true) => {
    if (typeof document !== 'undefined') {
      applyToDocument(prefs);
      cachePreferences(prefs);
    }
    set({ prefs, loaded });
  },
}));

/** Reactive reduced-motion flag for components that animate in JS. */
export function useReducedMotion(): boolean {
  const motion = usePreferences((s) => s.prefs.motion);
  return motionReduced({ motion });
}
