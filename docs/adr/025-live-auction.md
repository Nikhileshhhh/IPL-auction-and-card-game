# ADR-025: Live auction — bids, clocks, right to match, passes and the end

- **Status:** Accepted (phase 10, 13 October 2026). It builds on ADR-024 (rules, pool, retentions) and ADR-007 (durable deadlines). It implements rules §8 and §11, and the S20 stage.
- **Context:** phase 09 left rooms in the auction lobby with locked squads. Phase 10 must run the auction itself: serial bids, durable deadlines with anti-sniping, the real 2025 right-to-match flow, sales, an unsold second pass, host pause and skip, and the end of the auction. It must do so without a `setTimeout` deciding a sale, a client-chosen amount, or a purse deducted twice.

## Decision

### 1. Lot order
- **Sets:** players go under the hammer in the real auction's sets (capped batters, all-rounders, wicketkeepers and bowlers, then the uncapped sets), as in `auctionSet`.
- **Order within a set:** a seeded shuffle from a 32-byte seed. It reuses the card RNG `hmac-sha256-ctr-v1` with a new stream label, `lots`.
- **Commitment:** published at the start as `SHA256(seed ‖ roomId ‖ configHash)`. The config hash covers the rules hash, the room and the sorted pool.
- **Seed storage:** sealed with `secrets.encryptor` (context `auction-seed:<roomId>`). It is disclosed in the snapshot only once the auction has ended.
- **Nomination:** only the server nominates.

### 2. Bids (`packages/game-engines/src/auction/bids.ts`)
- **Opening bid:** the base price.
- **Next bid:** the next step on the increment grid for the current amount, `(current / step + 1) × step`. Steps are ₹5 lakh below ₹1 cr, ₹10 lakh up to ₹2 cr, then ₹20 lakh. For example ₹1.95 cr → ₹2.0 cr → ₹2.2 cr.
- **Increment provenance:** now "reported", from the Business Today 2025 auction guide.
- **No jump bids.** The client sends the amount it saw. If the amount or the nomination version differs from the server's, the reply is `STALE_BID` with the current version and `nextAmountRupees`, and the bid is never raised automatically.
- **One validator for every actor** (`bidRejection` / `purchaseRejection`):
  - `ALREADY_LEADING`
  - `SQUAD_FULL` (25)
  - `OVERSEAS_LIMIT` (8)
  - `BUDGET_RESERVE` with `allowedCeiling`: purse minus the reserve for the remaining minimum-squad places at the lowest base price
  - `XI_INFEASIBLE`
- **XI feasibility** (`xi.ts`): a dynamic programme over the owned players plus the players still to come. It needs 11 players, at most 4 overseas, at least 1 keeper, 5 bowlers (at least 2 pace and 1 spin) and 6 batters, within the squad places left.
- **Pace and spin:** taken from `players.bowling_style` and copied into `auction_pool.bowl_type` when the auction starts.
- **Validation order:** membership → running auction → lot and version → deadline → team right → rules.

### 3. Clocks
- **Opening clock:** `openingClockSeconds` (default 20).
- **Anti-sniping:** an accepted bid sets `deadline = max(deadline, now + 8 s)`, using the DB clock read after the room lock. There is no cap on extensions.
- **Exactly at the deadline is late** (`LATE_BID`).
- **Jobs:** `auction.bidding_deadline`, `auction.rtm_deadline`, `auction.next_lot`, `auction.pause_expiry` and `auction.hard_limit`. They are wake-up hints only. Each handler re-reads the lot, its stage, its timer generation and the DB clock under the room lock, and does nothing if anything has moved on.
- **Settlement is idempotent:** running the due pass twice, or concurrently, sells a lot once.

### 4. Right to match (real 2025 flow)
RTM opens when bidding closes with a leader and all of these hold:
- the player's 2026 franchise is a team in the room;
- that team is not the leader;
- it has a card for the player's capped or uncapped status (6 − retained − used RTMs, within the 5 capped / 2 uncapped caps);
- it could buy the player at the standing bid.

Otherwise the player sells at once.

| Stage | Who acts | Timeout |
|---|---|---|
| `rtm_intent` | The previous franchise invokes or declines | Declines |
| `rtm_raise` | The highest bidder makes one final offer: whole lakhs, at least the standing bid, within its own ceiling; an equal amount holds | Holds |
| `rtm_match` | The previous franchise matches (re-validated) or declines | Declines |

Each stage lasts `rtmStageSeconds` (default 15). A match buys the player as `kind = rtm` and uses one card. A decline sells to the highest bidder at the binding final offer.

### 5. One sale, one deduction
- `sell()` is the only place an auction purse changes. It writes one acquisition (UQ room, player), deducts the price once, marks the pool row sold and settles the lot.
- A standing bid is a commitment, never a deduction.
- The deferred purse-conservation trigger from migration 060 still holds: initial = retention charge + purchases + remaining.

### 6. Passes, skip, pause and the end
- **Unsold:** a lot with no bid goes unsold. A lot no team can legally buy at its base price closes unsold at once, without a clock.
- **Second pass:** after pass 1, unsold players get one second pass at the same base price. Any still unsold close as unsold for good.
- **Skip:** the host may skip a lot before its first bid, once per player. The player goes to the end of the current pass.
- **Pause:** lots are separated by a 4-second gap. The host may pause only in that gap, at most 3 times, for up to 2 minutes each, with automatic resume. A pause or resume bumps `lot_generation`, so a stale next-lot job does nothing.
- **End:** the auction ends when the pool is exhausted (`pool_complete`), when no team can buy (`no_buyers`), or at the 8-hour ceiling (`time_limit`). An open lot is then cancelled and never sold.
  - The room moves to FINALIZING with `game.finalizing { stage: 'evaluation_pending' }`.
  - Evaluation and medals are phase 14.
  - If no lot can be bought from the very start, the starter reports `lifecycle: FINALIZING`, so the start does not overwrite the end.

### 7. Projection (`AuctionLiveSnapshot`)
- **Everyone sees:** the lot (`NominationDTO`), the public purses, squad and overseas counts, RTM cards and maximum bid of every team, recent results, bids on the current lot, pause state, pass and pool progress, and the seed commitment.
- **Only the viewer's own team sees:** its exact next legal bid (`ownLegalNextBidRupees`) or, when it cannot bid, the reason (`ownRejectionReason`).
- The setup projector serves the lobby; the live projector serves RUNNING and FINALIZING.

### 8. Storage (migration `070_auction_bidding`)
- `auction_nominations`:
  - one open lot per room (partial unique index);
  - stage, status, high bid and franchise, bid version, deadline, timer generation, RTM franchise and final bid, sale.
- `auction_bids` with UQ (nomination, bid version).
- `auction_pool` gains `bowl_type` and `skipped`.
- `auction_games` gains the seed, commitment, RNG version, pause fields, `lot_generation`, `finished_reason` and the active-nomination foreign key.
- Acquisitions gain a foreign key to their nomination.

## Consequences
- Every bid and decision is serial under the room lock. In the concurrency test, 200 parallel bids on one version produce exactly one accepted bid.
- The browser clock is display only. A lot sells when the server's due pass finds its deadline passed.
- Bidding rights for non-captains (the capability editor) and automated bidding come in phases 11 and 12; the validator they will use is already shared.
