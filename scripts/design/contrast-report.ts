/**
 * Measured WCAG contrast for the design-token pairs the UI actually uses
 * (UI spec §4: "actual token pairs must be measured, not assumed"). Prints a
 * Markdown table for docs/design-review.md and exits non-zero if a pair
 * misses its target.
 */
import { contrastRatio } from '../../packages/ui/src/contrast';
import { colors, rarityColors } from '../../packages/ui/src/tokens';

type Pair = [use: string, fg: string, bg: string, target: number];

const surfaces = {
  'bg/base': colors.bgBase,
  'bg/raised': colors.bgRaised,
  'bg/overlay': colors.bgOverlay,
};
const pairs: Pair[] = [];
for (const [name, bg] of Object.entries(surfaces)) {
  pairs.push([`text/primary on ${name}`, colors.textPrimary, bg, 4.5]);
  pairs.push([`text/secondary on ${name}`, colors.textSecondary, bg, 4.5]);
  pairs.push([`text/muted on ${name}`, colors.textMuted, bg, 4.5]);
  pairs.push([`status/success text on ${name}`, colors.statusSuccess, bg, 4.5]);
  pairs.push([`status/warning text on ${name}`, colors.statusWarning, bg, 4.5]);
  pairs.push([`status/error text on ${name}`, colors.statusError, bg, 4.5]);
  pairs.push([`accent/card text on ${name}`, colors.accentCard, bg, 4.5]);
  pairs.push([`accent/auction text on ${name}`, colors.accentAuction, bg, 4.5]);
  pairs.push([`focus ring on ${name}`, colors.accentFocus, bg, 3]);
  pairs.push([`control border on ${name}`, colors.lineControl, bg, 3]);
}
pairs.push(['midnight text on accent/card button', colors.bgBase, colors.accentCard, 4.5]);
pairs.push(['midnight text on accent/auction button', colors.bgBase, colors.accentAuction, 4.5]);
for (const [name, c] of Object.entries(rarityColors)) {
  pairs.push([`rarity/${name} edge on bg/base`, c, colors.bgBase, 3]);
}

let failed = 0;
const rows = pairs.map(([use, fg, bg, target]) => {
  const ratio = contrastRatio(fg, bg);
  const ok = ratio >= target;
  if (!ok) failed += 1;
  return `| ${use} | \`${fg}\` on \`${bg}\` | ${ratio.toFixed(2)}:1 | ${target}:1 | ${ok ? 'Pass' : 'FAIL'} |`;
});
process.stdout.write(
  ['| Use | Pair | Measured | Target | Result |', '|---|---|---|---|---|', ...rows].join('\n') +
    '\n',
);
if (failed) {
  console.error(`${failed} pair(s) below target`);
  process.exit(1);
}
