# ADR-021: Authoritative card engine (phase 07)

- **Status:** Accepted (11 October 2026).
- **Context:**
  - Rules: §1, §3.4, §4–§7, §14.
  - DB spec: §5.2 (card tables), §8.2–§8.3 (commands, events), §10 (PermittedCardSnapshot).
  - Related ADRs: ADR-006 (server authority), ADR-007 (deadlines), ADR-020 and its amendment (legend versions and repeats).

## Decision

### 1. A pure reducer, persisted as rows
- **The engine:** `packages/game-engines/src/card/` is IO-free.
  - The `dealMatch` and `startMatch` functions set up a match.
  - The `selectCategory`, `timeoutSelection` and `finishMatch` transitions advance it.
  - Each one returns `{ state, events }` and never mutates its input. The ratings it compares are integer points from 0 to 1000.
- **The server:** `apps/server/src/modules/cards/` rebuilds the engine state from rows under the room lock, applies one transition and writes the difference back in the same transaction (`store.ts`).
- **The location authority:** `card_instances` says where every card is (DECK, ACTIVE or POT).
  - A row CHECK enforces the shape of each location.
  - A deferred unique constraint keeps deck positions distinct.
  - A deferred constraint trigger checks at commit that each room still holds exactly `total_cards` instances.
- **Ratings snapshot:** every instance stores the points it was dealt with, so a later catalog change cannot alter a running match.

### 2. Committed randomness, `hmac-sha256-ctr-v1`
- **The seed:** the backend draws a 256-bit seed with `crypto.randomBytes` in the start transaction. Engines never create randomness; the dependency-boundary test forbids `Math.random`, `randomBytes`, `randomUUID` and `getRandomValues` in engines.
- **Storage:** the seed is sealed with the data key (AAD `card-seed:<roomId>`) in `rooms.seed_ciphertext`.
- **The commitment:** `SHA-256(seed ‖ roomId ‖ configHash)` is published in `game.started` and in every snapshot.
  - The room ID is the room nonce.
  - `configHash` is the SHA-256 of the canonical JSON of the rules version, RNG version, data version, seat order and settings.
- **Streams:** there are three independent streams: `deal`, `seats` and `fallback`.
  - Block k = `HMAC-SHA256(seed, label ‖ 0x00 ‖ uint64be(k))`, consumed as big-endian uint32 values.
  - `uniform(n)` uses rejection sampling below the largest multiple of n.
  - Shuffles are Fisher–Yates from the top index down.
  - SHA-256 and HMAC are pure TypeScript inside the engine, so it needs no `node:crypto`.
  - The draw counts are stored in `card_games.rng_draws` for audit.
- **Disclosure:** the seed is revealed only when the match has a result, as `auditSeed` in `game.completed` and in the snapshot. Anyone can then recompute the commitment.

### 3. Deal
- **Per-rarity counts:** they follow the catalog's own mix among the enabled rarities, with at most one dual card per match (ADR-020).
- **Repeats:** a definition is dealt at most once, but Normal, Silver and Gold of the same legend are distinct definitions and may meet in one match. Duals may share a match with their players' single cards (ADR-020 amendment).
- **Stratified mode (default):** cards are banded by the sum of their ratings into four bands of whole rounds. Each band is shuffled and dealt round-robin from a random start seat, so every seat gets the same number of cards from every band. Each deck is then shuffled. Random mode deals one shuffled pile.
- **Selector and fallback:** the initial selector comes from the `seats` stream and the fallback permutation from the `fallback` stream.
- **Seat order:** lobby seat, then join time, then member ID.

### 4. Commands, deadlines and versions
- **`card.selectCategory {comparisonId, metric}`:** the checks run in this order:
  1. membership;
  2. the match is running;
  3. the engine (`STALE_COMPARISON`, `SELECTOR_ONLY`, `RULE_VIOLATION` for an unknown metric);
  4. `expectedVersion`, refused with `VERSION_CONFLICT`. Every gameplay transition closes the open comparison, so a mismatch here means the client skipped events.

  The reply is `{comparisonId, stateVersion}`. A retry with the same command ID returns the stored receipt without a second transition.
