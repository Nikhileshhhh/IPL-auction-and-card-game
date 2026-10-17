# Design review (phase 16)

UI spec §8 asks for a review of all 35 screens at the target sizes, with error, reconnecting and empty variations, long names, large amounts and keyboard-only use. This file records what was **measured** and what is **still open**. It is written so that nothing in it claims more than was checked.

- **How to repeat it:** `pnpm test:visual` for layout and axe, `pnpm design:contrast` for token contrast, and `pnpm test:e2e` for the flows.
- **Screenshots:** every screen at every size is attached to the Playwright run for human review. They are not committed, and they are not pixel baselines.

## 1. Contrast of the token pairs in use (measured)
Each pair is measured with the WCAG relative-luminance formula (`packages/ui/src/contrast.ts`). The targets are 4.5:1 for text and 3:1 for non-text controls and focus.

| Use | Pair | Measured | Target | Result |
|---|---|---|---|---|
| text/primary on bg/base | `#F4F7FB` on `#07111F` | 17.62:1 | 4.5:1 | Pass |
| text/secondary on bg/base | `#B5C3D6` on `#07111F` | 10.59:1 | 4.5:1 | Pass |
| text/muted on bg/base | `#91A5C0` on `#07111F` | 7.53:1 | 4.5:1 | Pass |
| status/success text on bg/base | `#72DDA7` on `#07111F` | 11.38:1 | 4.5:1 | Pass |
| status/warning text on bg/base | `#FFD280` on `#07111F` | 13.33:1 | 4.5:1 | Pass |
| status/error text on bg/base | `#FF9EA5` on `#07111F` | 9.64:1 | 4.5:1 | Pass |
| accent/card text on bg/base | `#44E0B1` on `#07111F` | 11.31:1 | 4.5:1 | Pass |
| accent/auction text on bg/base | `#F0C879` on `#07111F` | 11.94:1 | 4.5:1 | Pass |
| focus ring on bg/base | `#7DBAFF` on `#07111F` | 9.32:1 | 3:1 | Pass |
| control border on bg/base | `#64809F` on `#07111F` | 4.63:1 | 3:1 | Pass |
| text/primary on bg/raised | `#F4F7FB` on `#101E30` | 15.63:1 | 4.5:1 | Pass |
| text/secondary on bg/raised | `#B5C3D6` on `#101E30` | 9.39:1 | 4.5:1 | Pass |
| text/muted on bg/raised | `#91A5C0` on `#101E30` | 6.68:1 | 4.5:1 | Pass |
| status/success text on bg/raised | `#72DDA7` on `#101E30` | 10.09:1 | 4.5:1 | Pass |
| status/warning text on bg/raised | `#FFD280` on `#101E30` | 11.82:1 | 4.5:1 | Pass |
| status/error text on bg/raised | `#FF9EA5` on `#101E30` | 8.55:1 | 4.5:1 | Pass |
| accent/card text on bg/raised | `#44E0B1` on `#101E30` | 10.03:1 | 4.5:1 | Pass |
| accent/auction text on bg/raised | `#F0C879` on `#101E30` | 10.59:1 | 4.5:1 | Pass |
| focus ring on bg/raised | `#7DBAFF` on `#101E30` | 8.27:1 | 3:1 | Pass |
| control border on bg/raised | `#64809F` on `#101E30` | 4.10:1 | 3:1 | Pass |
| text/primary on bg/overlay | `#F4F7FB` on `#172941` | 13.67:1 | 4.5:1 | Pass |
| text/secondary on bg/overlay | `#B5C3D6` on `#172941` | 8.21:1 | 4.5:1 | Pass |
| text/muted on bg/overlay | `#91A5C0` on `#172941` | 5.84:1 | 4.5:1 | Pass |
| status/success text on bg/overlay | `#72DDA7` on `#172941` | 8.82:1 | 4.5:1 | Pass |
| status/warning text on bg/overlay | `#FFD280` on `#172941` | 10.34:1 | 4.5:1 | Pass |
| status/error text on bg/overlay | `#FF9EA5` on `#172941` | 7.47:1 | 4.5:1 | Pass |
| accent/card text on bg/overlay | `#44E0B1` on `#172941` | 8.77:1 | 4.5:1 | Pass |
| accent/auction text on bg/overlay | `#F0C879` on `#172941` | 9.26:1 | 4.5:1 | Pass |
| focus ring on bg/overlay | `#7DBAFF` on `#172941` | 7.23:1 | 3:1 | Pass |
| control border on bg/overlay | `#64809F` on `#172941` | 3.59:1 | 3:1 | Pass |
| midnight text on accent/card button | `#07111F` on `#44E0B1` | 11.31:1 | 4.5:1 | Pass |
| midnight text on accent/auction button | `#07111F` on `#F0C879` | 11.94:1 | 4.5:1 | Pass |
| rarity/normal edge on bg/base | `#9AAFC4` on `#07111F` | 8.39:1 | 3:1 | Pass |
| rarity/bronze edge on bg/base | `#CF9466` on `#07111F` | 7.29:1 | 3:1 | Pass |
| rarity/silver edge on bg/base | `#D6E1ED` on `#07111F` | 14.29:1 | 3:1 | Pass |
| rarity/gold edge on bg/base | `#EBC875` on `#07111F` | 11.77:1 | 3:1 | Pass |
| rarity/platinum edge on bg/base | `#BCE5F1` on `#07111F` | 14.08:1 | 3:1 | Pass |
| rarity/dual edge on bg/base | `#CBB9FF` on `#07111F` | 10.75:1 | 3:1 | Pass |

