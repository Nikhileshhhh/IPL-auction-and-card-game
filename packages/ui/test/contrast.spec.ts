import { describe, expect, it } from 'vitest';
import { colors, rarityColors } from '../src/tokens';
import { contrastRatio } from '../src/contrast';

/**
 * Measured token pairs (UI spec §4: measure, do not assume). Normal text needs
 * 4.5:1; large text and non-text UI need 3:1.
 */
describe('design token contrast (WCAG 2.2 AA)', () => {
  const surfaces = { base: colors.bgBase, raised: colors.bgRaised, overlay: colors.bgOverlay };

  it.each(Object.entries(surfaces))('primary and secondary text meet 4.5:1 on %s', (_name, bg) => {
    expect(contrastRatio(colors.textPrimary, bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.textSecondary, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(Object.entries(surfaces))('muted text meets 4.5:1 on %s', (_name, bg) => {
    expect(contrastRatio(colors.textMuted, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('accent buttons use midnight text that meets 4.5:1', () => {
    expect(contrastRatio(colors.bgBase, colors.accentCard)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.bgBase, colors.accentAuction)).toBeGreaterThanOrEqual(4.5);
  });

  it('status colours are readable as text on every surface', () => {
    for (const bg of Object.values(surfaces)) {
      for (const fg of [colors.statusSuccess, colors.statusWarning, colors.statusError]) {
        expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('focus ring and borders are visible non-text indicators (3:1 against the page)', () => {
    expect(contrastRatio(colors.accentFocus, colors.bgBase)).toBeGreaterThanOrEqual(3);
    for (const bg of Object.values(surfaces)) {
      expect(contrastRatio(colors.lineControl, bg)).toBeGreaterThanOrEqual(3);
    }
    for (const rarity of Object.values(rarityColors)) {
      expect(contrastRatio(rarity, colors.bgRaised)).toBeGreaterThanOrEqual(3);
    }
  });
});
