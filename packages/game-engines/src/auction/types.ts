/**
 * Auction rules and state shapes (rules §8, ADR-024). Money is integer rupees
 * held as bigint; the engine never uses floating point for money.
 */

export const LAKH = 100_000n;
export const CRORE = 10_000_000n;

export type CappedStatus = 'capped' | 'uncapped' | 'unknown';
export type AuctionFormat = 'retention' | 'fresh';
/** Where a rule value comes from: an official IPL source, a reported figure, or a simulator choice. */
export type Provenance = 'official' | 'reported' | 'simulator';

export interface RuleSource {
  title: string;
  url: string;
  /** ISO date the source was published. */
  published: string;
}

export interface IncrementStep {
  /** The step applies while the current bid is below this amount (null = no upper bound). */
  below: bigint | null;
  step: bigint;
}

export interface AuctionRules {
  /** Stable ruleset name, e.g. IPL_MEGA_RULES_2025_27. */
  name: string;
  label: string;
  /** The season the simulated auction is held for (capped/uncapped status is judged against it). */
  season: number;
  purse: bigint;
  squadMin: number;
  squadMax: number;
  overseasMax: number;
  overseasInXI: number;
  retention: {
    /** Retentions plus successful RTMs. */
    max: number;
    cappedMax: number;
    uncappedMax: number;
    /** Purse deduction floors for the 1st, 2nd, … capped retention. */
    cappedSlabs: readonly bigint[];
    /** Purse deduction floor for each uncapped retention. */
    uncappedFloor: bigint;
  };
  /** Base-price bands players may register at, highest first. */
  basePriceBands: readonly bigint[];
  increments: readonly IncrementStep[];
  /** A capped Indian becomes uncapped after this many calendar years without an international. */
  uncappedAfterYears: number;
  provenance: Readonly<Record<string, Provenance>>;
  sources: readonly RuleSource[];
}

/** One player in the frozen pool of a room. */
export interface PoolPlayer {
  playerId: string;
  basePrice: bigint;
  cappedStatus: CappedStatus;
  overseas: boolean;
  /** The franchise the player last played for (retention and RTM rights), if any. */
  previousFranchiseId: string | null;
}

/** One player a captain proposes to retain, in retention order. */
export interface RetentionPick {
  playerId: string;
  /** Negotiated salary in rupees (whole lakhs). */
  salary: bigint;
}

export interface RetentionLine {
  playerId: string;
  capped: boolean;
  overseas: boolean;
  /** Retention slab for this player (0 for an uncapped player beyond its floor rule). */
  slabFloor: bigint;
  salary: bigint;
  /** Purse charge allocated to this player; allocations sum exactly to the total. */
  allocated: bigint;
}

export interface RetentionCost {
  lines: RetentionLine[];
  /** Σ capped slabs for the number of capped retentions. */
  cappedFloors: bigint;
  cappedNegotiated: bigint;
  /** max(cappedFloors, cappedNegotiated). */
  cappedCharge: bigint;
  /** Σ max(salary, uncapped floor). */
  uncappedCharge: bigint;
  total: bigint;
}

export type RetentionProblemCode =
  | 'FRESH_FORMAT'
  | 'TOO_MANY'
  | 'TOO_MANY_CAPPED'
  | 'TOO_MANY_UNCAPPED'
  | 'DUPLICATE'
  | 'NOT_IN_POOL'
  | 'FOREIGN_IDENTITY'
  | 'UNKNOWN_STATUS'
  | 'OVERSEAS_LIMIT'
  | 'SALARY_INVALID'
  | 'PURSE_INVALID';

export interface RetentionProblem {
  code: RetentionProblemCode;
  playerId?: string;
  message: string;
}
