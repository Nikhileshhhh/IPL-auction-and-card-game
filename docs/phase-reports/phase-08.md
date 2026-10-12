# Phase 08 report — Complete tie engine and card termination

**Date:** 2026-10-12 · **Result:** complete. Phase 08 delivers:
- every tie path: narrowing, sole contributor, exhaustion, fallback and the tie cap;
- elimination order and the podium;
- the cycle guard;
- soft-limit, vote, grace and hard-ceiling endings, including restoration of an unresolved chain;
- the S11 tie arena.

The decisions are in ADR-023. The voting UI that triggers `requestFinish('vote')` is phase 14.

## Migration
- **`052_card_ties`:**
  - `card_comparisons.fallback jsonb`, the fallback audit.
  - `card_games.pending_reason` (`time_limit` | `vote`), kept equal to `finish_pending` by the `card_games_pending_consistent` CHECK.
  - `REQUIRED_MIGRATION` is now `052_card_ties`, and both columns are listed in `docs/migration-manifest.md`.
  - Applied to `stumps_check` (reset) and, pending-only, to the dev `stumps` database (not reset).

## Changed paths
- **Engine** (`packages/game-engines/src/card/`):
  - New `ties.ts`, `ranking.ts`, `termination.ts` and `shared.ts`.
  - `reduce.ts` is reduced to the contest itself.
  - `types.ts` adds `finishPending`, `FallbackDetail`, the `vote` reason and the `finishPending` event.
- **Server** (`apps/server/src/modules/cards/`):
  - New `tie-service.ts` (match limit → request finish; finish grace → restore and finish; hard limit → finish now).
  - `store.ts` persists `pending_reason` and `fallback`.
  - `apply.ts` maps `finishPending` to `game.finalizing` and schedules the 60 s grace.
  - `starter.ts` schedules the hard limit at 120 min.
  - `projection.ts` adds the S11 fields.
  - `deadlines.ts` keeps only the selection timeout.
- **Contracts:**
  - `packages/contracts/src/cards.ts`: `PotCard.comparisonIndex`, `FallbackDetail`, `PENDING_FINISH`, snapshot S11 fields and the `game.finalizing` payload.
  - `schema/events.json` and `schema/dto-catalog.json` updated to match.
- **Web** (`apps/web/features/cards/tie-arena/`):
  - `TieBanner`: who is tied, who started the contest, "tie n of 12", and who is waiting.
  - `PotHistory`: a dialog listing the pot cards with photos, grouped by comparison.
  - `FallbackExplanation` and `fallback.ts`.
  - `FinishPendingNotice`.
  - These are wired into `CardArena`, `RoundWinnerReveal` and `ComparisonSheet`.
- **Tests:**
  - `tests/fixtures/cards/tie-scenarios.json` (12 scenarios) and `packages/game-engines/test/card-ties.spec.ts`.
  - Extended `tests/property/card-conservation.spec.ts`.
  - Four new tests in `tests/integration/cards.spec.ts`.
  - Fallback copy tests in `apps/web/test/card-arena.spec.ts`.
- **Docs:** ADR-023, this report, traceability RQ-13 to RQ-15, and the screens row for S11.

## Checks actually run (local PostgreSQL 16)
| Command | Result |
|---|---|
| `pnpm lint` | pass |
| `pnpm typecheck` | pass |
| `pnpm contracts:check` | pass — 30 commands, 53 events, 67 error codes |
| `pnpm test:unit` | pass — 21 files, 171 tests (engine fixtures and property included) |
| `STUMPS_DB_NAME=stumps_check pnpm db:reset` | pass — 11 migrations |
| `STUMPS_DB_NAME=stumps_check pnpm db:lint` | pass — 52 app_private tables |
| `pnpm test:integration` | pass — 10 files, 85 tests |
| `pnpm test:security` | pass — 43 tests |
| `pnpm test:concurrency` | pass — 9 tests |
| `pnpm build` | pass |
| `pnpm test:e2e` | pass — 37 passed, 5 skipped (desktop-only flows by design) |

## Verified behaviour
- **Engine fixtures (rules §14 and §6):**
  - the six-card tie example;
  - repeated two-, three- and four-way ties;
  - all tied players exhausted (sums decide);
  - equal sums (the committed permutation decides);
  - one able player;
  - a last-card winner surviving with zero;
  - no re-entry by a losing seat;
  - a pending end finishing at the boundary;
  - restoration after a vote;
  - the cycle guard.
- **Property test:** random selections, timeouts, end requests and grace expiries, for 2–8 seats. It checks that all N cards are conserved, that every match terminates, that runs are deterministic, and that the podium is stable: no eliminated seat ranks above a live one, and the stored elimination order is respected.
- **Integration:**
  - **Soft limit:** the soft limit mid-contest leaves the room RUNNING with `finishPending = 'time_limit'`, a `game.finalizing` event and a grace job. Playing the contest out ends the match in FINALIZING with all 8 cards owned and no `card.*` jobs left.
  - **Grace expiry:** the cards in play return to their owners (decks 4 and 4), one comparison is cancelled, and the seed is disclosed only then.
  - **Hard ceiling:** it ends the match even with no soft limit.
  - **Stale grace:** a grace job arriving after the end changes nothing.

## Gaps and notes
- **E2E:** no Playwright test forces an S11 tie, because the deal is randomised from a fresh seed per match. The tie UI is covered by the snapshot fields, the integration tests and the copy unit tests. A deterministic-deal test hook would be needed for a browser-level tie test.
- **Fallback in integration:** the fallback audit is verified in the engine fixtures and the store maps it, but no integration test forces a fallback, for the same reason.
- **Vote endings:** the engine and server path exist. The voting UI and the `card.vote` command are phase 14.
- **Carried over:**
  - Sachin Tendulkar's cards still need an IPL-jersey photo, from admin upload or the player sheet.
  - The all-rounder dual-skill question is still open.

## Next phase
Phase 09 — auction rulesets, franchises, player pool and retentions (S14–S19, S22).
