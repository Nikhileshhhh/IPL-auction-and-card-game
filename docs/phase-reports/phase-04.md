# Phase 04 report — Design system and dashboard

**Date:** 2026-10-09 · **Result:** complete.

## Changed paths
- `packages/ui`: `primitives/{dialog,surface,medal}.tsx` (Radix dialog with focus trap/restore, Surface, Skeleton, Badge, text-labelled MedalBadge), `contrast.ts`, `line/control` token, `test/contrast.spec.ts`.
- `apps/server`: `modules/profiles/summary.ts`; `GET /v1/me/summary`, `GET /v1/announcements` (private, no-store).
- `packages/contracts/src/profile.ts` (MemberSummary, Announcement DTOs).
- `apps/web`: self-hosted OFL fonts (Inter variable, Barlow Condensed), `components/game-selection/{GameSelectionCard,GameHub,art}.tsx` (original SVG art), `components/dashboard/*`, `components/shell/ConnectionBoundary.tsx`, `(member)/play` dashboard (S04), `/play/cards` and `/play/auction` hubs, `/players/[username]` own-profile shell (S29 base).
- Docs: `docs/visual-checklist.md`, `docs/licenses/third-party-assets.md`.

## Behavior
Dashboard greets the member, shows both game tiles (whole-tile semantic links, ≤4 px hover lift, reduced-motion safe), announcements (plain text), receipt-derived medal counters with an explicit zero state, and friend counts. Hubs explain each game; create/join actions stay disabled with a stated reason until rooms ship (phase 05). The connection boundary shows a persistent text banner when offline and a polite recovery notice.

## Checks actually run
| Command | Result |
|---|---|
| `pnpm lint` | pass |
| `pnpm typecheck` | pass |
| `pnpm contracts:check` | pass (71 HTTP operations) |
| `pnpm test:unit` | pass (51 tests incl. token contrast) |
| `pnpm build` | pass |
| `pnpm db:reset` / `pnpm db:lint` | pass |
| `pnpm test:integration` | pass (39 tests incl. dashboard summary/announcements) |
| `pnpm test:e2e` | pass — 29 tests (+1 desktop-only matrix skipped on mobile) |

## Security / failure cases verified
No fabricated achievements (counters only from summary/receipts; profile endpoint rejects counter fields); announcements are text nodes (script payload rendered inert); private-route redirect without credentials; stale gate (revoked grants) redirects to `/access`; no remote image patterns allowed; no assets in public buckets (only original SVG inline art).

## Known gaps
- Room create/join flows are phase 05; tiles navigate to real hubs whose actions are disabled with a reason.
- Manual screen-reader review not yet performed (release gate).

## Next phase
Phase 05 — Rooms, realtime and durable infrastructure.
