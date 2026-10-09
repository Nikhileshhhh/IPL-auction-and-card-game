/**
 * Feature flags for incomplete game entry points (CODEX shared contract:
 * "Feature-flag incomplete game entry points; never fake success").
 * Each flag flips only in the phase that makes the flow genuinely work.
 */
export const FEATURES = {
  accessGate: true,
  dashboard: true,
  cardBattle: false,
  megaAuction: false,
  social: false,
  admin: true,
} as const;

export type FeatureName = keyof typeof FEATURES;

export const FEATURE_PHASE: Record<FeatureName, string> = {
  accessGate: '03',
  dashboard: '04',
  cardBattle: '07',
  megaAuction: '10',
  social: '13',
  admin: '03',
};
