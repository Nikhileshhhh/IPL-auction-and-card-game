import { CARD_METRICS, RARITIES, type Rarity } from '@stumps/contracts';
import { allocateRarityCounts } from '../ratings/catalog';
import type { RandomStream, StreamLabel } from './rng';
import { CardEngineError, type CardInstance, type DealDefinition } from './types';

export interface DealInput {
  /** Every eligible definition of the frozen data version (any order). */
  pool: readonly DealDefinition[];
  /** Participating member IDs in immutable seat order. */
  seats: readonly string[];
  totalCards: number;
  enabledRarities: readonly Rarity[];
  mode: 'stratified' | 'random';
  streams: Record<StreamLabel, RandomStream>;
  /** Instance ID factory (server-provided; IDs carry no game information). */
  newId: () => string;
}

export interface DealResult {
  instances: CardInstance[];
  /** Deck per seat, top first, aligned with `seats`. */
  decks: string[][];
  /** Initial selector (uniform over seats, `seats` stream). */
  selector: string;
  /** Committed fallback permutation (`fallback` stream). */
  fallbackOrder: string[];
}

const MAX_DUALS = 1;

/**
 * Per-rarity counts for a deal (ADR-020): the catalog's own mix among enabled
 * rarities, at most one dual card per match; the excess goes to the rarity with
 * the most definitions. Each definition is dealt at most once; different
 * versions of one player may appear together (product owner).
 */
export function dealCounts(
  total: number,
  enabled: readonly Rarity[],
  available: ReadonlyMap<Rarity, number>,
): Map<Rarity, number> {
  const counts = allocateRarityCounts(total, enabled, available);
  const duals = counts.get('dual_platinum') ?? 0;
  if (duals > MAX_DUALS) {
    counts.set('dual_platinum', MAX_DUALS);
    const target = RARITIES.filter((r) => r !== 'dual_platinum' && enabled.includes(r)).sort(
      (a, b) => (available.get(b) ?? 0) - (available.get(a) ?? 0),
    )[0];
    if (target) counts.set(target, (counts.get(target) ?? 0) + duals - MAX_DUALS);
  }
  return counts;
}

/** Mean of the six ratings (stratification key), exact as numerator over 6. */
const strength = (d: DealDefinition) => CARD_METRICS.reduce((s, m) => s + d.ratings[m], 0);

/**
 * Fair deal (rules §3.4 / §4). Validates before drawing anything:
 * - seats 2–8, total divisible by seats with 4–30 per seat, total ≤ 240;
 * - enough distinct definitions for every rarity (POOL_INSUFFICIENT otherwise).
 *
 * Stratified (default): order the chosen cards by mean rating, split them into
 * four bands of whole rounds (rows × seats), shuffle within each band, rotate the
 * starting seat per band with the `seats` stream and deal round-robin, so every
 * seat receives the same number from every band. Each deck is then shuffled so
 * band order is not visible in deck order. Random mode deals one shuffled pile.
 */
export function dealMatch(input: DealInput): DealResult {
  const { seats, totalCards: total } = input;
  const n = seats.length;
  if (n < 2 || n > 8 || new Set(seats).size !== n)
    throw new CardEngineError('CONFIG_INVALID', 'A card match needs 2–8 distinct seats.');
  if (total > 240 || total % n !== 0 || total / n < 4 || total / n > 30)
    throw new CardEngineError('CONFIG_INVALID', 'Cards must divide evenly: 4–30 per seat.');

  const byRarity = new Map<Rarity, DealDefinition[]>();
  for (const d of [...input.pool].sort((a, b) => a.definitionId.localeCompare(b.definitionId))) {
    if (!input.enabledRarities.includes(d.rarity)) continue;
    byRarity.set(d.rarity, [...(byRarity.get(d.rarity) ?? []), d]);
  }
  const available = new Map([...byRarity].map(([r, list]) => [r, list.length] as const));
  const counts = dealCounts(total, input.enabledRarities, available);
  const short = [...counts].filter(([r, k]) => k > (available.get(r) ?? 0));
  if (short.length || [...counts.values()].reduce((s, k) => s + k, 0) !== total) {
    throw new CardEngineError(
      'POOL_INSUFFICIENT',
      `Not enough cards for this deal: ${short.map(([r, k]) => `${r} ${k}/${available.get(r) ?? 0}`).join(', ')}`,
    );
  }

  // Draw definitions per rarity (enum order), without repeating a definition.
  const chosen: DealDefinition[] = [];
  for (const rarity of RARITIES) {
    const k = counts.get(rarity) ?? 0;
    if (k === 0) continue;
    chosen.push(...input.streams.deal.shuffle(byRarity.get(rarity) ?? []).slice(0, k));
  }

  const decks: DealDefinition[][] = seats.map(() => []);
  if (input.mode === 'stratified') {
    const ordered = [...chosen].sort(
      (a, b) => strength(b) - strength(a) || a.definitionId.localeCompare(b.definitionId),
    );
    // Four bands of whole rounds: rows per band differ by at most one.
    const rounds = total / n;
    const bands = [0, 1, 2, 3].map((i) => Math.floor(rounds / 4) + (i < rounds % 4 ? 1 : 0));
    let cursor = 0;
    for (const band of bands) {
      const size = band * n;
      const cards = input.streams.deal.shuffle(ordered.slice(cursor, cursor + size));
      cursor += size;
      const start = input.streams.seats.uniform(n);
      cards.forEach((card, i) => decks[(start + i) % n]?.push(card));
    }
  } else {
    input.streams.deal.shuffle(chosen).forEach((card, i) => decks[i % n]?.push(card));
  }

  const instances: CardInstance[] = [];
  const deckIds = decks.map((deck) =>
    input.streams.deal.shuffle(deck).map((d) => {
      const instance = { id: input.newId(), definitionId: d.definitionId, ratings: d.ratings };
      instances.push(instance);
      return instance.id;
    }),
  );
  return {
    instances,
    decks: deckIds,
    selector: seats[input.streams.seats.uniform(n)] as string,
    fallbackOrder: input.streams.fallback.shuffle(seats),
  };
}
