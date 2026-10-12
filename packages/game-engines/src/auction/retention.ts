import { reserveFor } from './roster';
import {
  LAKH,
  type AuctionFormat,
  type AuctionRules,
  type PoolPlayer,
  type RetentionCost,
  type RetentionLine,
  type RetentionPick,
  type RetentionProblem,
} from './types';

/**
 * Retention (rules §8, ADR-024).
 *
 * The purse charge for a package is
 *   max(Σ capped slabs for k capped, Σ capped negotiated salaries)
 *   + Σ max(uncapped salary, uncapped floor),
 * so five capped players cost at least ₹75 cr and a ₹23 cr star inside that
 * total does not cost more (the real 2025 retentions charged exactly this).
 * Capped players take the slabs in retention order (1st ₹18 cr, 2nd ₹14 cr, …).
 */
export function retentionCost(
  rules: AuctionRules,
  picks: readonly RetentionPick[],
  pool: ReadonlyMap<string, PoolPlayer>,
): RetentionCost {
  let cappedIndex = 0;
  const lines: RetentionLine[] = picks.map((p) => {
    const entry = pool.get(p.playerId);
    const capped = entry?.cappedStatus === 'capped';
    const slabFloor = capped
      ? (rules.retention.cappedSlabs[cappedIndex++] ?? 0n)
      : rules.retention.uncappedFloor;
    return {
      playerId: p.playerId,
      capped,
      overseas: entry?.overseas ?? false,
      slabFloor,
      salary: p.salary,
      allocated: 0n,
    };
  });
  const capped = lines.filter((l) => l.capped);
  const cappedFloors = capped.reduce((s, l) => s + l.slabFloor, 0n);
  const cappedNegotiated = capped.reduce((s, l) => s + l.salary, 0n);
  const cappedCharge = cappedFloors > cappedNegotiated ? cappedFloors : cappedNegotiated;

  // Spread the capped top-up over the slabs, largest remainder, ties by player ID.
  const topUp = cappedCharge - cappedNegotiated;
  if (topUp > 0n && cappedFloors > 0n) {
    const shares = capped.map((l) => {
      const exact = topUp * l.slabFloor;
      return { l, whole: exact / cappedFloors, rem: exact % cappedFloors };
    });
    let left = topUp - shares.reduce((s, x) => s + x.whole, 0n);
    for (const x of shares) x.l.allocated = x.l.salary + x.whole;
    const order = [...shares].sort((a, b) =>
      a.rem === b.rem ? a.l.playerId.localeCompare(b.l.playerId) : a.rem > b.rem ? -1 : 1,
    );
    for (const x of order) {
      if (left === 0n) break;
      x.l.allocated += 1n;
      left -= 1n;
    }
  } else {
    for (const l of capped) l.allocated = l.salary;
  }
  let uncappedCharge = 0n;
  for (const l of lines.filter((x) => !x.capped)) {
    l.allocated = l.salary > l.slabFloor ? l.salary : l.slabFloor;
    uncappedCharge += l.allocated;
  }
  return {
    lines,
    cappedFloors,
    cappedNegotiated,
    cappedCharge,
    uncappedCharge,
    total: cappedCharge + uncappedCharge,
  };
}

export interface RetentionContext {
  rules: AuctionRules;
  format: AuctionFormat;
  /** Catalog franchise the team represents (previous-franchise rights). */
  franchiseId: string;
  pool: ReadonlyMap<string, PoolPlayer>;
  /** Lowest base price in the frozen pool (minimum-squad reserve). */
  lowestBasePrice: bigint;
}

export interface RetentionCheck {
  ok: boolean;
  problems: RetentionProblem[];
  cost: RetentionCost;
  /** Purse left after the charge. */
  remainingPurse: bigint;
  /** Right-to-match cards left for the auction. */
  rtm: { total: number; capped: number; uncapped: number };
}

