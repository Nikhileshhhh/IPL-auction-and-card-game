# ADR-029: End-game voting, exact squad evaluation, finalization and medals

- **Status:** Accepted (phase 14, 15 October 2026).
- **Implements:**
  - rules §6.2 (vote ending and restoration), §10 (squad evaluation v1), §12 (democratic ending), §13 (qualification and medals) and §15 (pseudocode);
  - DB/realtime §5 (`end_votes`, `vote_electorate`, `room_results`), §7 (finalization) and §8 (vote commands and events);
  - screens S13, S27 and S28.
- **Builds on:** ADR-007 (durable deadlines), ADR-023 (card endings), ADR-025 (live auction), ADR-026 (team roles) and ADR-027 (participation and the recovery pause).
- **Context:** before this phase:
  - a finished card match stopped in FINALIZING with `medalStatus: 'deferred'`;
  - an auction stopped in FINALIZING with nothing evaluating it;
  - no vote, result or medal code existed, although receipts, summaries and the room's `award_batch` had been in the schema since phase 02.

  The spec's named mistakes for this phase:
  - dividing Yes by the votes cast;
  - restarting the 15 seconds on refresh;
  - calling a heuristic XI optimal;
  - copying the full match into achievements.

## Decision

### 1. Votes: frozen, exactly 15 seconds, strict majority of N
- **Who and when:**
  - The host starts a vote while the game is RUNNING, through the room transaction wrapper.
  - Due deadlines are settled first, so a match that has just finished refuses with `ALREADY_COMPLETED` (E54).
  - A refused command now still commits the due work it settled: the handler runs inside a savepoint. This applies to every command.
  - Other refusals: `VOTE_IN_PROGRESS` (one open vote per room, enforced by a partial unique index), `VOTE_COOLDOWN` (120 s after a failed vote), `VOTE_LIMIT` (3 failed votes), and `STATE_CONFLICT` while a card finish is already pending.
- **Electorate, frozen when the vote opens:**
  - **Cards:** every seat not yet eliminated.
  - **Auction:** one elector per franchise, offline ones included. The representative is the captain, or the designated co-captain when the captain has no live connection and was last seen more than the 30 s grace ago while the co-captain is connected.
  - The mapping never changes during the vote. A representative who disconnects abstains (E55, E56).
- **Timing:** `expires_at = starts_at + 15 s` on the database clock, enforced by a CHECK. A refresh shows the same vote, and a restart resolves it once at its original deadline (E27).
- **Ballots:**
  - One immutable ballot per elector. An identical retry returns the stored receipt; a different choice gets `VOTE_ALREADY_CAST`.
  - A trigger refuses any ballot cast at or after expiry. Due resolution runs before the ballot, so t − 1 ms counts and t gets `VOTE_EXPIRED` (E52).
  - No tally is visible before resolution; the host's own vote is never assumed.
- **Threshold:** `tallyVote` passes only when Yes ≥ ⌊N/2⌋ + 1 of the frozen N. N=1 needs that Yes, N=2 needs both, and 2 Yes / 1 No / 1 abstain of 4 fails (E29, E30).

### 2. Freezing and restoring gameplay clocks
- **What freezes:** opening a vote moves every gameplay clock forward by the 15 s window, with jobs and their authoritative deadline columns moving together:
  - the bid and RTM clocks, the gap between lots and the host pause;
  - automated bidding and absence checks;
  - the card selection timer, the finish grace and the match soft limit.

  The remaining time of each is saved in `end_votes.saved_timers`.
- **During the vote:**
  - Every gameplay command gets `GAME_PAUSED {reason:'VOTE'}`.
  - A frozen job that somehow falls due is deferred until the vote resolves, so a lot can never be sold during a vote.
  - The hard safety ceilings and the host-absence handover wait for the resolution (E53).
- **Failed vote:** the clocks move again by the resolution's lateness, plus any remaining outage recovery pause, so each resumes with exactly the time it had left (`deadline − resolved_at = saved remaining`).
- **Passed vote:**
  - Cards: `finishMatch(state, 'vote')`, which restores the unresolved tie chain to its contributors once, then ranks (E28).
  - Auction: `finishAuction('vote')`, which cancels the open lot or RTM without a sale and keeps earlier acquisitions.
  - The vote and recovery pause time goes into `rooms.paused_ms`, which is excluded from the participation denominator.

### 3. Squad evaluation v1 (exact)
- **Inputs, frozen with the room:**
  - each franchise's acquisitions;
  - the data version's `player_ratings` (integer points 0–1000);
  - the pool's role, bowling type and overseas flag;
  - the ruleset's squad limits;
  - cost: the charged price, or the allocated charge for retained players.
- **Formula:** exactly the spec's: `Score = .30B + .30W + .10A + .15C + .10D + .05V`, with missing role slots scoring zero.
- **v1 model choices, because the data has no reviewed capability tags:**
  - A batting-capable player is a top-order, middle or finishing option according to their best batting phase.
  - A bowling-capable player is a powerplay or death option when that phase's rating is ≥ 400 points.
  - All-round skill is `isqrt(batting·bowling)`.
  - Keeper quality is `.7·batting + .3·fielding`.
  - Expected price is `purse/minSquad·(.5 + q/1000)` rescaled to the pool's median base price, which reduces to `median(base)·(500+q)/median(500+q)`. Unspent money earns nothing.
