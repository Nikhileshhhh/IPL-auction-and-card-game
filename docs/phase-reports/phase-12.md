# Phase 12 report — Reconnect, failover and safe automation

**Date:** 2026-10-13 · **Result:** complete. The one exception is the outage *vote* case: it needs end votes, which arrive in phase 14.

What now happens when people or the server drop out:
- **Bidders away:** when every authorised bidder of a team has been away for 30 seconds, a connected co-captain takes over. Without one, the team's saved limits bid for it, or it observes if nothing was saved.
- **The bot:** deterministic and opt-in. It bids only the next legal amount within its private ceilings, cap, purchase limit and both reserves, through the same validator as people. Every decision has a reason.
- **Coming back:** returning people resume manual control explicitly, fenced by the franchise control epoch.
- **Server crash:** a crashed server can no longer sell players nobody could bid on. Overdue clocks pause with their remaining time behind a 10-second countdown.
- **Presence:** follows the spec (5 s heartbeat, 15 s stale, 30 s grace), and participation is counted as connected intervals.

Decisions are recorded in ADR-027.

## Migration
- **`090_auto_control`:**
  - `auto_strategies`: private limits, version, spend and purchase counters; FORCE RLS.
  - Franchise failover member, control reason and time.
  - Room `recovery_until` and `recovery_generation`.
  - A connection member/expiry index.
- **Bookkeeping:** `REQUIRED_MIGRATION` is now `090_auto_control`, and the manifest is updated.
- **Applied to:** `stumps_check` (reset) and the dev `stumps` database (pending migrations only).

## Changed paths
- **Engine:** `packages/game-engines/src/auction/auto.ts` (`autoDecision`, `autoRtmDecision`, `autoBidDelayMs`, `ROLE_NEEDS`) and `test/auction-auto.spec.ts` (9 tests).
- **Contracts:**
  - `packages/contracts/src/auto.ts`: strategy input, configure and takeover, control/decision/configured/recovering payloads, `StrategyDTO`, `AutoViewDTO`.
  - `LiveTeam.control`, `BID_BLOCKS.TEAM_NOT_MANUAL`, snapshot `recoveryUntil`.
  - Catalogs updated.
- **Server:**
  - `modules/auctions/bidding.ts`: one write path for human and automated bids.
  - `modules/auctions/auto-bid.ts`: control state, strategy, bot and RTM jobs, absence evaluation, sale credit.
  - `modules/auctions/auto-control.ts`: configure, takeover, S26 view.
  - `modules/presence/recovery.ts`: participation intervals, absence arming.
  - `jobs/recovery.ts`: outage recovery pause. The coordinator lease reports a takeover gap, and the workers run the recovery.
  - `rooms-socket.ts`: 15 s TTL, presence hooks, `server.recovering` notice.
  - `GET /v1/rooms/:id/franchises/:f/strategy`.
  - Human bids and RTM decisions respect franchise control. Auction and card gameplay commands respect the recovery pause.
- **Web:**
  - `features/team/auto/*`: S26 `AutoModePanel` and reason texts, at `/rooms/[id]/auto`.
  - `features/reconnect/*`: `RecoveryBanner` (S35 countdown) and `MissedRecap`.
  - Stage `ControlBanner` with "Resume manual control", and control labels on the teams rail.
  - Auto-bidding links; 5 s heartbeat; refresh on `server.recovering`; the card arena shows the recovery banner.
- **Tests:**
  - `tests/integration/auto.spec.ts` (9)
  - The E2E auction flow saves automated limits on S26.
  - The web unit fixture now has `recoveryUntil`.

## Checks actually run (local PostgreSQL 16)
| Check | Result |
|---|---|
| `pnpm lint` | ✅ |
| `pnpm typecheck` | ✅ |
| `pnpm contracts:check` | ✅ 32 commands, 54 events, 86 HTTP operations |
| `pnpm test:unit` | ✅ 216 (includes the existing gap and duplicate-event tests in `apps/web/test/room-events.spec.ts`) |
| `STUMPS_DB_NAME=stumps_check pnpm db:reset` / `db:lint` | ✅ 16 migrations / 66 tables |
| `pnpm test:integration` | ✅ 119 |
| `pnpm test:security` | ✅ 44 |
| `pnpm test:concurrency` | ✅ 12 |
| `pnpm build` | ✅ |
| `pnpm test:e2e` | ✅ 38 passed, 6 skipped (two-context flows run once, on desktop) |

Manual check on the dev server with the real pack: RCB saved role ceilings and started the auction, then the captain closed the tab. About 45 s later RCB showed "Automatic". The bot bought Shubman Gill for ₹2 cr within its ₹3 cr batter ceiling (₹2 cr of ₹10 cr spent, 1 of 3 players). The returning captain saw "Resume manual control" and took the team back.

## Verified behaviour (integration)
- **Configuring limits:** only the captain or a limits manager can configure; the version is checked (`VERSION_CONFLICT`); a rival reads the strategy route as 404.
- **Absence:**
  - An offline captain with another connected bidder stays MANUAL.
  - A connected co-captain takes control (FAILOVER) and can bid without the bid right.
  - When the co-captain goes too and there is no strategy, the team observes, its people are fenced (`TEAM_NOT_MANUAL`) and nothing is bid.
- **The bot:**
  - It bids exactly the target's ceiling, then passes when the rival goes above it (`OVER_CEILING`, with the ceiling shown).
  - With a cap equal to one base price it buys once, the counters show ₹cap and 1, the purchase is listed, and the next lot gets `CAP_REACHED`.
- **Resume:**
  - Limit edits while automatic are refused (`TAKE_OVER_FIRST`), and a stale epoch gets `CONTROL_EPOCH_STALE`.
  - A resume racing a due bot attempt leaves MANUAL, no pending automated jobs, at most the one committed bot bid, and no later automated bids.
- **Mobile suspension:** a stale tab is swept, participation credits exactly 270 s (opened 5 min ago, last heartbeat 1 min ago, plus 30 s grace), and the absence check is armed.
- **Server crash:** a taken-over lease with a 20 s gap pauses an overdue lot. The lot stays open with about 15 s left (10 s countdown + 5 s remaining), the due pass sells nothing, and bids get `GAME_PAUSED` until the countdown ends; then play resumes.
- **Revocation before replay:** a member removed from a team gets 404 on replaying its stream and loses the cursor.

## Gaps and notes
- **Outage vote exception:** needs end votes (phase 14). ADR-027 records the rule, and the recovery pause already leaves room for it.
- **Automated right to match:** implemented (invoke or match only within the RTM ceiling; a held final offer) and engine-tested. It is not driven in integration, because it needs a retention room where an automatic team's former player is bid for by the rival.
- **Planned-deploy drain notice and gap alerting:** phase 19 (operations).
