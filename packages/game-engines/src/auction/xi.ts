/**
 * Legal XI feasibility (rules §9.1, §13): 11 players, at most 4 overseas, at
 * least 1 wicketkeeper, 5 bowling-capable (bowlers and all-rounders), 2 pace,
 * 1 spin and 6 batting-capable (batters, keepers and all-rounders). A team
 * must always be able to field such an XI from the players it owns plus at
 * most `slotsLeft` more players still available in the pool.
 */

export type XiRole = 'batter' | 'wicketkeeper' | 'all_rounder' | 'bowler';
export type BowlType = 'pace' | 'spin' | null;

export interface XiPlayer {
  role: XiRole;
  bowlType: BowlType;
  overseas: boolean;
}

export const XI_RULES = {
  size: 11,
  overseas: 4,
  keepers: 1,
  bowlers: 5,
  pace: 2,
  spin: 1,
  batters: 6,
};

interface Contribution {
  overseas: number;
  keeper: number;
  bowler: number;
  pace: number;
  spin: number;
  batter: number;
}

function contribution(p: XiPlayer): Contribution {
  const bowls = p.role === 'bowler' || p.role === 'all_rounder';
  return {
    overseas: p.overseas ? 1 : 0,
    keeper: p.role === 'wicketkeeper' ? 1 : 0,
    bowler: bowls ? 1 : 0,
    pace: bowls && p.bowlType === 'pace' ? 1 : 0,
    spin: bowls && p.bowlType === 'spin' ? 1 : 0,
    batter: p.role === 'bowler' ? 0 : 1,
  };
}

// State: count (0..11), overseas (0..4), keeper (0..1), bowler (0..5), pace (0..2),
// spin (0..1), batter (0..6), extra picks used (0..11), packed into one integer.
const R = XI_RULES;
const DIMS = [
  R.size + 1,
  R.overseas + 1,
  R.keepers + 1,
  R.bowlers + 1,
  R.pace + 1,
  R.spin + 1,
  R.batters + 1,
  R.size + 1,
];

function pack(v: readonly number[]): number {
  let n = 0;
  for (let i = 0; i < DIMS.length; i += 1) n = n * (DIMS[i] ?? 1) + (v[i] ?? 0);
  return n;
}

function unpack(n: number): number[] {
  const v = new Array<number>(DIMS.length).fill(0);
  for (let i = DIMS.length - 1; i >= 0; i -= 1) {
    const d = DIMS[i] ?? 1;
    v[i] = n % d;
    n = Math.floor(n / d);
  }
  return v;
}

function add(v: readonly number[], c: Contribution, extra: number): number[] | null {
  const count = (v[0] ?? 0) + 1;
  const overseas = (v[1] ?? 0) + c.overseas;
  const used = (v[7] ?? 0) + extra;
  if (count > R.size || overseas > R.overseas || used > R.size) return null;
  return [
    count,
    overseas,
    Math.min(R.keepers, (v[2] ?? 0) + c.keeper),
    Math.min(R.bowlers, (v[3] ?? 0) + c.bowler),
    Math.min(R.pace, (v[4] ?? 0) + c.pace),
    Math.min(R.spin, (v[5] ?? 0) + c.spin),
    Math.min(R.batters, (v[6] ?? 0) + c.batter),
    used,
  ];
}

const legal = (v: readonly number[]) =>
  v[0] === R.size &&
  v[2] === R.keepers &&
  v[3] === R.bowlers &&
  v[4] === R.pace &&
  v[5] === R.spin &&
  v[6] === R.batters;

const typeKey = (p: XiPlayer) => `${p.role}|${p.bowlType ?? '-'}|${p.overseas ? 1 : 0}`;

/**
 * Can a legal XI be formed from `owned` plus up to `slotsLeft` players picked
 * from `available` (the pool still on offer)?
 */
export function xiFeasible(
  owned: readonly XiPlayer[],
  available: readonly XiPlayer[],
  slotsLeft: number,
): boolean {
  let states = new Set<number>([pack([0, 0, 0, 0, 0, 0, 0, 0])]);
  const step = (c: Contribution, extra: number, copies: number) => {
    const next = new Set(states);
    for (const s of states) {
      let v: number[] | null = unpack(s);
      for (let k = 0; k < copies && v; k += 1) {
        v = add(v, c, extra);
        if (v) next.add(pack(v));
      }
    }
    states = next;
  };
  for (const p of owned) step(contribution(p), 0, 1);
  const limit = Math.max(0, Math.min(slotsLeft, R.size));
  if (limit > 0) {
    const types = new Map<string, { c: Contribution; n: number }>();
    for (const p of available) {
      const k = typeKey(p);
      const t = types.get(k);
      if (t) t.n += 1;
      else types.set(k, { c: contribution(p), n: 1 });
    }
    for (const { c, n } of types.values()) step(c, 1, Math.min(n, limit));
  }
  for (const s of states) {
    const v = unpack(s);
    if (legal(v) && (v[7] ?? 0) <= limit) return true;
  }
  return false;
}
