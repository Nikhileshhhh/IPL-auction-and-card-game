# Phase 16 report — Premium polish, accessibility and performance UX

**Date:** 2026-10-17 · **Result:** complete, with the gaps listed at the end.

What changed for players and operators:
- **Members choose how the game feels.**
  - **Motion:** follow the device, reduce, or full.
  - **Sound effects:** quiet original tones, off by default.
  - **Low data:** smaller portraits and static frames.

  The choice follows them across devices and never changes what happens in a match.
- **Sound never repeats or surprises.** It plays only after the member turns it on and has interacted with the page, at most once per server event. It never replays old events after a refresh, and every sound duplicates something already on screen.
- **Results get a podium ceremony.** Bronze, silver and gold rise within 1.8 s. The ceremony can be skipped, is instant with reduced motion, plays once per session and never covers the controls.
- **The auction stage looks like a broadcast at wide sizes.** Franchises sit in a rail on the left, the lot in the middle and lot activity on the right. A "Player details" view (S21) shows each player's ratings, career totals and source.
- **Operators get a real dashboard (S33).** It shows measured health, rooms by state, a room table and recent actions. Operators can also suspend or reinstate members (with a fresh authenticator code) and post announcements. None of it shows room names, chat, cards or results.
- **The status page is real (S35).** It probes the service and says Ready, Degraded or Unreachable with the time it checked.
- **Visual review is a test suite.** Every reachable screen is checked at five device sizes, at 320 px reflow and at 200% zoom, for scrolling, target sizes, text size and axe accessibility.

Decisions are recorded in ADR-031. The measured results and the open items are in `docs/design-review.md`.

## Migration
- **`130_ui_preferences`:** `ui_preferences`, keyed by user. It holds `motion` (`system`, `reduce` or `full`), `sound_effects` and `low_data`. The table has FORCE RLS, a backend policy and grants, and cascades with the profile.
- **Bookkeeping:** `REQUIRED_MIGRATION` is now `130_ui_preferences`, with a manifest row and a retention row (P).
- **Applied to:** `stumps_check` (reset) and the dev `stumps` database (pending migrations only).

## Changed paths
- **Contracts:**
  - `packages/contracts/src/operations.ts`: `UiPreferences` and its patch, `AdminOverview`, `AdminRooms`, `AdminUser`, `AdminRestriction`, `AnnouncementCreate`.
  - `auction-live.ts`: `AuctionPlayerDetail`.
  - **HTTP catalog:**
    - added `GET`/`PATCH /v1/me/preferences`, `GET /v1/admin/users`, `POST /v1/admin/announcements/:id/archive` and `GET /v1/rooms/:id/players/:playerId`;
    - the admin catalog paths now name the served routes (see "Contract correction" below).
  - DTO catalog entries added for the new read models.
- **Server:**
  - `modules/preferences`.
  - `modules/admin/operations.ts`: the overview, rooms, user lookup, restrictions with session revocation, and announcements.
  - `modules/auctions/player-detail.ts`, with `playerStatistics` and `versionSource` extracted from `cricket-data/read.ts`.
  - Routes in `routes/v1/{profiles,admin,rooms}.ts`.
  - `realtime/gateway.ts`: sockets close on `user.suspended`.
- **Web:**
  - **Preferences and sound:**
    - `features/preferences/{store,PreferencesBoot,PreferencesPanel,SoundToggle}`;
    - `features/audio/{sfx,useCue}`;
    - cues in the round banner, the stage (`AuctionCues`), the vote and the podium.
  - **Results:** `features/results/Podium.tsx`.
  - **Auction stage:**
    - `features/auction/stage/PlayerDetail.tsx`, with the S21 `?player=` URL;
    - the televised three-column grid;
    - the rail's stats switch to two columns in the 240 px rail.
  - **Admin:**
    - `components/admin/{OperationsOverview,UserRestrictions,AnnouncementsAdmin,DesignReview,useStepUp}`;
    - pages `/admin`, `/admin/access` (moved), `/admin/users`, `/admin/announcements` and `/admin/design-review`;
    - nav links for the new pages.
  - `/status` probe page.
  - **CSS:** reduced-motion and low-data rules driven by `data-motion` and `data-low-data`, and the podium keyframes.
  - **Images:** low-data portraits ask for the 320 px variant (`components/cards/portrait-src.ts`).
