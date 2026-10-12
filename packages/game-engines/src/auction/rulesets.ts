import { sha256Hex } from '../card/rng';
import { CRORE, LAKH, type AuctionRules, type IncrementStep, type Provenance } from './types';

/**
 * The real IPL mega-auction rules (TATA IPL Player Regulations 2025–27, ADR-024),
 * applied to today's squads: the simulated auction is for the 2027 season.
 *
 * - Official (IPL press release, 28 Sep 2024): 6 retentions/RTMs with at most
 *   5 capped and 2 uncapped, ₹120 cr purse, the 5-year uncapped rule for Indians.
 * - Reported (franchise FAQs from the BCCI's communication): retention purse
 *   deductions ₹18/14/11/18/14 cr for capped players and ₹4 cr per uncapped.
 * - Squad size 18–25 with at most 8 overseas, and the base-price bands, are the
 *   standing IPL auction rules as reported for the 2025 and 2026 auctions.
 * - The bid increment schedule is a simulator choice (rules §8.2).
 */
export const IPL_MEGA_RULES_2025_27: AuctionRules = {
  name: 'IPL_MEGA_RULES_2025_27',
  label: 'IPL mega auction rules (2025–27) · today’s squads',
  season: 2027,
  purse: 120n * CRORE,
  squadMin: 18,
  squadMax: 25,
  overseasMax: 8,
  overseasInXI: 4,
  retention: {
    max: 6,
    cappedMax: 5,
    uncappedMax: 2,
    cappedSlabs: [18n * CRORE, 14n * CRORE, 11n * CRORE, 18n * CRORE, 14n * CRORE],
    uncappedFloor: 4n * CRORE,
  },
  basePriceBands: [200n, 150n, 125n, 100n, 75n, 50n, 40n, 30n].map((l) => l * LAKH),
  increments: [
    { below: CRORE, step: 5n * LAKH },
    { below: 2n * CRORE, step: 10n * LAKH },
    { below: null, step: 20n * LAKH },
  ],
  uncappedAfterYears: 5,
  provenance: {
    purse: 'official',
    retentionCount: 'official',
    retentionCapped: 'official',
    uncappedRule: 'official',
    retentionSlabs: 'reported',
    uncappedFloor: 'reported',
    squadSize: 'reported',
    overseas: 'reported',
    basePriceBands: 'reported',
    increments: 'simulator',
  } satisfies Record<string, Provenance>,
  sources: [
    {
      title: 'IPL Governing Council announces TATA IPL Player Regulations 2025-27',
      url: 'https://www.iplt20.com/news/4109/ipl-governing-council-announces-tata-ipl-player-regulations-2025-27',
      published: '2024-09-28',
    },
    {
      title:
        'IPL 2025 Auction FAQs: Retentions, RTMs, purse, uncapped rules explained (Mumbai Indians)',
      url: 'https://www.mumbaiindians.com/news/ipl-2025-auction-faqs-retentions-rtms-purse-uncapped-rules-explained',
      published: '2024-09-29',
    },
  ],
};

/** Smallest legal raise over `current` (rules §8.2). */
export function incrementFor(increments: readonly IncrementStep[], current: bigint): bigint {
  for (const s of increments) if (s.below === null || current < s.below) return s.step;
  throw new RangeError('The increment schedule has no open-ended step.');
}

/** Rules as plain JSON (money as decimal strings) for storage and hashing. */
export function rulesToJson(rules: AuctionRules): Record<string, unknown> {
  return JSON.parse(
    JSON.stringify(rules, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)),
  ) as Record<string, unknown>;
}

const big = (v: unknown) => BigInt(v as string);

/** Stored rules JSON: the same shape with money as decimal strings. */
type RulesJson = Omit<AuctionRules, 'purse' | 'retention' | 'basePriceBands' | 'increments'> & {
  purse: string;
  retention: Omit<AuctionRules['retention'], 'cappedSlabs' | 'uncappedFloor'> & {
    cappedSlabs: string[];
    uncappedFloor: string;
  };
  basePriceBands: string[];
  increments: { below: string | null; step: string }[];
};

export function rulesFromJson(json: Record<string, unknown>): AuctionRules {
  const r = json as unknown as RulesJson;
  return {
    ...r,
    purse: big(r.purse),
    retention: {
      ...r.retention,
      cappedSlabs: r.retention.cappedSlabs.map(big),
      uncappedFloor: big(r.retention.uncappedFloor),
    },
    basePriceBands: r.basePriceBands.map(big),
    increments: r.increments.map((s) => ({
      below: s.below === null ? null : big(s.below),
      step: big(s.step),
    })),
  };
}

/** Canonical JSON (sorted keys) of the rules. */
export function canonicalRules(rules: AuctionRules): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sort)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.keys(v as object)
              .sort()
              .map((k) => [k, sort((v as Record<string, unknown>)[k])]),
          )
        : v;
  return JSON.stringify(sort(rulesToJson(rules)));
}

export const rulesHash = (rules: AuctionRules) => sha256Hex(canonicalRules(rules));
