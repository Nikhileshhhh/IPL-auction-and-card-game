# Phase 07 report — Authoritative card engine and arena

**Date:** 2026-10-11 · **Result:** complete. A card match now runs from the lobby to final standings with the server as sole authority. Ties are playable now; their full edge-case coverage, the S11 screen and full restoration are phase 08. Medals, voting and the results TTL remain phases 14–15. Decisions: ADR-021, and ADR-020 with its amendment (legend versions 92/96/100, repeats).

## Migration
- **`050_card_engine`:** card_games, card_seats, card_comparisons, card_instances, card_contributions and card_cycle_counts. All are class T and cascade from the room.
  - **Instance locations:** `card_instances` is the single location authority. A row CHECK enforces the shape of DECK, ACTIVE and POT.
  - **Deck positions:** a deferrable unique constraint `one_deck_position`.
  - **Conservation:** a deferred constraint trigger checks at commit that each room still has `total_cards` instances.
  - **References and policy:** same-room composite FKs with FK indexes; FORCE RLS plus the backend policy and grants.
  - `REQUIRED_MIGRATION` is now `050_card_engine`. All six tables are listed in `docs/migration-manifest.md`.

## Changed paths
- **Engine:** `packages/game-engines/src/card/`, which is pure and IO-free.
  - `sha256.ts`: SHA-256 and HMAC in TypeScript.
  - `rng.ts`: `hmac-sha256-ctr-v1`, the commitment and the streams.
  - `deal.ts`: per-rarity counts, at most one dual, stratified and random deals.
  - `reduce.ts`: contest, tie, sole contributor, fallback, tie cap, elimination after award, cycle and contest guards, and the time-limit restore.
  - `invariants.ts` and `types.ts`.
- **Server:** `apps/server/src/modules/cards/`:
  - `starter.ts`: seed and commitment, deal, first comparison, match-limit job.
  - `store.ts`: rows ↔ engine state, writing only the differences.
  - `apply.ts`: engine events → public events, plus the terminal state.
  - `commands.ts`, `deadlines.ts`, `projection.ts` and `index.ts`, registered in `createRoomRuntime`.
- **Server fixes:**
  - `rooms/room-tx.ts`: events from settled due work carry the version their transition produced.
  - `cricket-data/read.ts`: `currentVersion`, `dealPool` and `cardsByDefinition` accept a pool or a transaction.
- **Contracts:**
  - `packages/contracts/src/cards.ts`: command payloads and acks, `ArenaCardSchema`, `PermittedCardSnapshotSchema`, and card event payloads (`CARD_EVENT_PAYLOADS`).
  - `schema/{events,commands,dto-catalog}.json`: aligned with these schemas.
  - `scripts/verify-contracts`: now compares those schemas field by field.
- **Web:** `apps/web/features/cards/arena/`:
  - `CardArena` (S09) with `ArenaTable` (deck counts, revealed cards and mobile opponent tabs) and `CategoryControls`;
  - `ComparisonSheet` (S10), `RoundWinnerReveal` (S12), `MatchResult`, `PreparationView` (S08);
  - `model.ts` and `useServerClock.ts`.
- **Web pages and wiring:**
  - Pages `/rooms/[id]/preparing` and `/rooms/[id]/cards`.
  - The lobby redirects once a card match starts.
  - The `cardBattle` flag is on.
- **Tests:**
  - `packages/game-engines/test/card.spec.ts` (19)
  - `tests/property/card-conservation.spec.ts` (fast-check, 60 runs, 2–8 seats)
  - `apps/web/test/card-arena.spec.ts` (5)
  - `tests/integration/cards.spec.ts` (6)
  - `tests/concurrency/cards.spec.ts` (2)
  - `tests/e2e/card-match.spec.ts` (two browsers, the guest at 360 px)
  - `tests/support/cards.ts`
  - `tests/unit/dependency-boundaries.spec.ts`: engines may not create randomness.
  - Updated: `tests/integration/rooms.spec.ts` (no published pack → `POOL_INSUFFICIENT`) and `tests/e2e/rooms.spec.ts`.
- **Docs:** ADR-021, this report, traceability RQ-10–13, and `docs/screens.md`.

