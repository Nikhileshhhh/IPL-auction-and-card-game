# Phase 09 report — Real IPL auction rules, franchises and retentions

**Date:** 2026-10-12 · **Result:** complete.

An auction room can now reach the auction lobby with locked, validated squads and deterministic purses. The setup uses the real IPL mega-auction rules (2025–27) applied to today's squads, with real base prices and salaries. Collaborators can join teams by code with captain approval. Bidding is phase 10; capabilities and captain handover are phase 11.

Decisions are recorded in ADR-024.

## Migration
- **`060_auction`:** adds `auction_games`, `auction_franchises`, `franchise_members`, `franchise_invites`, `franchise_join_requests`, `auction_pool`, `retention_packages` and `auction_acquisitions`, plus four columns on pool entries.
- **Deferred triggers:** purse conservation and the captain pointer.
- **Bookkeeping:** `REQUIRED_MIGRATION` is now `060_auction`; the migration is listed in the manifest.
- **Applied to:** `stumps_check` (reset) and the dev `stumps` database (pending migrations only).

## Changed paths
- **Engine** (`packages/game-engines/src/auction/`):
  - `types.ts`, `rulesets.ts` (`IPL_MEGA_RULES_2025_27`, JSON round-trip and hash, increments)
  - `retention.ts` (charge, allocation, checks, RTM cards)
  - `roster.ts` (reserve, max bid, squad summary)
  - `pool.ts` (sets, order, feasibility)
- **Contracts:**
  - `packages/contracts/src/auction.ts`: payloads and acks, event payloads, `AuctionSetupSnapshot`, `PublicTeam`, `AuctionPlayer`, `SquadDTO`.
  - New command `auction.franchiseSelection.close` and event `auction.setupPhaseChanged`.
  - `AuctionSettings.preset` is now `IPL_MEGA_RULES_2025_27`, and the default format is retention.
  - Catalogs and `contracts:check` are extended.
- **Server:**
  - `apps/server/src/modules/auctions/`:
    - `rulesets.ts`: insert, publish, current, plus the demo ruleset.
    - `sources.ts`: Wikipedia list parsers, Cricsheet internationals, the capped rule.
    - `setup.ts`: room binding, pool freeze, team codes, pool players with portraits.
    - `commands.ts`: claim, request and decide join, close selection, propose and lock retention.
    - `projection.ts` and `squad.ts`.
  - The room runtime keeps one projector per game type.
  - Team-stream ACL for snapshots, socket and replay, and socket join on approval.
  - Auction start requires `AUCTION_LOBBY`.
  - Publishing a demo pack also publishes its auction ruleset.
- **Data:**
  - `scripts/data/import-auction.ts`, run as `pnpm data:auction`.
  - Committed sources and review files: `data/sources/ipl-auction-pool.csv` and `data/sources/ipl-auction-capped-overrides.csv`.
- **Web** (`apps/web/features/auction/setup/` and the `/rooms/[id]/{franchises,retentions,auction-lobby,squad}` pages):
  - S14 shows the real rules with official and reported badges and the source.
  - S16 franchise selection, plus the S17 basic team panel.
  - S18 retention manager.
  - S19 auction lobby.
  - S22 squad view.
  - The lobby passes its live state to these screens and hides readiness until the auction lobby.
- **Also fixed:** franchise short names now use the real abbreviations, PBKS and SRH.

## The real pool (published ruleset `b353e826`)
- **Size:** 210 players from the IPL 2026 squads that have a card and photo: 142 capped, 68 uncapped and 78 overseas.
- **Base prices:**
  - 168 players have a real registered base price from the 2026 or 2025 auction lists or replacement signings.
  - 42 retained since 2024 get the owner's rule (₹2 cr capped, ₹30 lakh uncapped), labelled "not registered since 2024".
- **Salaries:** current 2026 salaries pre-fill the retention amounts. For example, Kohli ₹21 cr and Patidar ₹11 cr exactly fill the ₹18 + 14 cr slabs. Mumbai Indians keeping Bumrah, Suryakumar, Hardik and Rohit costs ₹67 cr, which matches their real 2025 total.

## Checks actually run (local PostgreSQL 16)
| Command | Result |
|---|---|
| `pnpm lint`, `pnpm typecheck` | pass |
| `pnpm contracts:check` | pass — 31 commands, 54 events, 67 error codes |
| `pnpm test:unit` | pass — 22 files, 192 tests (19 new auction engine tests) |
| `STUMPS_DB_NAME=stumps_check pnpm db:reset` / `db:lint` | pass — 13 migrations, 60 app_private tables |
| `pnpm test:integration` | pass — 11 files, 93 tests (8 new auction tests) |
| `pnpm test:security` | pass — 43 tests |
| `pnpm test:concurrency` | pass — 9 tests |
| `pnpm build` | pass |
| `pnpm test:e2e` | pass — 38 passed, 6 skipped (desktop-only flows by design), including the new two-browser auction flow |

## Verified behaviour
- **Engine:** the MI FAQ example leaves ₹41 cr; CSK and SRH 2025 charges are reproduced; top-up allocations sum exactly; caps are 6/5/2; foreign identity, unknown status and duplicates are refused; fresh rooms have no retentions or RTM; reserve and max bid are correct; pool feasibility gives an exact message.
- **Integration:**
  - Two simultaneous claims of one franchise: exactly one wins, the other gets `FRANCHISE_TAKEN`.
  - A member cannot join two teams.
  - A team code creates only a request, and only the captain decides it.
  - Only team members can read the team stream; others are refused with a concealed 404.
  - Only the host can close selection, and only with two or more teams.
  - Retention: foreign identity is refused, caps and overspend are refused, a stale version gets `VERSION_CONFLICT`.
  - On lock, the purses, acquisitions and charge agree, and the pool shows the players as retained.
  - The public projection and the squad view are correct.
  - Start is refused until the setup is complete, then reports `ENGINE_UNAVAILABLE` (bidding is phase 10).
  - A direct purse edit is rejected by the trigger; the fresh format skips retentions.
- **E2E:** two browsers (desktop and 360 px) claim franchises, retain with real slabs, lock, reach the auction lobby and open the squad view, with axe checks and no horizontal scroll.

## Gaps and notes
- **Missing pool players:** 64 players in the 2026 squads have no IPL appearance yet, so they have no card or photo and are not in the pool. They join once they play and the pack is re-imported.
- **Unregistered prices:** the 42 owner-rule prices can be replaced in the overrides file at any time.
- **Increments:** the increment schedule is a simulator choice until it is verified in phase 10.
- **Phase 11:** a captain who leaves the room keeps the captaincy until handover is built. Capabilities beyond the advisor default arrive then too.
- **Timeouts:** there is no retention deadline. Per the spec, the lobby waits rather than choosing for a team.
