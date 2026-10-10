# ADR-020: Legend cards and Platinum pairs

- **Status:** Accepted (product-owner decision, 10 October 2026). It supersedes the rarity tiers of rules §3.4 (40/25/15/10/8/2 by rank) and the automatic dual pairing.
- **Requirement:** only players who represented one franchise in 100+ matches, and are hugely popular (Virat Kohli, Rohit Sharma, MS Dhoni…), have Normal, Silver and Gold cards. Dual cards are Platinum only, for famous pairs such as Ro-Ko (Rohit Sharma and Virat Kohli) and Virat Kohli with MS Dhoni.

## Decision

### Who gets which card
- **Legend:** a player with **100 or more IPL matches for a single franchise**, counted over every IPL season up to the cutoff. Renamed franchises count as one (Delhi Daredevils → Delhi Capitals, Kings XI Punjab → Punjab Kings, Royal Challengers Bangalore → Bengaluru). The rule is objective and computed from Cricsheet (`findLegends`). On the 2008–2026 archive it yields 25 legends, matching the popularity intent: Kohli, Dhoni, Rohit, Narine, Pollard, Jadeja, Raina, Bumrah, de Villiers, Samson, Bhuvneshwar, Harbhajan, Russell, Hardik, Suryakumar, Malinga, Bravo, Rayudu, Chahal, Pant, Axar, Gambhir, Yusuf Pathan, Ashwin and Rahane.
- **Legend cards:** each legend has three cards, **Normal, Silver and Gold**.
- **Everyone else:** one **Bronze** card.
- **Platinum:** used only for **dual cards** of the named pairs (product owner's list, editable in `IPL_DUAL_PAIRS`):

  | Dual card |
  | --- |
  | Ro-Ko (Rohit and Kohli) |
  | Kohli and Dhoni |
  | Dhoni and Jadeja |
  | Rohit and Bumrah |
  | Narine and Russell |
  | Hardik and Suryakumar |
  | Kohli and de Villiers |
  | Dhoni and Raina |
  | Rohit and Pollard |
  | Bumrah and Malinga |

  A player may appear in several pairs, which amends the "no identity in two pairs" rule. A pair whose players are not both in the pack is skipped.
- **Single-player Platinum:** no longer produced. The enum value stays for compatibility.
- **Rarity is still visual only (R19):** all three versions of a legend show the same ratings. A dual card is the rounded mean of the pair, capped at 950 (95 displayed).

### Retired legends join the pack
- **Who:** legends whose last IPL season is before the pack window. On this pack that is Pollard, Raina, de Villiers, Harbhajan, Malinga, Bravo, Rayudu, Gambhir and Yusuf Pathan.
- **Ratings:** they are rated on **their own last three IPL seasons** (`latestSeasonOf`), within the same cohort.
- **Franchise:** they are shown in the franchise they are legends of (`teamOf`).
- **Photos:** their photos come from that franchise's IPL squad headshots, which the importer now reads back to 2008.

### Deals
A deal mirrors the catalog's own mix (`allocateRarityCounts(total, enabled, available)`): Bronze-heavy, a share of legend versions and a few Platinum pairs. A deal larger than the pool is `POOL_INSUFFICIENT`, never duplication.

Phase 07 enforces the existing rules in a deal:
- at most one dual per match;
- no single card of a dual's player in the same deck.

### Demo pack
The fictional league is too young for 100-match legends. Its four strongest players stand in as legends, with two Platinum pairs, so every card type exists offline and in tests.

## Consequences
- The real pack (IPL 2024–2026 plus the 9 retired legends) has 321 players and 381 cards: 296 Bronze, 25 each of Normal, Silver and Gold, and 10 Platinum duals.
- The card pool page shows "Card types" instead of "Six rarities".
