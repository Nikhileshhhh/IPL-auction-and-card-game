# Phase 14 report — Voting, evaluation, finalization and medals

**Date:** 2026-10-15 · **Result:** complete, with the gaps listed at the end.

What now happens at the end of a game:
- **Both games finish with real results.** A card match goes straight to its results, with medals committed in the same transaction. An auction's squads are scored by an exact, resumable optimizer before the results appear.
- **The host can ask the room to end early.** Everyone entitled to vote gets exactly 15 seconds by the server clock (each card player still in, or one representative per franchise). The game ends only with a strict majority of all of them; otherwise every clock resumes with exactly the time it had left.
- **Medals go to eligible competitors only.** A competitor must have been ready at the start and present for at least half the game, in a qualifying game. A winning franchise's medal is credited once to each eligible teammate. Retried finalizers never mint twice.

Decisions are recorded in ADR-029.

## Migration
- **`110_votes_results`:**
  - `end_votes`: exactly 15 s (CHECK), one open vote per room, saved timers.
  - `vote_electorate`: frozen electors, one representative each, and a ballot trigger making ballots immutable and refusing any cast at or after expiry.
  - `room_results`: at most 300 s, with a source state hash.
  - New columns: `card_seats.eliminated_at`/`participation_at_exit`, `rooms.paused_ms`, `auction_games.evaluation_*` (checkpoint).
  - FORCE RLS on the new tables.
- **Bookkeeping:** `REQUIRED_MIGRATION` is now `110_votes_results`, and the manifest is updated.
- **Applied to:** `stumps_check` (reset) and the dev `stumps` database (pending migrations only).

## Changed paths
- **Engine:**
  - `packages/game-engines/src/voting`: threshold and tally.
  - `evaluation/{model,score,optimizer,rank}`: features and deficits, the exact integer score, the resumable optimizer, ranking.
  - `achievements`: qualification, presence and medal placements.
  - Tests: `test/evaluation.spec.ts` (14, including an independent BigInt oracle and brute force); a vote-mid-tie test in `card-ties.spec.ts`.
- **Contracts:**
  - `packages/contracts/src/results.ts`: vote payloads and acks, `VoteDTO`, vote events, `ResultDTO`, `ResultStatus`, evaluation progress.
  - Snapshot `openVote`/`results`; the `game.completed` result now covers auctions.
  - Catalogs updated.
- **Server:**
  - `modules/voting/{index,clocks}.ts`: `vote.start`, `vote.cast`, and the `room.vote_resolve` job; freezing and restoring clocks; deferring safety ceilings and host transfer.
  - `modules/achievements/{finalize,card,auction,auction-input,results}.ts` and `jobs/evaluation.ts` (`auction.evaluate`).
  - `GET /v1/rooms/:id/results`.
  - `rooms/room-tx.ts`:
    - gameplay is paused while voting;
    - a refused command now commits the due work it settled (savepoint);
    - `jobs/deadlines.ts` claims jobs safely and orders vote resolution first.
  - The card terminal transition finalizes inline. `finishAuction` schedules the evaluation.
- **Web:**
  - `features/voting/EndGameVote.tsx` (S28) in the card arena and on the auction stage.
  - `features/results/ResultsPage.tsx` (S13/S27) at `/rooms/[id]/results`.
  - The arena podium links to the results; the stage shows evaluation progress and then a link.
- **Tests:**
  - `tests/integration/voting.spec.ts` (5)
  - `tests/integration/finalization.spec.ts` (3)
  - `tests/concurrency/voting.spec.ts` (3)
  - `tests/e2e/voting.spec.ts` (1)
  - Card and auction integration tests updated (RESULTS after a card match; the evaluation job after an auction).

## Checks actually run (local PostgreSQL 16)
| Check | Result |
|---|---|
| `pnpm lint` | ✅ (after fixing one unused test variable and formatting) |
| `pnpm typecheck` | ✅ (after one test typing fix) |
| `pnpm contracts:check` | ✅ 32 commands, 54 events, 67 error codes, 88 HTTP operations |
| `pnpm test:unit` | ✅ 234 |
| `STUMPS_DB_NAME=stumps_check pnpm db:reset` / `db:lint` | ✅ 18 migrations / 72 tables |
| `pnpm test:integration` | ✅ 137 |
| `pnpm test:security` | ✅ 46 |
| `pnpm test:concurrency` | ✅ 15 |
| `pnpm build` | ✅ |
| `pnpm test:e2e` | ✅ 41 passed, 9 skipped (two-context flows run once, on desktop) |

## Verified behaviour
- **Voting:**
  - Only the host can start a vote. A second start gets `VOTE_IN_PROGRESS`, and 20 parallel starts open exactly one vote.
  - Play is frozen (`GAME_PAUSED` with reason VOTE).
  - Ballots:
    - an identical retry returns the same receipt; a changed choice gets `VOTE_ALREADY_CAST`;
    - 30 parallel ballots from one elector record one choice;
    - a ballot at the expiry gets `VOTE_EXPIRED`, and the database refuses a ballot cast at or after expiry.
  - Resolution:
    - nothing resolves before 15 s, even with every ballot in, and running the due pass twice resolves once;
    - 1 of 2 Yes (an abstention) fails, and the card timer resumes with exactly its saved remaining time (deadline − resolution = saved ms);
    - cooldown and limit errors apply after failures;
    - when a due ending settles before a vote start, the start is refused and the match stays finished.
- **Auction votes:**
  - bids during a vote get `GAME_PAUSED`, and even a lot clock forced overdue cannot sell during the vote;
  - a failed vote resumes bidding;
  - a passed vote cancels the open lot without a sale, then the evaluation runs and the room reaches RESULTS with "no medals" for incomplete squads.
  - One franchise, one vote: a teammate gets `FORBIDDEN` and sees who represents the team; the co-captain represents a captain absent beyond the grace.
- **Medals:**
  - In a qualifying card match where the winner-side player was absent, medals skip the ineligible player without changing ranks.
  - Receipts are minted once across 10 finalizer retries, and again after the results row was removed; counters are unchanged.
  - A finalizer crashing after inserting receipts rolls everything back.
  - Results return 404 to outsiders and 410 after expiry.
- **Auction finalization:**
  - Two legal 18-player squads are ranked by exact score with gold and silver only; every best XI has 11 players with portraits.
  - The host's three teammates on the roster at the start each get one team medal, and an advisor approved after the start gets none (`late_join`).
  - A retried evaluation changes nothing.
- **Exact optimizer:**
  - Every legal XI's integer score equals the BigInt-fraction oracle.
  - The optimizer's XI equals the brute-force optimum with the lexicographic tie-break.
  - Interrupted chunked runs equal one uninterrupted run.
  - A 25-player squad (C(25,11) = 4,457,400 combinations) takes about 2.2 s in this container.
- **E2E (two browsers, one at 360 px):** the host asks, both vote "End the game", the server resolves after 15 s, and the results page shows "Ended by vote" and "Practice game — no medals", with axe and no horizontal scroll.

## Gaps and notes
- **v1 model choices (ADR-029):** the phase-option rules and all-round arithmetic stand in for reviewed capability tags. The ±5 point weight-sensitivity audit is not computed.
- **Participation for card players:** the denominator subtracts the room's total pause time even when a pause came after a player's elimination. This leans in the player's favour.
- **Summary repair (E72):** counters follow only new receipts, but a job that rebuilds them from receipts is not built.
- **Host leaving mid-vote (E53):** host transfer is deferred and the vote resolves by its job, but there is no dedicated test.
- **Purging:** RESULTS rooms are not purged yet; that is phase 15.
