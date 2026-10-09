# Visual and accessibility checklist

Applied to every screen as it ships (UI spec §4, §8). Automated checks run in `tests/e2e`; manual screen-reader review remains a release gate (phase 16/17).

## Automated per screen
- [x] axe WCAG 2.0/2.1/2.2 A+AA: zero serious/critical violations (`expectNoSeriousA11yViolations`).
- [x] No horizontal page scroll at 1440×900, 768×1024, 390×844, 360×800, 320 px reflow and ~200% zoom (640×400 CSS px).
- [x] Screenshots captured as test artifacts (`test-results/**/dashboard-*.png`).
- [x] Token contrast measured in `packages/ui/test/contrast.spec.ts`.

## Measured token decisions
| Pair | Ratio | Result |
|---|---|---|
| text/primary, secondary, muted on base/raised/overlay | ≥ 4.5:1 | pass |
| midnight text on accent/card and accent/auction | ≥ 4.5:1 | pass |
| status colours on all surfaces | ≥ 4.5:1 | pass |
| `line/default #334B66` on base | 2.11:1 | **decorative separators only** |
| `line/control #64809F` (added) on base/raised/overlay | 4.63 / 4.10 / 3.59 | pass for control boundaries (WCAG 1.4.11) |

`line/control` is an additive token: inputs, outlined buttons and radio cards use it because the spec's separator colour cannot identify a control boundary at 3:1.

## Manual review items (per screen, before release)
- Keyboard-only completion; visible 2 px focus ring + 2 px offset; no hover-only actions.
- 44 px minimum targets (48 normal, 56 key bid/action).
- Status never colour-only (medal labels, connection banner text, badges).
- Reduced motion: no transforms on hover/reveal when `prefers-reduced-motion`.
- Long names, large rupee amounts, zero states, error and offline states.
