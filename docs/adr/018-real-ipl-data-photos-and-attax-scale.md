# ADR-018: Real IPL statistics, real player photos and an Attax-style 0–100 scale

- **Status:** Accepted (product-owner requirements, 10 October 2026). Amends ADR-017.
- **Requirements:**
  - "On the cards and in the auction game the original images of the players must be present."
  - "The stats/ratings must be based on their original stats."
  - "The maximum batting rating and bowling rating must be 100, as on the Cricket Attax cards game by Topps."

## Decision

### 1. Real statistics
The default published pack is built from **Cricsheet** IPL ball-by-ball data (source S07/S25, ODC-By 1.0). Attribution is shown in every card's detail.
- `pnpm data:fetch` downloads only two allowlisted URLs. It records a SHA-256 checksum and a ledger entry.
- The aggregation (`packages/game-engines/src/cricket`) applies the rules §3.2.1 definitions:
  - wides are not balls faced;
  - no-balls and wides are not legal balls;
  - byes and leg-byes are not conceded runs;
  - run-outs are not bowler wickets;
  - super overs are excluded;
  - players are keyed by Cricsheet register ID, never by name.
- Data after the snapshot cutoff never enters a pack.
- Facts Cricsheet lacks (country, batting/bowling style) render as "Not available" until an admin enters them. They are never guessed.

### 2. Real photos, lawfully
"Visible on the web" is not "free to reuse". Photos from iplt20.com, BCCI or picture agencies are **not** scraped (S05, S06). Real photos come from two sources:
1. **Freely licensed photos on Wikimedia Commons** (`pnpm data:photos`).
   - Players are matched through Wikidata (ESPNcricinfo ID P2697 → name and P18 image).
   - The importer prefers photos whose description or categories show IPL / franchise context, i.e. players in IPL kit.
   - Only CC0, public-domain, CC BY and CC BY-SA licences are accepted.
   - Author, licence, licence URL and file page are stored. The credit line is shown with the card.
2. **Admin uploads** (S34) of photos the operator holds rights to, with recorded evidence.

Every photo is decoded, attention-cropped to 3:4 and re-encoded to WebP 320/640/960. All metadata is stripped. The photo lives in private storage and is served only to signed-in members through the BFF. Revoking a photo stops it being served immediately.

The publish gate from ADR-017 stays: a card cannot be published without an approved photo. An admin may choose "publish without cards lacking a photo", and the count of dropped cards is reported, never silent.

Original illustrated portraits remain **only** for the fictional demo league (offline tests and demos).

### 3. Attax-style scale
- Ratings stay integers 0–1000 internally (rules §1).
- The display is a whole number **0–100** labelled "Game rating".
- After the rules §3.2 composite (exposure shrinkage, midrank percentiles, fixed integer weights), each rating is **rank-rescaled within the published cohort**: `Q = 10 + round(990·(r−1)/(n−1))`, with midrank ties, among players with exposure.
  - The best batter therefore rates exactly **100 batting** and the best bowler exactly **100 bowling**.
  - A confirmed non-batter or non-bowler is **0**.
  - Missing data uses the prior and an "estimated" tag.
- Dual cards average their two players, capped at 95.
- Rarity never changes ratings (R19).

## Consequences
- **Winsorisation dropped.** It only manufactured ties at the top, which the 100-cap requirement forbids. Midrank percentiles are already robust to outliers. This is a documented deviation from rules §3.2.
- **Experience** uses IPL appearances up to the cutoff, because Cricsheet's IPL archive is the cohort.
- **Network access required.** cricsheet.org, query.wikidata.org, commons.wikimedia.org and upload.wikimedia.org must be reachable by the operator scripts. In the build environment they were blocked by network policy, so the pipeline is verified end to end against an offline Cricsheet-format fixture. The real import has not been run.
- **Photo coverage is not guaranteed.** Not every IPL player has a free photo in IPL kit. The coverage report lists players who need an uploaded photo.
- **Rights.** The platform records rights evidence but cannot grant rights. Using real names and likenesses in a game still needs the operator's own assessment (master plan §3).
