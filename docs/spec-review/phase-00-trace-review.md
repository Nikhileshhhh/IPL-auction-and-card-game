# Phase 00 trace review

Hand-executed traces of the normative examples against the invariants in GAME_RULES §1, §5–§7, §8.2–§8.3, §12 and DB/realtime §3–§4. These traces become executable tests in phases 07, 08, 10 and 14 (see `docs/requirements-traceability.md`, vectors V01–V21). No application code is claimed here.

Notation: decks are listed top-first; `N` = total card instances; money in rupees (₹1 cr = 10,000,000; ₹1 lakh = 100,000).

## T1 — Four-card unique win (V01)

Setup: 4 seats A–D, 12 cards each, N = 48, selector A, comparison 0 of chain 0.

| Step | Transition | State after | Invariant check |
|---|---|---|---|
| 1 | REVEAL: each eligible seat (deck > 0) moves its top card DECK→ACTIVE in seat order A,B,C,D | A/B/C/D decks 11, ACTIVE 4 | 44 + 4 = 48 ✔; one location per instance ✔ |
| 2 | SELECTING: A picks category; values A=92, B=87, C=94, D=79 | — | only selector command accepted; others get `SELECTOR_ONLY` |
| 3 | RESOLVING: ACTIVE→POT ordered (comparison index, seat) = A,B,C,D | POT 4 | 44 + 4 = 48 ✔ |
| 4 | Unique max C → AWARDING: append POT to C's tail preserving order A,B,C,D (`next_tail_ordinal` increments) | C deck 15; A,B,D 11; POT 0 | 15+11·3 = 48 ✔; no ordinal collision ✔ |
| 5 | Elimination check only after POT empty: nobody at 0 | selector := C; decided contests 1 | selector valid ✔ |

Result matches the spec ("C receives four cards … C selects next").

## T2 — Six-card tie (V02)

Setup as T1, selector A. Values A94, B94, C82, D76.

| Step | Transition | State | Check |
|---|---|---|---|
| 1 | Reveal 4, resolve: maxima {A,B} → `tiedSeats=[A,B]`, all 4 cards stay in POT, `tie_count=1` | decks 11 each, POT 4 | 44+4=48 ✔ |
| 2 | TIE_REVEAL: `able = tiedSeats with deck>0 = [A,B]` (≥2) → only A,B contribute; C,D temporarily ineligible and keep their decks | decks A10 B10 C11 D11, ACTIVE 2, POT 4 | 42+2+4=48 ✔; C,D contribute nothing ✔ |
| 3 | Selector: original selector A is in tiedSeats with a next card → A selects again | — | R03 ✔ |
| 4 | A88, B96 → unique max B; ACTIVE→POT (6); award to B tail in order: comparison 0 (A,B,C,D), comparison 1 (A,B) | B deck 16, A10, C11, D11, POT 0 | 16+10+11+11=48 ✔ |
| 5 | Elimination after award: none; selector B; chain closes; C,D eligible again at next normal boundary | — | V02: "B receives 6; C/D submit once only" ✔ |

## T3 — Exhaustion fallback (rules §6 examples)

A and B tie on their last cards (decks 0 after reveal); C, D lost but hold cards. `able=[]` → fallback among `tiedSeats=[A,B]` only: compare each one's most recent contributed card by sum of six ratings; if equal, walk the committed fallback permutation rotated by `chainIndex mod 4` and take the first tied seat. Winner receives the 4-card pot; then the zero-card loser is eliminated. C and D cannot claim the pot. ✔ Conservation holds because the award moves exactly the 4 POT cards.

Mixed case: A,B,C tie; A has no next card → only B,C contribute (A not eliminated yet, R04/R10). If B wins, award then eliminate A. If B,C tie again and both exhaust → fallback over {B,C}, never A. ✔

## T4 — Exact-deadline bid and anti-sniping (V11, V12, E17)

Nomination opens at DB time T with deadline `T+20s` (opening clock 20 s), base price ₹2 cr.

| Case | DB `clock_timestamp()` after room lock | Outcome |
|---|---|---|
| First bid ₹2 cr (must equal base price) at T+5s | `T+5s < T+20s` → accept; new deadline `max(T+20s, T+13s) = T+20s` | ✔ |
| Next bid must be `2 cr + increment(2 cr)` = ₹2.2 cr (band ≥ ₹2 cr → ₹20 lakh) at T+15s | accept; deadline `max(T+20s, T+23s) = T+23s` | ✔ late-bid extension |
| Next legal bid ₹2.4 cr arrives with DB time exactly `T+23s` | `T+23s < T+23s` false → `LATE_BID`; due-deadline transition is settled first in the same transaction | ✔ timer wins at equality |
| Same franchise as current leader bids | `ALREADY_LEADING` (no self-raise) | ✔ |
| Client sends ₹2.6 cr (jump) | `STALE_BID` (amount must equal current + increment) | ✔ |