## 2. Viewport matrix (automated)
`tests/visual/screens.spec.ts` opens each screen at the sizes below. At every size it checks:
- no horizontal page scroll (wide tables scroll inside a labelled region);
- an `h1`;
- control text of at least 14 px;
- buttons and links at least 44 px tall and 24 px wide (inline links inside a sentence are exempt, per WCAG 2.5.8);
- axe with no serious or critical violations, run at 360×800 and 1440×900.

| Size | Why |
|---|---|
| 360×800, 390×844 | Phones |
| 768×1024 | Tablet portrait |
| 1024×768 | Tablet landscape; the narrowest wide layout |
| 1440×900 | Desktop |
| 320×640 | Reflow (WCAG 1.4.10: 1280 px at 400%) |
| 720×450 | 200% zoom of a 1440×900 window |

| Screens swept | Route |
|---|---|
| S04 dashboard | `/play` |
| S05 / S06 card create and join | `/play/cards/create`, `/play/cards/join` |
| Card collection | `/play/cards/collection` |
| S07 card lobby | `/rooms/:id/lobby` (long room name) |
| S14 / S15 auction create and join | `/play/auction/create`, `/play/auction/join` |
| S29 profile, S30 friends, S31 notifications | `/players/:u`, `/friends`, `/notifications` |
| S35 status | `/status` |
| S33 operations, access, users, announcements, cleanup | `/admin`, `/admin/access`, `/admin/users`, `/admin/announcements`, `/admin/cleanup` |
| S34 catalog | `/admin/catalog` |
| Edge-case gallery | `/admin/design-review` |

The in-game screens run inside their E2E flows instead, because they need live rooms. The desktop and 360 px projects run axe and the no-horizontal-scroll check on:
- S01–S03;
- S08–S13 (card match and voting);
- S16–S20 and S22 (auction setup and stage);
- S24–S25 (chat);
- S27–S28 (voting and results).

**Results (17 Oct 2026):** every swept screen passes at every size. The first runs found 23 problems, all fixed:
- undersized targets on "Invite friends", the rules source link and the catalog version rows;
- 1030 px admin pages at 1024 px;
- a 599 px catalog on phones, caused by an absolutely positioned `th.sr-only` escaping an unpositioned scroller;
- gallery cards at 320 px reflow.

## 3. Edge cases (`/admin/design-review`)
The gallery uses fixed fixtures and original artwork only:
- the six rarities and the dual frame, at standard and mini size;
- names up to 56 characters, and a dual card with two long names;
- ratings of 0, 100 and Sachin's 101;
- a portrait that fails to load, which must fall back to the silhouette with "(photo not available)" in its alt text;
- rupee amounts from ₹0 to ₹99,99,99,99,999, with the exact amount beside the short form;
- zero cards, a full pot (tie 12 of 12) and a waiting-player label;
- a full 25-player squad with long names, overseas tags, unknown and uncapped status, the not-registered price label and a broken portrait.

## 4. Motion, sound and data (automated)
- **Motion:**
  - The device setting is honoured unless the member overrides it.
  - "Reduce motion" stops the shine on a device that asks for full motion.
  - "Full motion" keeps it on a device that asks for less.
- **Low data:** static frames and 320 px portraits.
- **Sound:**
  - off by default and silent before a gesture;
  - each event key plays at most once, and an event that passed while muted never plays later;
  - the state on screen at mount never plays;
  - every cue is under 1.2 s at a gain of 0.15 or below.

  These are covered by unit tests in `apps/web/test/preferences-audio.spec.ts`.
- **Podium:** the ceremony is at most 1.8 s, skippable, instant with reduced motion and shown once per session. It never covers or delays the controls.

## 5. Network, images and caching (automated)
- **Portraits:** served with `Cache-Control: private` as `image/webp`, and refused without a member session.
- **Slow network:** on a slow link (400 ms latency, 400 kbit/s), the primary action on `/play/cards/create` does not move between first paint and network idle.
- **Transfer budget:** the dashboard's initial transfer, cold cache, measured 360,355 bytes against the §7 budget of 1.5 MB. This is a local production build without a CDN; deployed numbers come in phase 18–19.

## 6. Still open (not certified)
- **Screen readers:** no manual pass with VoiceOver, TalkBack or NVDA. Automated axe checks do not certify compliance (spec §8).
- **Keyboard-only:** no complete keyboard-only playthrough of both games. Focus order and traps were exercised only where the E2E tests use the keyboard (dialogs, forms).
- **iOS safe area and on-screen keyboard:** not checked on a real device. The bottom rails (bid controls, lobby actions), the vote banner and bottom-sheet dialogs pad by `env(safe-area-inset-bottom)` under `viewport-fit=cover`, but no device was available here.
- **60 collaborators:** a 60-collaborator auction view was not rendered, because the load harness is phase 17.
- **Hidden cards:** the arena DOM is not checked for hidden deck identities. The snapshot and event tests (phases 07–08) prove the server never sends them, so no animation can reveal them.