- **Polish fixes found by the new suite:**
  - **Touch targets** of at least 44 px for "Invite friends", the rules source link and the catalog version buttons.
  - **Tabs:** the catalog tabs wrap.
  - **Admin layout:** the admin `main` gets `min-w-0`, which fixed a 1030 px page at 1024 px.
  - **Cards:** the design-review gallery shows compact (240 px) cards below 640 px, which fixed reflow at 320 px. The fixed 300 px standard card stays; a `min(300px, 100%)` attempt collapsed portraits inside shrink-to-fit arena rows, which the E2E caught.
  - **Scrollers are positioned** (`relative`), so absolutely positioned screen-reader labels cannot widen the page. A `th.sr-only` had made the catalog 599 px wide on phones.
  - **Long names:** player names wrap to two lines instead of being truncated.
  - **Safe area:** bottom padding for the bid rail, the lobby action bar, the vote banner and bottom-sheet dialogs.
- **Tests:**
  - `tests/visual/screens.spec.ts`, run by `pnpm test:visual` as a new Playwright project;
  - `tests/integration/operations.spec.ts` (5);
  - `tests/security/admin-scope.spec.ts` (2, E69);
  - `apps/web/test/preferences-audio.spec.ts` (6);
  - `tests/e2e/admin.spec.ts`, updated for the overview and the moved access page.
- **Tooling:** `scripts/design/contrast-report.ts`, run by `pnpm design:contrast`.
- **Docs:**
  - ADR-031;
  - `docs/design-review.md`;
  - screens S13, S21, S27, S29, S33 and S35;
  - traceability RQ-09, RQ-27, RQ-28 and E69;
  - the migration manifest;
  - AGENTS commands.

## Contract correction
The new admin-scope test compares the catalogued admin writes with the routes the server registers. Two catalogued paths had never been served, and one served route was missing from the catalog:

| Catalogued path (never served) | Path the server serves |
|---|---|
| `PATCH /v1/admin/catalog/:kind/:id` | `PATCH /v1/admin/catalog/players/:id` |
| `POST /v1/admin/catalog/:kind/:id/archive` | `POST /v1/admin/catalog/versions/:id/archive` |
| (missing) | `POST /v1/admin/catalog/player-sheet` |

These paths come from the phase 06 follow-up. The catalog now lists the served paths, and `changesFromSpec` records the difference from the spec.

`POST /v1/rooms/:id/assets/:assetId/read-url` is still catalogued and not served; that is the known phase-15 gap.

## Checks actually run (local PostgreSQL 16)
| Check | Result |
|---|---|
| `pnpm lint` | ✅ The first run failed: the contrast script used `console.log` (the lint rule allows only `warn` and `error`), and one file was unformatted. Both were fixed and the re-run passed. |
| `pnpm typecheck` | ✅ |
| `pnpm contracts:check` | ✅ 32 commands, 54 events, 67 error codes, 95 HTTP operations |
| `pnpm test:unit` | ✅ 240 |
| `STUMPS_DB_NAME=stumps_check pnpm db:reset` / `db:lint` | ✅ 20 migrations / 75 tables |
| `pnpm test:integration` | ✅ 152 |
| `pnpm test:security` | ✅ 48 |
| `pnpm test:concurrency` | ✅ 15 |
| `pnpm build` | ✅ |
| `pnpm test:e2e` (desktop + 360 px) | ✅ 41 passed, 9 skipped (two-context flows run once). The first run failed one test: a `min(300px, 100%)` card width collapsed revealed-card portraits in the arena. The change was reverted and the re-run passed. |
| `pnpm test:visual` | ✅ 5 passed on the final run (18 screens × 7 sizes). The earlier runs found 23 layout issues (undersized targets, horizontal scroll), all fixed (see "Polish fixes"). They also found two mistakes in the tests themselves: an expected Indian-grouped amount, and a fallback locator that picked the copy hidden at that size. |
| `pnpm design:contrast` | ✅ 38 token pairs, all at or above target |

