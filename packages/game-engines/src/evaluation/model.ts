import { XI_RULES, type BowlType, type XiRole } from '../auction/xi';

/**
 * Squad evaluation v1 (rules §10): an explainable game score for a finished
 * auction squad, not a forecast of real IPL results. Inputs are frozen when
 * the room starts: the data version's player ratings (integer points 0–1000)
 * and the pool's role, bowling type and overseas flag.
 */
export const EVALUATOR_VERSION = 'squad-eval-v1';

/**
 * v1 model choices where the data has no reviewed capability tags (ADR-029):
 * a batting-capable player is a top-order, middle or finishing option by the
 * phase (powerplay, middle, death) where their batting rating is highest;
 * a bowling-capable player is a powerplay or death option when their rating
 * for that phase is at least this many points (40 on the 0–100 scale).
 */
export const BOWLING_PHASE_OPTION_MIN = 400;

export interface EvalPlayer {
  id: string;
  role: XiRole;
  bowlType: BowlType;
  overseas: boolean;
  batting: number;
  bowling: number;
  fielding: number;
  powerplayBatting: number;
  middleBatting: number;
  deathBatting: number;
  powerplayBowling: number;
  deathBowling: number;
  roleStrength: number;
  /** Rated inputs actually present (observed-data completeness tie-break). */
  completeness: number;
  /** Rupees charged to the purse (retained players: their allocated charge). */
  cost: bigint;
}

export interface SquadRules {
  minSquad: number;
  maxSquad: number;
  overseasCap: number;
}

export interface Features {
  batCap: boolean;
  bowlCap: boolean;
  keeper: boolean;
  pace: boolean;
  spin: boolean;
  overseas: boolean;
  topOrder: boolean;
  middle: boolean;
  finisher: boolean;
  powerplayOption: boolean;
  deathOption: boolean;
  /** floor(sqrt(batting × bowling)): the all-round skill as an exact integer. */
  allRound: number;
  /** 10 × keeper quality = 7·batting + 3·fielding. */
  keeperQ10: number;
}

export function isqrt(v: number): number {
  if (v < 0) throw new Error('negative');
  let x = Math.floor(Math.sqrt(v));
  while (x * x > v) x -= 1;
  while ((x + 1) * (x + 1) <= v) x += 1;
  return x;
}

export function featuresOf(p: EvalPlayer): Features {
  const bowlCap = p.role === 'bowler' || p.role === 'all_rounder';
  const batCap = p.role !== 'bowler';
  // Best batting phase; ties go to the earlier phase.
  const phases = [p.powerplayBatting, p.middleBatting, p.deathBatting];
  let best = 0;
  for (let i = 1; i < 3; i += 1) if ((phases[i] ?? 0) > (phases[best] ?? 0)) best = i;
  return {
    batCap,
    bowlCap,
    keeper: p.role === 'wicketkeeper',
    pace: bowlCap && p.bowlType === 'pace',
    spin: bowlCap && p.bowlType === 'spin',
    overseas: p.overseas,
    topOrder: batCap && best === 0,
    middle: batCap && best === 1,
    finisher: batCap && best === 2,
    powerplayOption: bowlCap && p.powerplayBowling >= BOWLING_PHASE_OPTION_MIN,
    deathOption: bowlCap && p.deathBowling >= BOWLING_PHASE_OPTION_MIN,
    allRound: isqrt(p.batting * p.bowling),
    keeperQ10: 7 * p.batting + 3 * p.fielding,
  };
}

export type Deficit =
  | { code: 'SQUAD_TOO_SMALL'; need: number }
  | { code: 'SQUAD_TOO_LARGE'; over: number }
  | { code: 'OVERSEAS_OVER_CAP'; over: number }
  | { code: 'NO_LEGAL_XI'; missing: XiShortfall[] };

export type XiShortfall =
  'players' | 'keeper' | 'bowlers' | 'pace' | 'spin' | 'batters' | 'domestic';

/** Why a squad cannot be ranked (empty when the squad is legal). */
export function squadDeficits(
  players: readonly EvalPlayer[],
  rules: SquadRules,
  hasLegalXi: boolean,
): Deficit[] {
  const out: Deficit[] = [];
  if (players.length < rules.minSquad) {
    out.push({ code: 'SQUAD_TOO_SMALL', need: rules.minSquad - players.length });
  }
  if (players.length > rules.maxSquad) {
    out.push({ code: 'SQUAD_TOO_LARGE', over: players.length - rules.maxSquad });
  }
  const overseas = players.filter((p) => p.overseas).length;
  if (overseas > rules.overseasCap) {
    out.push({ code: 'OVERSEAS_OVER_CAP', over: overseas - rules.overseasCap });
  }
  if (!hasLegalXi) {
    const f = players.map(featuresOf);
    const missing: XiShortfall[] = [];
    if (players.length < XI_RULES.size) missing.push('players');
    if (f.filter((x) => x.keeper).length < XI_RULES.keepers) missing.push('keeper');
    if (f.filter((x) => x.bowlCap).length < XI_RULES.bowlers) missing.push('bowlers');
    if (f.filter((x) => x.pace).length < XI_RULES.pace) missing.push('pace');
    if (f.filter((x) => x.spin).length < XI_RULES.spin) missing.push('spin');
    if (f.filter((x) => x.batCap).length < XI_RULES.batters) missing.push('batters');
    if (players.length - overseas < XI_RULES.size - XI_RULES.overseas) missing.push('domestic');
    out.push({ code: 'NO_LEGAL_XI', missing });
  }
  return out;
}
