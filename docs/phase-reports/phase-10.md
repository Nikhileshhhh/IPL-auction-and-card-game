# Phase 10 report — Live bidding, right to match and auction resolution

**Date:** 2026-10-13 · **Result:** complete.

A room that reaches the auction lobby can now run the whole auction:
- serial bids at the exact next step, with an 8-second anti-sniping extension;
- the real 2025 right-to-match flow (intent, the highest bidder's one final raise, match);
- sales with a single purse deduction;
- an unsold second pass, and host skip, pause and resume;
- the end, moving the room to FINALIZING.

Decisions are recorded in ADR-025.

## Migration
- **`070_auction_bidding`:**
  - New tables: `auction_nominations` (one open lot per room) and `auction_bids` (UQ nomination, version).
  - New columns: `auction_pool.bowl_type` and `skipped`; the auction game's seed, pause and generation fields.
  - Foreign keys: active nomination, and acquisition → nomination.
- **Bookkeeping:** `REQUIRED_MIGRATION` is now `070_auction_bidding`, and the manifest is updated.
- **Applied to:** `stumps_check` (reset) and the dev `stumps` database (pending migrations only).

## Changed paths
- **Engine** (`packages/game-engines/src/auction/`):
  - `bids.ts`: next bid, extension, validators, ceiling.
  - `xi.ts`: XI feasibility DP.
  - `rtm.ts`: card check, RTM opening, final-offer validation.
  - `nomination.ts`: lot order, next lot and passes, no buyers.
  - `invariants.ts`
  - The `lots` RNG stream; increments marked "reported".
- **Contracts:**
  - `packages/contracts/src/auction-live.ts`: payloads and acks for 7 commands, event payloads, `NominationDTO`, `AuctionLiveSnapshot`.
  - `game.finalizing` widened for the auction.
  - Catalogs updated, and `contracts:check` now verifies the live event payloads.
- **Server** (`apps/server/src/modules/auctions/`):
  - `live-store.ts`: loaders and jobs.
  - `settlement.ts`: open lot, close bidding, RTM stages, sell, unsold, skip, finish.
  - `starter.ts`: seed, commitment, lot order, first lot, hard limit.
  - `deadlines.ts`, `command.ts` (bid, RTM intent / final offer / match, pause, resume, skip) and `live.ts` (projection).
  - The module now registers the starter, the deadlines and the live commands.
  - A starter may report that the game already ended while starting.
- **Web:**
  - `apps/web/features/auction/stage/*`: stage, spotlight, clock, bid panel, RTM panel, teams rail, history, host controls.
  - The `/rooms/[id]/auction` page.
  - The lobby redirects to the stage on start.
  - `SquadView` is reusable on the stage.
- **Tests:**
  - `packages/game-engines/test/auction-bidding.spec.ts`
  - `tests/integration/auction-live.spec.ts` and `tests/support/auction.ts`
  - `tests/concurrency/auction.spec.ts`
  - E2E `tests/e2e/auction-setup.spec.ts`, extended to start the auction and bid in two browsers.
  - The phase-09 integration test now starts the auction instead of expecting `ENGINE_UNAVAILABLE`.

## Checks actually run (local PostgreSQL 16)
| Check | Result |
|---|---|
| `pnpm lint` | ✅ |
| `pnpm typecheck` | ✅ |
| `pnpm contracts:check` | ✅ 31 commands, 54 events |
| `pnpm test:unit` | ✅ 207 |
| `STUMPS_DB_NAME=stumps_check pnpm db:reset` / `db:lint` | ✅ 14 migrations / 62 tables |
| `pnpm test:integration` | ✅ 102 |
| `pnpm test:security` | ✅ 43 |
| `pnpm test:concurrency` | ✅ 11 |
| `pnpm build` | ✅ |
| `pnpm test:e2e` | ✅ 38 passed, 6 skipped (two-context flows run once, on desktop) |

## Verified behaviour
- **Start and first sale:** the start commits a seed (64-hex commitment). Lot 1 opens at the base price, and the viewer's exact next bid is in the snapshot.
- **Bid rules:**
  - The leader cannot raise itself (`ALREADY_LEADING`).
  - A stale version gets `STALE_BID` with the new version and amount.
  - A bid at the deadline is `LATE_BID`.
  - A bid in the last seconds pushes the deadline to at least 8 s and emits `auction.timerChanged`.
- **Single sale:** the sale writes one acquisition at the last bid and deducts the purse once. Three concurrent due passes still sell once.
- **Concurrency:** 200 parallel bids on one version produce exactly one accepted bid.
- **RTM, every branch:**
  - intent timeout → sale;
  - decline → sale;
  - invoke → raise → match: RTM at the raised price, one card used;
  - invoke → raise → decline: sale at the binding final offer;
  - raise timeout holds, then match timeout → sale at the standing bid.
  - The final offer must be in whole lakhs and not below the standing bid.
  - The wrong team gets 403.
  - A fresh-format room never opens RTM.
- **Host controls:**
  - skip only before the first bid, and only by the host;
  - pause only between lots;
  - a paused auction ignores the next-lot job;
  - resume opens the next lot; the pause also expires on its own.
- **End of the pool:** the whole demo pool went unsold in pass 1, came back once in pass 2, and the auction ended `pool_complete`. The room is FINALIZING, the seed is disclosed and no `auction.*` jobs are left.

## Gaps and notes
- **Integration-only checks:** reserve, overseas and full-squad rejections are covered by engine tests. In integration they are reachable only through a long auction, so they are not driven there.
- **Not in this phase:**
  - bidding rights for non-captains (capability editor) and captain handover: phase 11;
  - automated bidding and recovery pauses: phase 12;
  - evaluation, medals and the results screen: phase 14;
  - S21 (player detail drawer).
- **Increments above ₹2 cr:** the ₹20 lakh step is the floor reported for the 2025 auction; sources differ above ₹3–5 cr.