## Verified behaviour
- **Preferences:**
  - A new member gets the defaults.
  - A partial patch keeps the other fields.
  - Empty, unknown and mistyped patches get 400.
  - One member's choice never affects another's.
  - Signed-out callers are refused.
- **Motion and low data (browser):**
  - "Reduce motion" stops the card shine on a device that wants full motion.
  - "Full motion" keeps it on a device that asks for less.
  - Low data shows 320 px portraits and static frames.
- **Sound (unit):**
  - Each event key plays once.
  - A muted event never plays later.
  - Nothing plays before a gesture.
  - The memory is bounded.
  - Every cue is under 1.2 s at a gain of 0.15 or below.
- **Operations:**
  - The overview reports the database, schema `130_ui_preferences` and room counts.
  - The room table shows the auction room as RUNNING with 2 members.
  - Neither view contains the room name or any member's name.
  - Member sessions are refused (status 401 or higher).
- **Restrictions:**
  - **Lookup:** exact and case-insensitive, never returning an email. An unknown username gets 404; a malformed one gets 400.
  - **Step-up:** without a step-up in the last 5 minutes, both a suspension and an integrity abort get `STEP_UP_REQUIRED`, and the room stays RUNNING. This closes the phase-15 gap on step-up for abort.
  - **Effect:** a suspension ends the member's session at once.
  - **Refused:** past times, more than a year, short reasons, restricting yourself and restricting another administrator.
  - **Audit:** it records `user.suspend` and `user.unsuspend`, never the reason text.
- **Announcements:**
  - Members see them during their window, returned verbatim (markup stays text).
  - A backwards window is refused.
  - Members cannot create announcements.
  - Archiving hides one at once; archiving it twice gets 404.
- **S21:**
  - A member gets the frozen lot player (equal to the live lot's player), its pool status, ratings and source.
  - Outsiders and unknown players get 404.
- **E69:**
  - The admin write surface equals an explicit allow-list, and every entry is served.
  - No outcome-shaped admin route exists for results, winner, achievements, bids, commands or medals.
  - An admin session cannot read or command a room.
  - An integrity abort leaves no receipts and no results.
- **Visual review (`pnpm test:visual`):**
  - **Layout:** 11 member screens and 7 admin screens pass at 360×800, 390×844, 768×1024, 1024×768, 1440×900, 320 px reflow and 200% zoom. None scrolls sideways, each has an `h1`, control text is at least 14 px and targets at least 44 px.
  - **Accessibility:** axe finds no serious or critical violations at 360 and 1440 px.
  - **Edge cases:** the design-review gallery shows the image-error fallback and the full Indian-grouped amount.
  - **Cold dashboard load:** 360,355 bytes measured, against a 1.5 MB budget.
  - **Network and caching:** portraits come back as `private` `image/webp` and are refused without a session, and the primary action does not move on a slow network.

## Gaps and notes
- **Not certified:** no manual screen-reader pass, no full keyboard-only playthrough, and no real-device check of the iOS safe area and on-screen keyboard. A 60-collaborator view is not rendered (the load harness is phase 17). The details are in `docs/design-review.md` §6.
- **In-game screens:** S08–S13 and S16–S28 are reviewed inside their E2E flows at 1440 and 360 px (axe and no horizontal scroll). They are not swept at all seven sizes, because they need live rooms.
- **S21 compare picker:** not built. The detail shows one player.
- **Activity column at 1024–1279 px:** the spec's "activity in a drawer" is shown under the stage instead.
- **Animation library:** `motion` is still unused. CSS covers every animation, and pot travel is a count change.
- **Suspension across instances:** sockets close on the same instance only. Other instances refuse them at the next ticket or room join.
- **Phase 15 carry-over:** `POST /rooms/:id/assets/:assetId/read-url` is still not built.
