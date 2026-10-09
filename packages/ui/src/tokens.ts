/** Design tokens from UI/UX spec §2. CSS variables live in tokens.css. */
export const colors = {
  bgBase: '#07111F',
  bgRaised: '#101E30',
  bgOverlay: '#172941',
  textPrimary: '#F4F7FB',
  textSecondary: '#B5C3D6',
  textMuted: '#91A5C0',
  lineDefault: '#334B66',
  /** Interactive control boundaries (WCAG 1.4.11 needs 3:1); separators keep lineDefault. */
  lineControl: '#64809F',
  accentCard: '#44E0B1',
  accentAuction: '#F0C879',
  accentFocus: '#7DBAFF',
  statusSuccess: '#72DDA7',
  statusWarning: '#FFD280',
  statusError: '#FF9EA5',
} as const;

export const rarityColors = {
  normal: '#9AAFC4',
  bronze: '#CF9466',
  silver: '#D6E1ED',
  gold: '#EBC875',
  platinum: '#BCE5F1',
  dual: '#CBB9FF',
} as const;

export const spacing = [4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 96] as const;

export const radius = {
  control: 8,
  smallPanel: 12,
  majorPanel: 20,
  featureTile: 24,
  cardArt: 16,
} as const;

export const breakpoints = { medium: 640, wide: 1024, veryWide: 1440 } as const;

export const motionMs = {
  feedbackMin: 80,
  feedbackMax: 120,
  panelMin: 160,
  panelMax: 220,
  cardFlip: 360,
  resultReveal: 700,
  podiumMax: 1800,
  reducedCrossfadeMax: 100,
} as const;

export const cardSizes = {
  compact: { width: 240, height: 336 },
  standard: { width: 320, height: 448 },
  detail: { width: 520, height: 728 },
} as const;
