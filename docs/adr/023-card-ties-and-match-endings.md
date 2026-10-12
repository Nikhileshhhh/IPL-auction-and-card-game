# ADR-023: Card ties, fallback audit and match endings

- **Status:** Accepted (phase 08, 12 October 2026). It completes the tie and ending rules that ADR-021 left partial. It implements rules §6, §6.1 and §6.2 and the S11 tie arena.
- **Context:** phase 07 could already finish a tied game, with these gaps:
  - The soft match limit restored the open chain immediately and never wrote `finish_pending`.
  - The 120-minute hard ceiling was not enforced.
  - "Ended by vote" did not exist.
  - A pot settled by the fallback could not be explained to players.
  - The snapshot did not carry the data S11 needs.

## Decision

### 1. Engine layout (`packages/game-engines/src/card/`)
- **`ties.ts`:** the able tied seats, the tie selector rule, and `fallbackWinner`, which returns the winner together with a `FallbackDetail`.
- **`ranking.ts`:** elimination after an award (stored order), standings, and `finish`.
- **`termination.ts`:** `finishMatch` (restore, then finish), `requestFinish` and `expireFinishGrace`.
- **`reduce.ts`:** the contest itself (open, select, timeout, resolve, award).
- **Public API:** unchanged and re-exported from `index.ts`.
- **Invariants:** `assertInvariants` runs after every transition.

### 2. Tie rules, unchanged and now fully covered
- **Who plays on:** only tied players who still have cards contribute to the next comparison.
- **Who chooses:** the original selector chooses again when they are still able. Otherwise the next able tied seat clockwise from them chooses.
- **No re-entry:** a seat that lost a comparison never re-enters the chain.
- **Sole contributor:** a single able contributor wins the pot.
- **Fallback:** when every tied player is exhausted, or after 12 ties (`TIE_CAP`), the pot goes to:
  - the highest sum of the three stats on each tied player's last revealed card;
  - when sums are equal, the earliest seat in the committed fallback permutation, rotated by the chain index.
- **Survival:** a winner left with zero cards after the award survives.

### 3. Fallback audit
- **The detail:** `FallbackDetail = { sums: [{memberId, sum}], byPermutation, rotatedOrder }`.
- **Where it is stored:**
  - in the engine's `comparisonResolved` event;
  - in `card_comparisons.fallback` (jsonb);
  - in the public `card.comparisonResolved` event;
  - in the snapshot's `lastComparison.fallback`.
- **Verifying it:** the rotated order comes from the committed seed, so players can check it once the seed is disclosed at the end of the match.
- **In the UI:** S11 and the comparison sheet explain the fallback in plain language.

### 4. Match endings (rules §6.2)

| Trigger | Engine call | Effect |
|---|---|---|
| Soft match limit (`card.match_limit`) | `requestFinish('time_limit')` | Sets `finishPending`. The current contest, including any tie chain, is played out, and the match finishes at the next normal boundary. A `card.finish_grace` job is scheduled 60 s later. |
| Approved end vote (phase 14) | `requestFinish('vote')` | Same as the soft limit, with reason `vote`. |
| Grace expiry (`card.finish_grace`) | `expireFinishGrace` | If still pending: the open chain is restored, then the match finishes. A stale job is a no-op. |
| Hard ceiling (`card.hard_limit`, start + 120 min) | `finishMatch('time_limit')` | Always ends at once, restoring the open chain. It applies even when the room has no soft limit. |
| Cycle guard / contest cap | unchanged (ADR-021) | Finishes at a boundary. |

- **Restoration:** every ACTIVE and POT card returns to the front of its contributor's deck in original chronological order. The pot empties and the open comparison is cancelled. Eliminations and counters only change when a pot is awarded, so nothing provisional survives.
- **Repeated requests:** a second `requestFinish` while one is pending changes nothing. The first reason wins.
- **When the match ends:** every pending card job (selection timeout, grace, hard limit) is deleted, the seed is disclosed as `auditSeed`, and the room moves to FINALIZING.

### 5. Podium (§6.1)
- **Live seats** rank first, by:
  1. deck count;
  2. contests won;
  3. the stat sum of the deck;
  4. fallback priority.
- **Eliminated seats** follow in reverse elimination order. The elimination order is stored when a seat is eliminated, so it never depends on the final ranking.

### 6. Database: migration `052_card_ties`
- **New columns:**
  - `card_comparisons.fallback jsonb` (object or null);
  - `card_games.pending_reason text`, with CHECK in (`time_limit`, `vote`).
- **Boolean kept in sync:** `finish_pending` stays as a boolean view. The `card_games_pending_consistent` constraint keeps it equal to `pending_reason IS NOT NULL`.
- **`REQUIRED_MIGRATION`** is now `052_card_ties`.

### 7. Contracts and snapshot
- **Finish reasons:** `FINISH_REASONS` adds `vote`; `PENDING_FINISH` is `time_limit | vote`.
- **New S11 snapshot fields:**
  - `finishPending` (the reason, or null);
  - `chainSelector`, the seat that started the contest;
  - `tieCount` and `tieCap`;
  - `waitingSeats`: live seats sitting out the tie;
  - `contributions[].comparisonIndex`, so pot history can be grouped by comparison.
- **New public event:** `game.finalizing` `{stage: 'finish_pending', progressPercent, reason, deadline}` announces a pending end and its grace deadline.
- **Hidden until the end:** deck order and the seed stay hidden until the terminal state, as before.

## Consequences
- A time-limit end no longer cuts a contest off mid-reveal unless it runs past the 60-second grace. The worst case is still bounded by the hard ceiling.
- The voting UI (phase 14) only needs to call `requestFinish('vote')` inside the room transaction.
- Older comparisons have `fallback = NULL`, so the UI shows no explanation for them.