- **Exactness:**
  - Every component is an integer over a fixed denominator, so the optimizer compares exact integers below 2^53.
  - Final ranking compares BigInt rationals.
  - An independent BigInt-fraction oracle checks every legal XI of small random squads, and brute force checks the optimizer's choice and tie-break.
- **Optimizer:**
  - It visits every 11-player combination in lexicographic id order (at most C(25,11) = 4,457,400), keeps the best exact objective and takes the first maximum, which is the lexicographically smallest.
  - Work is chunked (10,000 combinations) in about 250 ms slices of the `auction.evaluate` job, checkpointed in `auction_games.evaluation_*` with the input hash. A restart resumes; changed inputs restart from zero.
  - A 25-player squad takes about 2.2 s, and progress is published as `game.evaluationProgress`.
  - There is no heuristic path.
- **Ranking:**
  - Legal squads (size within limits, overseas within the cap, a legal XI exists) by exact total, then min(B, W), then C, then XI data completeness, then a committed draw: HMAC of the auction seed with `results:<franchise>`.
  - Illegal squads follow with their concrete deficits. If no squad is legal, the result is "No qualifying champion" (E62).
- **Not done in v1:** the ±5 point weight-sensitivity audit is not computed.

### 4. Qualification, eligibility and medals
- **Qualifying game:** at least 2 competitors at the start, and at least 5 decided card contests or at least 5 settled lots (sold or unsold; skipped lots do not count). Anything else is labelled practice: results are shown and no receipts are written.
- **Card eligibility:**
  - ready at the start, and present for at least 50 % of the time from start to personal elimination or the end;
  - presence up to elimination is captured in `card_seats.participation_at_exit`;
  - vote and recovery pauses are excluded from the denominator;
  - open participation intervals are closed at finalization.
- **Auction eligibility:**
  - The franchise needs a legal squad.
  - A member is credited when on the roster at the start (`franchise_members.eligible_at_start`) and present for at least 50 % of the auction.
  - Late joiners and absent members are listed with the reason they got no credit (E61).
- **Medals:**
  - Medals go to the first three eligible competitors, or legal squads, in rank order. The medal place is stored apart from the rank, and two eligible competitors means no bronze.
  - A franchise medal is credited once to each credited teammate (`scope = franchise`, `credited_role`), shown as "Team gold".

### 5. Finalization is one idempotent transaction
- **Steps, under the room lock:**
  1. Close participation.
  2. Insert receipts with `INSERT … ON CONFLICT (award_batch, user_id) DO NOTHING RETURNING`, in user-id order.
  3. Increment summaries only for the rows returned (games, the medal, card or auction wins for a rank-1 victory).
  4. Store `room_results` (public result and source state hash, expiring after the room's 30–300 s results TTL).
  5. Enter RESULTS.
- **When it runs:**
  - Card ranks are immediate, so a card match finalizes inside its terminal transition.
  - An auction finalizes when the evaluation finishes.
- **Safety:** a failure rolls back receipts and completion together. Re-running the finalizer, even after its results row was removed, mints nothing more (E32).
- **What receipts hold:** only award batch, user, game type, rank, medal place, medal, scope, credited role, completion day and ruleset and evaluator versions. Never room names, codes, opponents, bids, squads or chat.

### 6. Reading results
- **Route:** `GET /v1/rooms/:id/results` gives a member the public podium, rankings, score reports and seed audit, plus only their own credits.
  - Non-members get 404 and `STATE_CONFLICT` comes back while the room is still finalizing.
  - After expiry the route returns 410 `RESULTS_EXPIRED`, and the page says "Detailed match results expired".
- **Snapshot:** carries `openVote` (personalised `canVote`, own recorded choice, the representative) and `results` (finalizing progress, ready, expired).
- **Web:**
  - S28 `EndGameVote` in the arena and on the stage: the host's "End game early", a dialog or bottom sheet with a server-clock countdown announced at 10 s and 5 s, two equally weighted choices for electors only, and a banner when closed.
  - S13/S27 `ResultsPage` at `/rooms/:id/results`: podium with text medal labels, ranking with eligibility reasons, own credit, score components as a numeric table with bars, best XI with portraits, seed audit, and a TTL footer.

## Consequences
- **Lifecycle:** a card room now goes RUNNING → RESULTS in one step; an auction goes RUNNING → FINALIZING → RESULTS. Purging RESULTS rooms after their TTL is phase 15.
- **Time accounting:** the 15 s of a vote never comes out of anyone's playing time, and an outage during a vote cannot add or take time.
- **Model limits:** the score is an explainable game score, not a forecast. The phase-option rules are v1 model choices, disclosed on S27 and versioned as `squad-eval-v1`.
