# ADR-024: Real IPL auction rules, today's squads and the setup flow

- **Status:** Accepted (phase 09, 12 October 2026).
- **Decisions by the product owner:**
  - "Use the real rules of the IPL auction."
  - Start from today's players: each player's previous franchise is their IPL 2026 team.
  - Collect the real base prices.
  - Players with no registration since 2024 get ₹2 cr when capped and ₹30 lakh when uncapped.
- **Supersedes:** the `CASUAL_v1` and `IPL_2025_MEGA_HISTORICAL_v1` presets of the phase-00 contracts and the spec's demo-price casual preset for real data.

## 1. Rules: TATA IPL Player Regulations 2025–27

`IPL_MEGA_RULES_2025_27` (`packages/game-engines/src/auction/rulesets.ts`). The simulated auction is the mega auction before the 2027 season.

| Rule | Value | Provenance |
|---|---|---|
| Purse | ₹120 crore. This is the purse, not the ₹146–157 cr salary cap. | Official: IPL press release, 28 Sep 2024 |
| Retentions plus RTMs | At most 6: at most 5 capped (Indian and overseas) and 2 uncapped | Official |
| Uncapped Indian | No international starting XI in the five calendar years before the season | Official |
| Retention deductions | Capped ₹18 / 14 / 11 / 18 / 14 cr in retention order; uncapped ₹4 cr | Reported (franchise FAQs, e.g. Mumbai Indians) |
| Squad | 18 to 25 players, at most 8 overseas, at most 4 overseas in the XI | Reported (standing auction rules) |
| Base-price bands | ₹2, 1.5, 1.25, 1 cr, ₹75, 50, 40, 30 lakh | Reported (2025 and 2026 auction lists) |
| Bid increments | 5 lakh below ₹1 cr, 10 lakh to ₹2 cr, then 20 lakh | Reported (Business Today 2025 auction guide; checked in phase 10, ADR-025) |

- **Retention charge:** max(Σ capped slabs, Σ negotiated capped salaries) + Σ max(uncapped salary, ₹4 cr).
  - This reproduces the real 2025 charges:
    - CSK: Gaikwad 18, Jadeja 18, Pathirana 13, Dube 12, and Dhoni uncapped 4, a total of ₹65 cr.
    - SRH: Klaasen at 23 within the ₹75 cr slab total.
    - Mumbai Indians: ₹67 cr for Bumrah, Suryakumar, Hardik and Rohit at their contract salaries, the same as MI's real 2025 total.
  - Per-player allocations spread any top-up in proportion to the slabs, using largest remainder by player ID, and sum exactly to the charge.
- **RTM cards:** 6 − retained, within the capped and uncapped sub-caps. A fresh reset has none.
- **Reserve:** a team must always keep (minimum squad − squad) × the lowest base price in the frozen pool. A retention that breaks this is refused (`PURSE_INVALID`).
- **Fresh reset:** offered as a clearly labelled simulator option: an empty squad, the full purse, no retentions and no RTM.

## 2. The pool: real data, with provenance

The pool is built by `pnpm data:auction` (`scripts/data/import-auction.ts`) and published as an `auction_rulesets` row with `auction_pool_entries`, for the current factual data version.

- **Previous franchise:** the official IPL 2026 squad feeds from iplt20.com, matched to the card pack with the existing strict name matcher.
  - The pool contains the 210 squad players who are in the pack.
  - The 64 squad players with no IPL appearance yet have no card or photo and are listed in the report.
  - Retired legends such as Sachin and Gayle stay card-game only.
- **Current salary and registered base price:** the Wikipedia lists of IPL 2025 and 2026 personnel changes, which cite ESPNcricinfo and the BCCI. These are parsed from the raw page text.
  - The counts match reality: 46 and 173 retained, 77 sold in 2026, and 8 RTM buys in 2025.
  - A player's base price is their most recent registered price: the 2026 auction, a 2026 replacement signing (replacements are signed at their listed price), then the 2025 auction or a 2025 replacement.
  - 42 players have been retained since 2024 and never registered. They get the owner's rule (₹2 cr capped, ₹30 lakh uncapped) and are marked `not_registered`. The UI says "not registered since 2024".
  - A reviewed overrides file can set any price: `data/sources/ipl-auction-base-price-overrides.csv`.
