/**
 * Pure game engines. Inputs (clock, randomness, frozen rules) are always passed
 * explicitly; nothing in this package may read Date.now, Math.random, the
 * environment, the network or the database.
 */
export const ENGINE_VERSIONS = {
  card: 'card-engine-v1',
  auction: 'auction-engine-v1',
  ratings: 'ratings-v1',
  evaluation: 'squad-eval-v1',
  voting: 'vote-v1',
} as const;
