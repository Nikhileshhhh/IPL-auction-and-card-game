'use client';

import { useEffect, useState } from 'react';
import type { ResultDTO } from '@stumps/contracts';
import { Button, cx } from '@stumps/ui';
import { playCue } from '@/features/audio/sfx';
import { usePreferences, useReducedMotion } from '@/features/preferences/store';
import { SoundToggle } from '@/features/preferences/SoundToggle';

type Ranking = ResultDTO['rankings'][number];

const MEDAL_TEXT = { gold: 'Gold', silver: 'Silver', bronze: 'Bronze' } as const;
const MEDAL_STYLE = {
  gold: 'border-[#ffd36b]/70 bg-[#ffd36b]/10',
  silver: 'border-[#cfd8dc]/70 bg-[#cfd8dc]/10',
  bronze: 'border-[#d7a17a]/70 bg-[#d7a17a]/10',
} as const;
/** Bronze rises first, gold last; the whole sequence is at most 1.8 s. */
const DELAY_MS = { bronze: 0, silver: 450, gold: 900 } as const;
const CEREMONY_MS = 1_800;

function ceremonyKey(roomId: string) {
  return `stumps:ceremony:${roomId}`;
}

const decided = new Map<string, boolean>();

/**
 * The ceremony plays the first time a browser session sees these results.
 * The decision is cached so a re-render (or React's double invoke in
 * development) gets the same answer.
 */
function claimCeremony(roomId: string): boolean {
  const known = decided.get(roomId);
  if (known !== undefined) return known;
  let fresh: boolean;
  try {
    fresh = !window.sessionStorage.getItem(ceremonyKey(roomId));
    window.sessionStorage.setItem(ceremonyKey(roomId), '1');
  } catch {
    fresh = false;
  }
  decided.set(roomId, fresh);
  return fresh;
}

/**
 * S13/S27 VictoryPodium. It shows the medals the server committed and never
 * calculates one. The ceremony is a short CSS rise that never covers or
 * delays anything: the text is in the page from the start, a "Skip animation"
 * button ends it, reduced motion shows the final layout at once, and a
 * refresh or reconnect shows the final layout without replaying it.
 */
export function Podium({
  roomId,
  podium,
  team,
  myMedal,
}: {
  roomId: string;
  podium: Ranking[];
  team: boolean;
  myMedal: boolean;
}) {
  const reduced = useReducedMotion();
  // Rendered only in the browser, after the results have been fetched.
  const [fresh] = useState(() => claimCeremony(roomId));
  const [playing, setPlaying] = useState(() => fresh && !reduced);

  useEffect(() => {
    if (fresh && myMedal) {
      playCue('medal', roomId, usePreferences.getState().prefs.soundEffects);
    }
  }, [fresh, myMedal, roomId]);
  useEffect(() => {
    if (!playing) return;
    const id = setTimeout(() => setPlaying(false), CEREMONY_MS);
    return () => clearTimeout(id);
  }, [playing]);

  // Gold in the middle on wide screens; rank order when stacked.
  const order = ['silver', 'gold', 'bronze'] as const;
  return (
    <section aria-labelledby="podium-heading">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 id="podium-heading" className="text-lg font-semibold">
          Podium
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <SoundToggle />
          {playing ? (
            <Button size="touch" variant="secondary" onClick={() => setPlaying(false)}>
              Skip animation
            </Button>
          ) : null}
        </div>
      </div>
      <ol className="grid items-end gap-3 sm:grid-cols-3">
        {podium.map((r) => {
          const medal = r.medal ?? 'gold';
          return (
            <li
              key={r.competitorId}
              data-medal={medal}
              className={cx(
                'rounded-xl border p-4',
                MEDAL_STYLE[medal],
                medal === 'gold' ? 'sm:pb-10' : medal === 'silver' ? 'sm:pb-6' : 'sm:pb-4',
                playing && 'podium-step',
              )}
              style={{
                order: order.indexOf(medal),
                ...(playing ? { animationDelay: `${DELAY_MS[medal]}ms` } : {}),
              }}
            >
              <p className="text-sm font-semibold uppercase">
                {team ? 'Team ' : ''}
                {MEDAL_TEXT[medal].toLowerCase()} · rank {r.rank}
              </p>
              <p className="mt-1 text-xl font-bold break-words">{r.displayName}</p>
              <p className="text-sm text-ink-2">{r.summary}</p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