## Checks actually run (local PostgreSQL 16)
| Command | Result |
|---|---|
| `pnpm lint` | pass |
| `pnpm typecheck` | pass |
| `pnpm contracts:check` | pass (30 commands, 53 events, 67 error codes, 84 HTTP operations; card schemas field by field) |
| `pnpm test:unit` | pass (149) |
| `pnpm build` | pass (new routes `/rooms/[id]/preparing` and `/rooms/[id]/cards`) |
| `STUMPS_DB_NAME=stumps_check pnpm db:reset` / `db:lint` | pass (9 migrations; 52 app_private tables) |
| `pnpm test:integration` | pass (81) |
| `pnpm test:security` | pass (43) |
| `pnpm test:concurrency` | pass (9) |
| `pnpm test:e2e` | pass (37; 5 desktop-only flows skipped on mobile) |

## Verified behaviour
- **Deal:** 8 cards to 2 players gives 4 each, and the top cards are revealed. Every revealed card carries its player photo (integration and E2E).
- **Fairness:**
  - The commitment is published at start.
  - Neither the snapshot nor any public event contains an undealt instance ID or the seed.
  - After completion, the disclosed seed recomputes the commitment.
- **Refusals:**
  - Non-selector → `SELECTOR_ONLY` (403).
  - Unknown comparison → `STALE_COMPARISON` (409).
  - Old version → `VERSION_CONFLICT` (409).
  - Unknown metric → 400.
  - A retried command ID returns the stored reply with exactly one transition.
- **Deadlines:**
  - A missed selection is resolved by the timeout policy (`byTimeout: true`) at version + 1. Its events carry that version, and exactly one new job exists for the next comparison.
  - A command arriving after its deadline is refused as stale, and the timeout applies once.
  - The match time limit restores the open chain (4 + 4 cards), cancels the open comparison and ranks the players.
- **Concurrency:**
  - Three different category commands for one comparison produce exactly one transition.
  - A command racing the timeout worker produces one resolution.
  - Cards are conserved at every step.
- **Browser:** two browsers play a full match. Only one ever has enabled category buttons. Both reach final standings; axe passes on the arena and the result screen; there is no horizontal scroll at 360 px.

## Gaps and notes
- **Phase 08:** the S11 tie screen, the exhaustion and fallback edge cases end to end, full restoration and ranking paths, and vote-based endings.
- **Phases 14–15:** medals (`medalStatus: 'deferred'`) and the results TTL (`resultsExpiresAt: null`). Rooms stay in `FINALIZING` until then.
- **Local data incident:** running `pnpm db:reset` without `STUMPS_DB_NAME` recreated the local `stumps` database, which removed my local copy of the published IPL pack. Nothing committed was affected. The pack was rebuilt with the same pipeline:
  - Cricsheet import, facts, then the licensed IPL headshots: 311 of 321 players, the same 10 without an IPL photo as before.
  - Published with prune: 344 cards (259 Bronze, 25 each of Normal, Silver and Gold, 10 Platinum duals).
  - That is 4 Bronze cards fewer than the earlier 348: this run's facts fetch filled slightly fewer batting and bowling styles.
  - Kohli still reads 92/96/100.

  Checks now use `STUMPS_DB_NAME=stumps_check`.
- **Media path fix (found while taking the real-pack arena screenshot):** the dev API runs from `apps/server`, so the relative `MEDIA_DIR` pointed at a different folder from the one the data scripts write to, and photos returned 404. `loadEnv` now resolves relative `MEDIA_DIR` and `CRICSHEET_DIR` against the workspace root (unit test in `apps/server/test/unit/env.spec.ts`).

## Follow-up (same day): card and arena redesign, deck queue
- **Cards** (`components/cards/PremiumCricketCard.tsx`, `teams.ts`, `globals.css`):
  - Team-coloured spotlight behind the photo, a rarity crest and stars, a name plate, and stat bars.
  - Gold, Silver and Platinum shine and glow; Platinum frames are holographic; Bronze and Normal are matte. Reduced motion has a static fallback.
  - A new `mini` size for the deck queue.
- **Arena** (`features/cards/arena/*`):
  - A stadium-style stage, with a HUD showing the pot and the comparison sheet.
  - A turn banner with a circular timer.
  - A battle zone: player plates with deck stacks, your card against the others, a deal-in animation and a glowing selector.
  - Stat tiles that preview the chosen stat on every revealed card.
  - A round banner showing every player's value.
  - A trophy result screen.
  - Your deck as a queue: "In play", then "Next 1…n".
- **Server:** the snapshot carries `myDeck` for its owner only (ADR-021 §5a). The contracts, the catalog and `contracts:check` are updated.
- **Tests:** integration covers deck privacy for every seat and queue order after a win. The E2E test checks the deck queue.

## Next phase
Phase 08: ties, exhaustion, fallback, cycle and time endings, ranking, restoration, and the S11 tie arena.