/** Validate a proposed package: caps, ownership, known status, overseas, purse and reserve. */
export function checkRetention(
  ctx: RetentionContext,
  picks: readonly RetentionPick[],
): RetentionCheck {
  const { rules } = ctx;
  const problems: RetentionProblem[] = [];
  const add = (code: RetentionProblem['code'], message: string, playerId?: string) =>
    problems.push(playerId ? { code, message, playerId } : { code, message });

  if (ctx.format === 'fresh' && picks.length > 0) {
    add('FRESH_FORMAT', 'A fresh-reset auction has no retentions.');
  }
  const seen = new Set<string>();
  for (const p of picks) {
    const entry = ctx.pool.get(p.playerId);
    if (seen.has(p.playerId)) add('DUPLICATE', 'A player can be retained once.', p.playerId);
    seen.add(p.playerId);
    if (!entry) {
      add('NOT_IN_POOL', 'This player is not in the auction pool.', p.playerId);
      continue;
    }
    if (entry.previousFranchiseId !== ctx.franchiseId) {
      add(
        'FOREIGN_IDENTITY',
        'Only players from your own previous squad can be retained.',
        p.playerId,
      );
    }
    if (entry.cappedStatus === 'unknown') {
      add(
        'UNKNOWN_STATUS',
        'Capped or uncapped status is not confirmed for this player.',
        p.playerId,
      );
    }
    if (p.salary < 0n || p.salary % LAKH !== 0n || p.salary > rules.purse) {
      add('SALARY_INVALID', 'Salary must be whole lakhs within the purse.', p.playerId);
    }
  }
  const cost = retentionCost(rules, picks, ctx.pool);
  const capped = cost.lines.filter((l) => l.capped).length;
  const uncapped = cost.lines.length - capped;
  if (picks.length > rules.retention.max) {
    add('TOO_MANY', `At most ${rules.retention.max} players can be retained.`);
  }
  if (capped > rules.retention.cappedMax) {
    add('TOO_MANY_CAPPED', `At most ${rules.retention.cappedMax} capped players can be retained.`);
  }
  if (uncapped > rules.retention.uncappedMax) {
    add(
      'TOO_MANY_UNCAPPED',
      `At most ${rules.retention.uncappedMax} uncapped players can be retained.`,
    );
  }
  if (cost.lines.filter((l) => l.overseas).length > rules.overseasMax) {
    add('OVERSEAS_LIMIT', `At most ${rules.overseasMax} overseas players per squad.`);
  }
  const remainingPurse = rules.purse - cost.total;
  const reserve = reserveFor(rules, picks.length, ctx.lowestBasePrice);
  if (remainingPurse < reserve) {
    add(
      'PURSE_INVALID',
      `The package leaves ${remainingPurse} rupees, but ${reserve} must stay free to fill the minimum squad.`,
    );
  }
  return {
    ok: problems.length === 0,
    problems,
    cost,
    remainingPurse,
    rtm: rtmCards(rules, ctx.format, capped, uncapped),
  };
}

/**
 * Right-to-match cards left after retention: 6 − retained, within the capped
 * and uncapped sub-caps (retentions plus successful RTMs share them). A fresh
 * auction has none. Successful RTMs in the auction reduce these (phase 10).
 */
export function rtmCards(
  rules: AuctionRules,
  format: AuctionFormat,
  retainedCapped: number,
  retainedUncapped: number,
  rtmUsedCapped = 0,
  rtmUsedUncapped = 0,
): { total: number; capped: number; uncapped: number } {
  if (format === 'fresh') return { total: 0, capped: 0, uncapped: 0 };
  const usedCapped = retainedCapped + rtmUsedCapped;
  const usedUncapped = retainedUncapped + rtmUsedUncapped;
  const total = Math.max(0, rules.retention.max - usedCapped - usedUncapped);
  return {
    total,
    capped: Math.min(total, Math.max(0, rules.retention.cappedMax - usedCapped)),
    uncapped: Math.min(total, Math.max(0, rules.retention.uncappedMax - usedUncapped)),
  };
}