Increment band uses the **current** bid, not the resulting bid: ₹1.95 cr → +₹5 lakh = ₹2.0 cr; ₹2.0 cr → +₹20 lakh. ✔ (spec example ₹2cr → ₹2.2cr → ₹2.4cr).

## T5 — RTM (V13, V14, E57, E58)

Player X, previous franchise F1 (entitlement `6 − retained − successfulRTM ≥ 1`, subcap not exhausted). Bidding expires with F2 leading ₹5 cr.

1. Expiry with eligible RTM and F1 ≠ leader → `RTM_INTENT` (15 s); no purchase, no purse change; F2's ₹5 cr remains a reserved commitment.
2. F1 invokes → `RTM_RAISE` (15 s): F2 may submit one final offer, any integer-lakh amount ≥ ₹5 cr that passes F2's reserve/roster checks (e.g. ₹7 cr). Invalid raise (E57) is rejected and the binding amount stays ₹5 cr. Timeout = hold.
3. `RTM_MATCH` (15 s): F1 matches ₹7 cr → one acquisition for F1 (kind `rtm`, charged ₹7 cr), F1 purse −₹7 cr, entitlement −1, F2 commitment released. ✔ V13.
4. F1 declines or times out → one acquisition for F2 at ₹7 cr; F1 entitlement unchanged. ✔ V14.
5. F1 cannot afford/roster-fit the match (E58) → match disabled with reason; decline path → F2 buys; RTM not consumed. ✔

Intent timeout → decline → F2 buys at ₹5 cr. Purse conservation `initial = retention + purchases + remaining` holds in every branch (exactly one acquisition row per nomination, unique `(room, player)`).

## T6 — End vote (V17, E29, E30, E52)

Threshold = `floor(N/2) + 1`: N=1→1, N=2→2, N=3→2, N=4→3, N=5→3, N=10→6.

| Electorate | Ballots | Yes > N/2? | Result |
|---|---|---|---|
| N=4 | 2 Yes, 1 No, 1 abstain | 2 > 2 false | Continue ✔ (V17) |
| N=4 | 2 Yes, 2 No | false | Continue ✔ (E29) |
| N=4 | none | false | Continue, cooldown 120 s ✔ (E30) |
| N=2 | 2 Yes | true | End ✔ |

Timer restore: vote starts with bidding remaining 6,200 ms → saved; at resolution DB time R ≥ expiresAt, new deadline `R + 6,200 ms`. A saved 0 ms resolves immediately in the same transaction before any new bid. A ballot processed at exactly `expiresAt` is rejected (`VOTE_EXPIRED`, E52).

## Ambiguities resolved (recorded decisions, no rule changes)

| # | Topic | Interpretation adopted | Source |
|---|---|---|---|
| D1 | Timeout category "relative to the maximum opponent rating" | Opponents = the other contributors in the current comparison; advantage = selector points − max opponent points; ties broken by enum order `batting, bowling, fielding, form, experience, versatility` | Rules §5, §3.2 table order |
| D2 | Tie cap counting | `tie_count` counts tied comparisons in the current chain; when it reaches the configured cap (default 12) the chain settles by fallback among current `tiedSeats` without a new reveal | Rules R07, §6 |
| D3 | Fallback seat order rotation | `rotated = fallbackPermutation.slice(k).concat(slice(0,k))`, `k = chainIndex mod participantCount`; first seat in rotated order that is in `tiedSeats` wins | Rules §6 |
| D4 | Tie comparison selector | Original chain selector if still in `tiedSeats` and `deck > 0`; else first clockwise (by immutable seat number) tied seat with a next card after the original selector | Rules R03, §6 |
| D5 | RTM raise denomination | Integer multiples of ₹1 lakh, ≥ standing bid; equal = hold | Rules §8.3 |
| D6 | DTO portrait optionality | `portraitUrl` required (ADR-017) | Product-owner requirement |
| D7 | Deck tail ordering on award | Pot order = (comparison index, seat number); appended in that order | Rules R02, §5 |
| D8 | Duplicate-ballot error name | DB §8.2 writes `ALREADY_CAST`, rules §12 writes `VOTE_ALREADY_CAST`; the canonical registered code is `VOTE_ALREADY_CAST` (rules are normative for gameplay) | Rules §12, DB §8.2 |

No contradictions requiring a specification change were found; therefore no spec version bump.