- **`card.revealAcknowledged`:** cosmetic only. It checks membership and writes nothing.
- **Selection timeout:** `card.selection_timeout` jobs carry the comparison ID and a timer generation. The handler re-validates both under the room lock and no-ops when stale.
  - The timeout picks the category with the largest margin of selector points over the best opponent's points. Equal margins go to the first in enum order.
  - A command that arrives after its deadline first settles the due timeout, then is refused as stale.
- **Match time limit:** a `card.match_limit` job ends the match by card count. The unresolved chain is first restored to its contributors (rules §6.2). Phase 08 adds the full ranking and restoration paths.
- **Event versions:** `runRoomCommand` now stamps events from settled due work with the state version their own transition produced. Before, they were stamped with the pre-bump version.

### 5. Snapshot and events
- **`PermittedCardSnapshot`:** it contains seats with deck counts (also as `deckCountsBySeat`), the open comparison, the selector, eligible and tied seats, revealed cards and pot contributions as public card DTOs with portraits, the deadline, the viewer's allowed actions, the commitment and the last decided comparison.
  - It never contains deck order, undealt identities or, before completion, the seed.
  - An integration test checks the snapshot and every public event against the IDs of undealt instances and the seed.
- **Display values:** ratings on the wire are whole numbers from 0 to 100 (display = round(points/10)). Comparisons use the internal points.
- **Catalogs:** events and acks follow the catalog names (`submittedValues`, `contributions`, `publicResult`, `accepted`). Fields the implementation adds are recorded in `schema/*.json`. `pnpm contracts:check` now compares every card event, command and snapshot schema with the catalog, field by field.

### 5a. Own deck visible as a queue (product owner, 11 October 2026)
- **What the player sees:** each player sees their own deck in play order (`myDeck`, front first) as a queue.
  - The card in play is always the front card, and its stat must be chosen. Players can look at their cards but never pick one out of order.
  - Cards won join the back of the winner's deck in pot order: comparison, then seat.
- **Privacy:** only the owner receives their deck. Other players and spectators see deck counts only, and no event carries deck contents.
- **Tests:** the integration tests check privacy for both seats, and that after a win the old queue moves up and the won cards sit at the back.
- **Spec change:** this amends DB spec §10's "no deck order" rule, which now applies to everyone except the deck's owner.

### 5b. Card visuals (product owner, 11 October 2026)
- **Shining tiers:** Gold, Silver, Platinum and Dual Platinum cards shine (a light sweep) and glow (a soft halo). Gold adds sparkles, and Platinum frames are holographic.
- **Matte tiers:** Bronze and Normal are matte, with no shine and no glow.
- **Reduced motion:** with reduced motion turned on, every animation is removed and a static glow remains.
- **Ratings unaffected:** rarity changes only the look, never the ratings (R19 and the ADR-020 version factors are unchanged).

### 6. Terminal state
- **When a match ends:** the room moves to `FINALIZING` with phase `FINISHED`, and `game.completed` carries:
  - `publicResult` (reason and standings);
  - `medalStatus: 'deferred'`;
  - `resultsExpiresAt: null`;
  - the audit seed.
- **Later phases:** medals, voting and the results TTL arrive with phases 14–15.

## Deviations recorded
- **S10:** the comparison sheet is a dialog opened from the arena. The `?view=comparison` query route is not used, so closing the dialog cannot change the URL or lose arena state.
- **S08:** dealing is part of the atomic start transaction. The preparation page therefore reports completed stages, then forwards to the arena after 1.2 s. It has no progress bar.
- **Contest numbering:** the snapshot's `comparisonIndex` is global across the match, as the engine counts it.

## Amendment (11 October 2026): three categories (ADR-022)
- **Categories:** the game's categories are Batting, Bowling and Runs (`CARD_METRICS`).
- **Timeout policy:** the policy, the fallback sum and stratification work over these three.
- **Comparisons:** migration 051 limits new comparisons to these metrics.

