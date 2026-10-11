# ADR-022: Attax career ratings — Batting, Bowling, Runs

- **Status:** Accepted (product-owner decision, 11 October 2026). It supersedes:
  - the six-category card face and game categories (ADR-018, rules §3.2);
  - the rank rescale over a recent three-season window;
  - the dual mean with its 950 cap (ADR-020).
- **Prompt:** the product owner compared the pack with Topps Cricket Attax cards and found the ratings wrong:
  - Bronze players rated above Kohli, Rohit and Dhoni.
  - The Rohit Sharma & Virat Kohli dual showed fielding below 60.
  - Sachin Tendulkar and Chris Gayle were missing.
  - Their rules: batting comes from runs scored and batting average; Bronze never shows more than 89; the greats rate highest.

## Decision

### 1. Three stats, Attax style
- **The stats:** every card shows **Batting**, **Bowling** and **Runs**, with a 1–5 star rating. These three are also the game's categories (`CARD_METRICS`).
- **Card layout:** the photo on a team-coloured sunburst, the name up the left edge and the role down the right, then three circles: Bowling (blue), Runs with the stars (maroon), Batting (green). It is original artwork with no Topps marks.
- **Migration `051_attax_card_stats`:** moves the card definition and comparison checks to the three stats for new rows only (NOT VALID), because published versions are immutable.

### 2. Whole-career model (`ratings/career.ts`, `ratings-career-v2`)
- **Batting:** 55 % volume, √(career runs ÷ the most career runs), plus 45 % quality.
  - Quality is 60 % batting average (shrunk toward 20, on a 10–45 scale) and 40 % strike rate (shrunk toward 120, on a 100–165 scale).
  - It is weighted by exposure, balls faced ÷ (balls + 300).
- **Bowling:** 55 % volume, √(career wickets ÷ the most), plus 45 % quality.
  - Quality is 50 % economy (shrunk toward 9.0, on a 10–6.5 scale) and 50 % bowling average (shrunk toward 35, on a 40–17 scale).
  - It is weighted by balls bowled ÷ (balls + 600). A part-timer's few overs never look elite.
- **Runs:** career runs per batting innings, a real figure that is never scaled.
- **Zero values:** never batting or never bowling is a real 0.
- **Determinism:** only + − × ÷, integer square roots and rounding, so results are identical on every platform.
- **Card detail:** the drawer shows career totals.

### 3. Tier bands (`buildCatalog`)
- **Bronze:** scaled so the best Bronze batter and bowler show **89**. A Bronze card never shows more.
- **Legend Gold:** the main skill is spread over **90–100** across legends, and the best legend is 100.
  - The main skill is batting for batters and keepers, bowling for bowlers, and the stronger one for all-rounders.
  - The other skill uses the Bronze scale (for example, Kohli's bowling stays low).
- **Legend Silver and Normal:** 96 % and 92 % of Gold for Batting and Bowling (ADR-020 amendment); Runs is unchanged.
- **Platinum pair:** the better of the two players' Gold cards for every stat.
- **Stars:** from the card's best skill: 90+ five, 80+ four, 65+ three, 45+ two, otherwise one.

### 4. Extra legends
- **Sachin Tendulkar and Chris Gayle** get Normal, Silver and Gold cards although neither played 100 matches for one franchise (`IPL_EXTRA_LEGENDS`).
- Each is shown in the franchise they played most for: Sachin with Mumbai Indians, Gayle with Royal Challengers.

## Consequences
- **Remaining fields:** fielding, form, experience and versatility no longer appear on cards or in the game. Phase ratings remain in the card detail, labelled "last three seasons".
- **Pack label:** "IPL careers 2008–2026, as of …".
- **Older packs:** packs published before this change keep their six-stat rows and are archived when the new pack is published.
