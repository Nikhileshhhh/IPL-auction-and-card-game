/**
 * Qualification and medal placement (rules §13). Competitive ranks are never
 * changed by eligibility: medals go to the first three eligible competitors
 * in rank order and the medal place is stored separately from the rank.
 */

export const QUALIFYING_MIN_COMPETITORS = 2;
export const QUALIFYING_MIN_DECIDED = 5;
/** Present for at least half of the active duration (numerator/denominator in ms). */
export const PARTICIPATION_SHARE = { num: 1, den: 2 } as const;

export type Medal = 'gold' | 'silver' | 'bronze';
export const MEDALS: readonly Medal[] = ['gold', 'silver', 'bronze'];

/**
 * A qualifying game has ≥2 competitors at start and ≥5 decided card contests
 * or ≥5 settled auction lots (sold or unsold). Anything else is practice.
 */
export function gameQualifies(competitorsAtStart: number, decided: number): boolean {
  return competitorsAtStart >= QUALIFYING_MIN_COMPETITORS && decided >= QUALIFYING_MIN_DECIDED;
}

/** Present for at least 50 % of the active (unpaused) time; zero active time never qualifies. */
export function presentEnough(participationMs: number, activeMs: number): boolean {
  if (activeMs <= 0) return false;
  return participationMs * PARTICIPATION_SHARE.den >= activeMs * PARTICIPATION_SHARE.num;
}

export interface Placement {
  medalPlace: 1 | 2 | 3;
  medal: Medal;
}

/**
 * Medal placements for competitors listed in competitive rank order. Only
 * eligible competitors take a place; an ineligible one keeps its rank and is
 * skipped. With two eligible competitors there is no bronze.
 */
export function medalPlacements(
  rankedIds: readonly string[],
  eligible: ReadonlySet<string>,
): Map<string, Placement> {
  const out = new Map<string, Placement>();
  for (const id of rankedIds) {
    if (out.size === 3) break;
    if (!eligible.has(id)) continue;
    const place = (out.size + 1) as 1 | 2 | 3;
    out.set(id, { medalPlace: place, medal: MEDALS[place - 1] as Medal });
  }
  return out;
}
