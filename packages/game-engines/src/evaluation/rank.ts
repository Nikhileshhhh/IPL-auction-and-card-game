import { cmp, type Rational } from '../ratings/rational';
import type { Deficit } from './model';

/**
 * Ranking (rules §10): legal squads by unrounded total, then min(B, W)
 * (balanced core), then C, then observed-data completeness of the XI, then a
 * committed franchise-order draw. Ineligible squads follow, with their
 * deficits and never a medal; if none is legal there is no champion.
 */
export interface RankEntry {
  id: string;
  legal: boolean;
  total: Rational | null;
  b: Rational | null;
  w: Rational | null;
  c: Rational | null;
  completeness: number;
  /** Committed draw key (lower first), e.g. an HMAC of the room seed. */
  draw: string;
  deficits: Deficit[];
}

const minR = (a: Rational, b: Rational) => (cmp(a, b) <= 0 ? a : b);

function compareLegal(x: RankEntry, y: RankEntry) {
  const t = cmp(y.total as Rational, x.total as Rational);
  if (t) return t;
  const bal = cmp(minR(y.b as Rational, y.w as Rational), minR(x.b as Rational, x.w as Rational));
  if (bal) return bal;
  const c = cmp(y.c as Rational, x.c as Rational);
  if (c) return c;
  if (x.completeness !== y.completeness) return y.completeness - x.completeness;
  return x.draw < y.draw ? -1 : x.draw > y.draw ? 1 : 0;
}

export interface Ranked extends RankEntry {
  rank: number;
}

export function rankSquads(entries: readonly RankEntry[]): Ranked[] {
  const legal = entries.filter((e) => e.legal).sort(compareLegal);
  const illegal = entries
    .filter((e) => !e.legal)
    .sort((x, y) =>
      x.total && y.total ? compareLegal(x, y) : x.draw < y.draw ? -1 : x.draw > y.draw ? 1 : 0,
    );
  return [...legal, ...illegal].map((e, i) => ({ ...e, rank: i + 1 }));
}
