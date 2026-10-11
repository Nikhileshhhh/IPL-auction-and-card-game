/**
 * Pure game engines. Inputs (clock, randomness, frozen rules) are always passed
 * explicitly; nothing in this package may read Date.now, Math.random, the
 * environment, the network or the database.
 */
export const ENGINE_VERSIONS = {
  card: 'card-engine-v1',
  auction: 'auction-engine-v1',
  ratings: 'ratings-career-v2',
  evaluation: 'squad-eval-v1',
  voting: 'vote-v1',
} as const;

export * from './cricket/cricsheet';
export * from './cricket/aggregate';
export * from './ratings/rational';
export * from './ratings/v1';
export * from './ratings/career';
export * from './ratings/catalog';
export * from './demo/league';
export * from './card';