- **Capped status for 2027:**
  - Cricsheet international matches (Tests, ODIs, T20Is) give each player's last international appearance, and the 5-year rule applies to Indian players. Overseas players count as capped once they have played any international.
  - Cricsheet withholds every Afghanistan men's match. Afghan internationals are therefore classified in the reviewed file `data/sources/ipl-auction-capped-overrides.csv`, with sources. Noor Ahmad and AM Ghazanfar are there.
  - An unresolved status stays `unknown`, which blocks retaining that player and is never guessed.
- **Review report:** `data/sources/ipl-auction-pool.csv` lists every player with franchise, overseas, role, capped status, last international, 2026 salary, base price and the base-price source.
- **Result:** 210 players, 142 capped and 68 uncapped, 78 overseas, 0 unknown.
- **Demo pack:** publishing a demo pack also publishes a ruleset with the same real rules over the fictional league, with DEMO prices and capped status by card strength. This keeps tests and offline work running.

## 3. Setup flow

The auction runs inside lifecycle LOBBY, with `rooms.phase` set as follows:

| Phase | What happens |
|---|---|
| `FRANCHISE_SELECTION` | Members claim franchises. The claimer becomes captain, assigned by the server. One team per member (UQ room/member) and one team per franchise. A team gets a 12-character join code, HMAC-indexed and encrypted. A code only creates a request; the captain approves it and the requester joins as an advisor. The full capability editor is phase 11. |
| `RETENTION` (retention format only) | The host closes selection, which needs 2 or more teams. Captains, or members with retention-proposal rights, propose ordered picks with negotiated salaries. The server prices and validates each proposal: caps, previous franchise ("foreign identity" is refused), known status, overseas, purse and reserve. The captain locks with the package version; locking writes acquisitions and the charge and resets the team's readiness. |
| `AUCTION_LOBBY` | Reached when every team has locked. Everyone readies up; start then needs the bidding engine (phase 10). |

- **Creating the room:** binds `rooms.ruleset_id` and `data_version_id`, checks pool feasibility (`POOL_INSUFFICIENT` with the exact shortfall), and freezes the pool into `auction_pool`.

## 4. Data model (migration `060_auction`)

- **Tables:**
  - `auction_games`
  - `auction_franchises`, with UQ(room, franchise) and the purse check 0 ≤ remaining ≤ initial
  - `franchise_members`, with UQ(room, member), one captain per team, and a captain row that must hold every capability
  - `franchise_invites`
  - `franchise_join_requests`
  - `auction_pool`, with UQ(room, order)
  - `retention_packages`, one per team, versioned
  - `auction_acquisitions`, with UQ(room, player)
- **Same-room links:** composite same-room foreign keys throughout.
- **Deferred triggers:**
  - purse conservation: initial = retention charge + purchases + remaining;
  - the captain pointer must equal the captain membership.
- **Pool entries gain:** `overseas`, `role`, `current_salary` and `price_source`.

## 5. Realtime

- **Team streams:** a team stream (`team:{teamId}`) is readable only by approved members. One ACL clause (`streamAcl`) serves snapshots, socket subscription and replay.
- **Live join:** a member's open sockets join the team stream as soon as they are approved (`onStreamGranted`).
- **Public projection:** the public purse projection (captain, members, retention status and charge, remaining purse, squad and overseas counts) is in every member's snapshot.
- **Private projection:** draft retentions, join requests and the join code are team-private. The code is shown to the captain and to inviters only.

## Consequences

- **Real squads:** rooms use real squads and money. Every value carries its source, or is labelled reported, simulator, demo or "not registered since 2024".
- **New season:** a new IPL season needs `pnpm data:auction -- --fetch --publish` after the squads and lists update. Published rulesets stay immutable.
- **Left for phase 10:** bidding, RTM raise and match, and increments. Captain handover and the capability editor are phase 11.
